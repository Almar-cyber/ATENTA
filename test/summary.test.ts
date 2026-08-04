import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { resetDb } from './helpers.js';

// O resumo do Painel (`GET /api/summary`).
//
// A razão de ele existir no servidor, e não ser somado no cliente a partir de /api/posts, é que
// aquela rota é filtrada por status e limitada a 300 linhas. Os testes abaixo cobrem justamente o
// que essa escolha compra: contagem exata por dono, e as duas regras de "está travado" — rascunho
// que ficou pra trás e fila que devia ter saído.

const ORIGIN = 'https://atenta.omangue.co';

/** Folga do `atrasados`, em minutos. Espelha ATRASO_TOLERADO_MS em src/api.ts. */
const TOLERANCIA_MIN = 30;

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

interface Resumo {
  por_status: Record<string, number>;
  atencao: { rascunhos_vencidos: number; atrasados: number };
  proximos: Array<{ target_id: string; scheduled_for: string; status: string; titulo: string | null; media: unknown }>;
}

async function resumoDe(user: { cookie: string }): Promise<Resumo> {
  const res = await call(new Request(`${ORIGIN}/api/summary`, { headers: { Cookie: user.cookie } }));
  expect(res.status).toBe(200);
  return (await res.json()) as Resumo;
}

/** Momento relativo a agora, em minutos (negativo = passado). */
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

/** Um post com um destino. Devolve o id do destino. */
async function criarPost(opts: {
  owner: string;
  accountId: string;
  tag: string;
  status: string;
  quando: string;
  body?: string;
}): Promise<string> {
  const postId = `sp-${opts.tag}`;
  const targetId = `pt-${opts.tag}`;
  await env.DB.prepare(
    `insert into scheduled_posts (id, title, body, scheduled_for, owner_id) values (?, '', ?, ?, ?)`
  )
    .bind(postId, opts.body ?? `post ${opts.tag}`, opts.quando, opts.owner)
    .run();
  await env.DB.prepare(
    `insert into post_targets (id, scheduled_post_id, account_id, platform, status, options, adapter_state)
     values (?, ?, ?, 'instagram', ?, '{}', '{}')`
  )
    .bind(targetId, postId, opts.accountId, opts.status)
    .run();
  return targetId;
}

describe('GET /api/summary', () => {
  let alice: Awaited<ReturnType<typeof register>>;
  let contaAlice: string;

  beforeEach(async () => {
    await resetDb();
    alice = await register('alice@exemplo.com');
    contaAlice = await criarConta(alice.id, 'alice');
  });

  it('exige sessão', async () => {
    const res = await call(new Request(`${ORIGIN}/api/summary`));
    expect(res.ok).toBe(false);
  });

  it('conta destinos por status, e só os do próprio dono', async () => {
    const bob = await register('bob@exemplo.com');
    const contaBob = await criarConta(bob.id, 'bob');

    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'a1', status: 'draft', quando: emMinutos(60) });
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'a2', status: 'queued', quando: emMinutos(120) });
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'a3', status: 'published', quando: emMinutos(-9999) });
    // Três posts do Bob, todos publicados: se o filtro por dono cair, o número da Alice muda.
    for (const t of ['b1', 'b2', 'b3']) {
      await criarPost({ owner: bob.id, accountId: contaBob, tag: t, status: 'published', quando: emMinutos(-9999) });
    }

    const daAlice = await resumoDe(alice);
    expect(daAlice.por_status).toEqual({ draft: 1, queued: 1, published: 1 });

    // E o contrário também: o Bob vê os dele, não os dela. Sem esta metade, o teste passaria com
    // uma consulta que devolvesse zero pra todo mundo.
    const doBob = await resumoDe(bob);
    expect(doBob.por_status).toEqual({ published: 3 });
  });

  it('marca como "ficou pra trás" o rascunho cuja data já passou — e não o futuro', async () => {
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'velho', status: 'draft', quando: emMinutos(-60) });
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'novo', status: 'draft', quando: emMinutos(60) });

    const r = await resumoDe(alice);
    expect(r.por_status.draft).toBe(2);
    expect(r.atencao.rascunhos_vencidos).toBe(1);
  });

  it('só chama de atrasado o que passou da tolerância — a varredura em curso não é alarme', async () => {
    // Dentro da folga: o cron roda a cada 10min, então isto é a varredura acontecendo agora.
    await criarPost({
      owner: alice.id,
      accountId: contaAlice,
      tag: 'recente',
      status: 'queued',
      quando: emMinutos(-(TOLERANCIA_MIN - 20)),
    });
    const dentro = await resumoDe(alice);
    expect(dentro.atencao.atrasados).toBe(0);

    // Além da folga: três varreduras se passaram sem publicar — aí sim é anomalia.
    await criarPost({
      owner: alice.id,
      accountId: contaAlice,
      tag: 'travado',
      status: 'queued',
      quando: emMinutos(-(TOLERANCIA_MIN + 10)),
    });
    const fora = await resumoDe(alice);
    expect(fora.atencao.atrasados).toBe(1);
  });

  it('rascunho vencido não conta como atrasado, nem vice-versa', async () => {
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'd', status: 'draft', quando: emMinutos(-500) });
    const r = await resumoDe(alice);
    expect(r.atencao.rascunhos_vencidos).toBe(1);
    expect(r.atencao.atrasados).toBe(0);
  });

  it('"sai a seguir" traz só o que vai sair de verdade, em ordem crescente', async () => {
    // Rascunho NUNCA publica, por mais que a data chegue — listá-lo aqui seria promessa falsa.
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'rascunho', status: 'draft', quando: emMinutos(5) });
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'ja-saiu', status: 'published', quando: emMinutos(30) });
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'cancelado', status: 'canceled', quando: emMinutos(40) });
    // Passado: já devia ter saído, então não é "a seguir" — quem cuida dele é `atrasados`.
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'passado', status: 'queued', quando: emMinutos(-90) });
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'depois', status: 'queued', quando: emMinutos(600) });
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'antes', status: 'queued', quando: emMinutos(60) });

    const r = await resumoDe(alice);
    expect(r.proximos.map((p) => p.target_id)).toEqual(['pt-antes', 'pt-depois']);
  });

  it('devolve a legenda e a capa de quem tem mídia, e null pra quem não tem', async () => {
    await env.DB.prepare(
      `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes)
       values ('md-1', 'k-1', 'https://cdn.exemplo/1.jpg', 'image/jpeg', 10)`
    ).run();
    const comMidia = await criarPost({
      owner: alice.id,
      accountId: contaAlice,
      tag: 'com-midia',
      status: 'queued',
      quando: emMinutos(30),
      body: 'legenda que aparece',
    });
    await env.DB.prepare(
      `insert into post_target_media (post_target_id, media_asset_id, position) values (?, 'md-1', 0)`
    )
      .bind(comMidia)
      .run();
    await criarPost({ owner: alice.id, accountId: contaAlice, tag: 'sem-midia', status: 'queued', quando: emMinutos(90) });

    const r = await resumoDe(alice);
    expect(r.proximos[0].titulo).toBe('legenda que aparece');
    expect(r.proximos[0].media).toMatchObject({ public_url: 'https://cdn.exemplo/1.jpg', mime_type: 'image/jpeg' });
    expect(r.proximos[1].media).toBeNull();
  });

  it('banco vazio devolve estrutura completa, não erro', async () => {
    const r = await resumoDe(alice);
    expect(r.por_status).toEqual({});
    expect(r.atencao).toEqual({ rascunhos_vencidos: 0, atrasados: 0 });
    expect(r.proximos).toEqual([]);
  });
});
