import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { resetDb } from './helpers.js';

// "Quem comenta com você" (`post_comments` + `GET /api/accounts/:id/commenters`).
//
// A razão de existir como log bruto (uma linha por comentário, dedupada pela PK) em vez de um
// contador que soma a cada coleta: o mesmo post é revisitado várias vezes pela cadência de
// métricas, e se cada passagem SOMASSE os comentários lidos, o mesmo comentário contaria de novo
// a cada coleta. Os testes abaixo protegem exatamente esse invariante.

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

function como(user: { cookie: string }, path: string): Request {
  return new Request(`${ORIGIN}${path}`, { headers: { Cookie: user.cookie } });
}

interface Commenter {
  external_user_id: string;
  username: string | null;
  comentarios: number;
  desde: string;
  ultimo: string;
}

async function commenters(user: { cookie: string }, accountId: string): Promise<Commenter[]> {
  const res = await call(como(user, `/api/accounts/${accountId}/commenters`));
  expect(res.status).toBe(200);
  return ((await res.json()) as { commenters: Commenter[] }).commenters;
}

/** Insere uma linha de post_comments direto no banco — é o que o poller faria via insertPostComments. */
async function inserirComentario(opts: {
  id: string;
  postTargetId: string | null;
  accountId: string;
  userId: string;
  username?: string | null;
  createdAt: string;
}): Promise<void> {
  await env.DB.prepare(
    `insert or ignore into post_comments (id, post_target_id, account_id, external_user_id, username, created_at)
     values (?, ?, ?, ?, ?, ?)`
  )
    .bind(opts.id, opts.postTargetId, opts.accountId, opts.userId, opts.username ?? null, opts.createdAt)
    .run();
}

describe('quem comenta com você (post_comments)', () => {
  let alice: Awaited<ReturnType<typeof register>>;
  let contaAlice: string;
  let postId: string;
  let targetId: string;

  beforeEach(async () => {
    await resetDb();
    alice = await register('alice@exemplo.com');
    contaAlice = 'acc-alice';
    await env.DB.prepare(
      `insert into accounts (id, platform, display_name, external_account_id, status, extra, owner_id)
       values (?, 'instagram', 'conta-alice', 'ext-alice', 'active', '{}', ?)`
    )
      .bind(contaAlice, alice.id)
      .run();
    postId = 'sp-1';
    targetId = 'pt-1';
    await env.DB.prepare(`insert into scheduled_posts (id, title, body, scheduled_for, owner_id) values (?, '', 'post', '2026-01-01T00:00:00Z', ?)`)
      .bind(postId, alice.id)
      .run();
    await env.DB.prepare(
      `insert into post_targets (id, scheduled_post_id, account_id, platform, status, options, adapter_state)
       values (?, ?, ?, 'instagram', 'published', '{}', '{}')`
    )
      .bind(targetId, postId, contaAlice)
      .run();
  });

  it('exige sessão', async () => {
    const res = await call(new Request(`${ORIGIN}/api/accounts/${contaAlice}/commenters`));
    expect(res.ok).toBe(false);
  });

  it('a MESMA leitura do comentário (duas passagens da cadência) não dobra a contagem', async () => {
    // Primeira passagem do poller lê o comentário.
    await inserirComentario({ id: 'c1', postTargetId: targetId, accountId: contaAlice, userId: 'u1', username: 'maria', createdAt: '2026-01-02T10:00:00Z' });
    // A cadência revisita o mesmo post horas depois e lê o MESMO comentário de novo.
    await inserirComentario({ id: 'c1', postTargetId: targetId, accountId: contaAlice, userId: 'u1', username: 'maria', createdAt: '2026-01-02T10:00:00Z' });

    const lista = await commenters(alice, contaAlice);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ username: 'maria', comentarios: 1 });
  });

  it('agrega por autor, ordenado por quem comentou mais', async () => {
    await inserirComentario({ id: 'c1', postTargetId: targetId, accountId: contaAlice, userId: 'u-maria', username: 'maria', createdAt: '2026-01-01T10:00:00Z' });
    await inserirComentario({ id: 'c2', postTargetId: targetId, accountId: contaAlice, userId: 'u-maria', username: 'maria', createdAt: '2026-01-03T10:00:00Z' });
    await inserirComentario({ id: 'c3', postTargetId: targetId, accountId: contaAlice, userId: 'u-joao', username: 'joao', createdAt: '2026-01-02T10:00:00Z' });

    const lista = await commenters(alice, contaAlice);
    expect(lista.map((c) => c.username)).toEqual(['maria', 'joao']);
    expect(lista[0]).toMatchObject({ comentarios: 2, desde: '2026-01-01T10:00:00Z', ultimo: '2026-01-03T10:00:00Z' });
    expect(lista[1]).toMatchObject({ comentarios: 1 });
  });

  it('isolação: comentário de uma conta não aparece pro dono de outra', async () => {
    const bob = await register('bob@exemplo.com');
    await inserirComentario({ id: 'c1', postTargetId: targetId, accountId: contaAlice, userId: 'u1', username: 'maria', createdAt: '2026-01-01T10:00:00Z' });

    // Bob nem consegue perguntar pela conta da Alice — ela não é dele.
    const res = await call(como(bob, `/api/accounts/${contaAlice}/commenters`));
    expect(res.status).toBe(404);
  });

  it('apagar o post não apaga o comentário — a pessoa comentou de verdade', async () => {
    await inserirComentario({ id: 'c1', postTargetId: targetId, accountId: contaAlice, userId: 'u1', username: 'maria', createdAt: '2026-01-01T10:00:00Z' });

    await env.DB.prepare(`delete from post_targets where id = ?`).bind(targetId).run();

    const lista = await commenters(alice, contaAlice);
    expect(lista).toHaveLength(1);
    expect(lista[0].username).toBe('maria');

    const row = await env.DB.prepare(`select post_target_id from post_comments where id = 'c1'`).first<{ post_target_id: string | null }>();
    expect(row?.post_target_id).toBeNull();
  });

  it('sem nenhum comentário, devolve lista vazia — não erro', async () => {
    expect(await commenters(alice, contaAlice)).toEqual([]);
  });
});
