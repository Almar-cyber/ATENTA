import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { resetDb } from './helpers.js';

// Testes de ISOLAÇÃO entre donos — a prova de que o multi-usuário não vaza dado (design-multiuser.md
// §3, Passo 2). Cada teste monta dois donos e pede, como A, um recurso de B: o esperado é sempre
// "não existe" (404/409/vazio), nunca o dado de B.
//
// Estes testes são o que separa "multi-tenant de verdade" de teatro de segurança: sem eles, um
// `where owner_id = ?` esquecido passa despercebido — a UI de um dono só continua funcionando.

const ORIGIN = 'https://atenta.omangue.co';

// O Cloudflare Access injeta este header; currentUser() o transforma no owner_id.
function asUser(email: string, path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), 'Cf-Access-Authenticated-User-Email': email },
  });
}

async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const ALICE = 'alice@exemplo.com';
const BOB = 'bob@exemplo.com';

/** Cria uma conta + um post publicado pertencentes a `owner`. Devolve os ids. */
async function seedOwner(owner: string, tag: string) {
  const accountId = `acc-${tag}`;
  // media_assets não tem dono (é conteúdo endereçado por uuid opaco) — cada seed cria o seu pra
  // satisfazer a FK de grid_previews.
  await env.DB.prepare(
    `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes) values (?, ?, '', 'image/jpeg', 1)`
  )
    .bind(`md-${tag}`, `k-${tag}`)
    .run();
  const postId = `sp-${tag}`;
  const targetId = `pt-${tag}`;
  await env.DB.prepare(
    `insert into accounts (id, platform, display_name, external_account_id, status, extra, owner_id)
     values (?, 'instagram', ?, ?, 'active', '{}', ?)`
  )
    .bind(accountId, `conta-${tag}`, `ext-${tag}`, owner)
    .run();
  await env.DB.prepare(
    `insert into scheduled_posts (id, title, body, scheduled_for, owner_id) values (?, '', ?, '2026-01-01T12:00:00Z', ?)`
  )
    .bind(postId, `segredo de ${tag}`, owner)
    .run();
  await env.DB.prepare(
    `insert into post_targets (id, scheduled_post_id, account_id, platform, status, options, adapter_state)
     values (?, ?, ?, 'instagram', 'draft', '{}', '{}')`
  )
    .bind(targetId, postId, accountId)
    .run();
  await env.DB.prepare(
    `insert into grid_previews (id, platform, media_asset_id, sort_at, owner_id) values (?, 'instagram', ?, '2026-01-01T12:00:00Z', ?)`
  )
    .bind(`gp-${tag}`, `md-${tag}`, owner)
    .run();
  return { accountId, postId, targetId, previewId: `gp-${tag}` };
}

describe('isolação entre donos', () => {
  let bob: Awaited<ReturnType<typeof seedOwner>>;

  beforeEach(async () => {
    await resetDb();
    await seedOwner(ALICE, 'alice');
    bob = await seedOwner(BOB, 'bob');
  });

  it('GET /api/accounts só devolve as contas do próprio dono', async () => {
    const res = await call(asUser(ALICE, '/api/accounts'));
    const body = (await res.json()) as { accounts: Array<{ id: string }> };
    expect(body.accounts.map((a) => a.id)).toEqual(['acc-alice']);
  });

  it('GET /api/posts não devolve posts de outro dono', async () => {
    const res = await call(asUser(ALICE, '/api/posts'));
    const body = (await res.json()) as { posts: Array<{ body: string }> };
    expect(JSON.stringify(body)).not.toContain('segredo de bob');
  });

  it('GET /api/metrics não devolve métricas de outro dono', async () => {
    await env.DB.prepare(
      `insert into post_metrics (id, post_target_id, external_post_id, platform, fetched_at, likes)
       values ('m-bob', 'pt-bob', 'x', 'instagram', '2026-01-02T12:00:00Z', 999)`
    ).run();
    await env.DB.prepare(`update post_targets set status = 'published', published_at = '2026-01-01T12:00:00Z' where id = 'pt-bob'`).run();
    const res = await call(asUser(ALICE, '/api/metrics'));
    const body = (await res.json()) as { metrics: unknown[] };
    expect(body.metrics).toHaveLength(0);
  });

  it('GET /api/metrics/followers não devolve contas de outro dono', async () => {
    const res = await call(asUser(ALICE, '/api/metrics/followers'));
    const body = (await res.json()) as { followers: Array<{ account_id: string }> };
    expect(body.followers.every((f) => f.account_id === 'acc-alice')).toBe(true);
  });

  it('GET /api/grid-previews não devolve prévias de outro dono', async () => {
    const res = await call(asUser(ALICE, '/api/grid-previews?platform=instagram'));
    const body = (await res.json()) as { previews: Array<{ id: string }> };
    expect(body.previews.map((p) => p.id)).not.toContain('gp-bob');
  });

  it('PATCH /api/posts/:id de outro dono é 404 e NÃO altera o dado', async () => {
    const res = await call(
      asUser(ALICE, `/api/posts/${bob.postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'invadido' }),
      })
    );
    expect(res.status).toBe(404);
    const row = await env.DB.prepare(`select body from scheduled_posts where id = ?`).bind(bob.postId).first<{ body: string }>();
    expect(row?.body).toBe('segredo de bob');
  });

  it('POST /api/posts mirando conta de outro dono é recusado', async () => {
    const res = await call(
      asUser(ALICE, '/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: 'tentando publicar na conta do bob',
          scheduled_for: '2026-06-01T12:00:00Z',
          target_account_ids: [bob.accountId],
        }),
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    const count = await env.DB.prepare(`select count(*) as n from post_targets where account_id = ?`)
      .bind(bob.accountId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1); // só o destino que o próprio seed criou
  });

  it('DELETE /api/post-targets/:id de outro dono é 404 e NÃO apaga', async () => {
    const res = await call(asUser(ALICE, `/api/post-targets/${bob.targetId}`, { method: 'DELETE' }));
    expect(res.status).toBe(404);
    const row = await env.DB.prepare(`select id from post_targets where id = ?`).bind(bob.targetId).first();
    expect(row).toBeTruthy();
  });

  it('POST /api/post-targets/:id/cancel de outro dono não muda o status', async () => {
    const res = await call(asUser(ALICE, `/api/post-targets/${bob.targetId}/cancel`, { method: 'POST' }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const row = await env.DB.prepare(`select status from post_targets where id = ?`).bind(bob.targetId).first<{ status: string }>();
    expect(row?.status).toBe('draft');
  });

  it('POST /api/post-targets/:id/queue de outro dono não muda o status', async () => {
    const res = await call(asUser(ALICE, `/api/post-targets/${bob.targetId}/queue`, { method: 'POST' }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const row = await env.DB.prepare(`select status from post_targets where id = ?`).bind(bob.targetId).first<{ status: string }>();
    expect(row?.status).toBe('draft');
  });

  it('DELETE /api/grid-previews/:id de outro dono é 404 e NÃO apaga', async () => {
    const res = await call(asUser(ALICE, `/api/grid-previews/${bob.previewId}`, { method: 'DELETE' }));
    expect(res.status).toBe(404);
    const row = await env.DB.prepare(`select id from grid_previews where id = ?`).bind(bob.previewId).first();
    expect(row).toBeTruthy();
  });

  it('POST /api/posts/reschedule não move posts de outro dono', async () => {
    const res = await call(
      asUser(ALICE, '/api/posts/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_ids: ['sp-alice', bob.postId] }),
      })
    );
    // Ou recusa, ou reordena só o que é da Alice — o post do Bob não pode mudar de horário.
    expect(res.status).toBeGreaterThanOrEqual(200);
    const row = await env.DB.prepare(`select scheduled_for from scheduled_posts where id = ?`)
      .bind(bob.postId)
      .first<{ scheduled_for: string }>();
    expect(row?.scheduled_for).toBe('2026-01-01T12:00:00Z');
  });

  it('GET /api/feed/:accountId de conta de outro dono é 404', async () => {
    const res = await call(asUser(ALICE, `/api/feed/${bob.accountId}`));
    expect(res.status).toBe(404);
  });
});
