import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { resetDb } from './helpers.js';

// GET /api/state: as quatro leituras do poll do dashboard (contas, agenda, pilares e resumo) numa
// resposta só. O endpoint é composição dos quatro handlers que já existem, então o que se testa
// aqui não é a regra de cada bloco (cada um tem o próprio arquivo de teste) e sim a fusão: os
// quatro pedaços chegam juntos, com o mesmo conteúdo que as rotas individuais devolveriam, e o
// filtro de status repassado pro bloco de posts não vaza pros outros três.

const ORIGIN = 'https://atenta.omangue.co';

async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function register(email: string): Promise<{ id: string; cookie: string }> {
  await env.DB.prepare(`insert into signup_invites (email) values (?)`).bind(email.toLowerCase()).run();
  const res = await call(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'senha-de-teste-123', name: email }),
    })
  );
  if (!res.ok) throw new Error(`sign-up falhou (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string } };
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('sign-up não devolveu cookie de sessão');
  return { id: body.user.id, cookie };
}

interface Estado {
  accounts: Array<{ id: string }>;
  posts: Array<{ id: string; targets: Array<{ status: string }> }>;
  tags: Array<{ id: string; name: string }>;
  summary: { por_status: Record<string, number>; atencao: Record<string, number>; proximos: unknown[] };
}

async function estadoDe(user: { cookie: string }, query = ''): Promise<Estado> {
  const res = await call(new Request(`${ORIGIN}/api/state${query}`, { headers: { Cookie: user.cookie } }));
  expect(res.status).toBe(200);
  return (await res.json()) as Estado;
}

function emMinutos(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}

async function criarConta(owner: string, tag: string): Promise<string> {
  const id = `acc-${tag}`;
  await env.DB.prepare(
    `insert into accounts (id, platform, display_name, external_account_id, status, extra, owner_id)
     values (?, 'instagram', ?, ?, 'active', '{}', ?)`
  )
    .bind(id, `conta-${tag}`, `ext-${tag}`, owner)
    .run();
  return id;
}

async function criarPost(opts: { owner: string; accountId: string; tag: string; status: string; quando: string }): Promise<void> {
  const postId = `sp-${opts.tag}`;
  await env.DB.prepare(`insert into scheduled_posts (id, title, body, scheduled_for, owner_id) values (?, '', ?, ?, ?)`)
    .bind(postId, `post ${opts.tag}`, opts.quando, opts.owner)
    .run();
  await env.DB.prepare(
    `insert into post_targets (id, scheduled_post_id, account_id, platform, status, options, adapter_state)
     values (?, ?, ?, 'instagram', ?, '{}', '{}')`
  )
    .bind(`pt-${opts.tag}`, postId, opts.accountId, opts.status)
    .run();
}

describe('GET /api/state', () => {
  let alice: Awaited<ReturnType<typeof register>>;
  let contaAlice: string;

  beforeEach(async () => {
    await resetDb();
    alice = await register('alice@exemplo.com');
    contaAlice = await criarConta(alice.id, 'alice');
  });

  it('exige sessão', async () => {
    const res = await call(new Request(`${ORIGIN}/api/state`));
    expect(res.ok).toBe(false);
  });

  it('devolve os quatro blocos juntos, coerentes entre si', async () => {
    await env.DB.prepare(`insert into tags (id, name, color, owner_id) values ('tg-1', 'viagem', 'roxo', ?)`)
      .bind(alice.id)
      .run();
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'a1', status: 'queued', quando: emMinutos(60) });
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'a2', status: 'draft', quando: emMinutos(120) });

    const s = await estadoDe(alice);
    expect(s.accounts.map((a) => a.id)).toEqual([contaAlice]);
    expect(s.posts).toHaveLength(2);
    expect(s.tags.map((t) => t.name)).toEqual(['viagem']);
    // O resumo fala dos MESMOS dados que a agenda: mesma contagem, vinda da mesma varredura.
    expect(s.summary.por_status).toEqual({ queued: 1, draft: 1 });
  });

  it('o filtro de status recorta a agenda, mas não o resumo', async () => {
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'f1', status: 'queued', quando: emMinutos(60) });
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'f2', status: 'draft', quando: emMinutos(120) });

    const s = await estadoDe(alice, '?status=draft');
    // A agenda obedece o filtro, como /api/posts faria.
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0].targets[0].status).toBe('draft');
    // O resumo continua contando tudo: é a razão de ele existir no servidor (ver summary.test.ts).
    expect(s.summary.por_status).toEqual({ queued: 1, draft: 1 });
  });

  it('cada dono recebe só o seu estado', async () => {
    const bob = await register('bob@exemplo.com');
    const contaBob = await criarConta(bob.id, 'bob');
    await criarPost({ owner: bob.id, accountId: contaBob, tag: 'b1', status: 'published', quando: emMinutos(-60) });

    const s = await estadoDe(alice);
    expect(s.accounts.map((a) => a.id)).toEqual([contaAlice]);
    expect(s.posts).toEqual([]);
    expect(s.summary.por_status).toEqual({});
  });

  it('banco vazio devolve os quatro blocos com estrutura completa, não erro', async () => {
    const s = await estadoDe(alice);
    expect(s.accounts).toHaveLength(1);
    expect(s.posts).toEqual([]);
    expect(s.tags).toEqual([]);
    expect(s.summary.proximos).toEqual([]);
  });
});
