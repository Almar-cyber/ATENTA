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

async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/**
 * Cria uma conta DE VERDADE pelo /api/auth e devolve o id do usuário mais o cookie de sessão.
 *
 * Por que não falsificar a identidade: a versão anterior desta suíte injetava um header
 * (Cf-Access-Authenticated-User-Email) que o currentUser() lia. Quando a identidade passou a vir da
 * sessão, o header virou nada — e aí TODO teste "Alice não vê o recurso de Bob" passou por vazio,
 * porque ninguém era ninguém e todas as respostas vinham vazias. Um teste que passa quando a
 * autenticação inteira sai do ar não estava provando isolação. Sessão real fecha esse buraco.
 */
async function register(email: string): Promise<{ id: string; cookie: string }> {
  // Os testes rodam com o cadastro FECHADO, que é o padrão de produção — então cada conta precisa
  // do convite antes. Rodar a suíte em modo aberto esconderia uma quebra no portão de convite.
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
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('sign-up não devolveu cookie de sessão');
  return { id: body.user.id, cookie: setCookie.split(';')[0] };
}

function asUser(user: { cookie: string }, path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Cookie: user.cookie },
  });
}

/** Cria uma conta + um post publicado pertencentes a `owner`. Devolve os ids. */
async function seedOwner(owner: string, tag: string) {
  const accountId = `acc-${tag}`;
  // media_assets TEM dono desde a migração 0007 (é o que sustenta a cota por dono). O owner_id
  // precisa ser gravado aqui: sem ele a coluna cai no default 'owner' e as mídias dos dois donos
  // ficam indistinguíveis, o que faria os testes de mídia abaixo passarem sem provar nada.
  await env.DB.prepare(
    `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes, owner_id) values (?, ?, '', 'image/jpeg', 1, ?)`
  )
    .bind(`md-${tag}`, `k-${tag}`, owner)
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
  let alice: Awaited<ReturnType<typeof register>>;
  let bob: Awaited<ReturnType<typeof seedOwner>>;
  // O user.id do Bob, pra semear registros que precisam do dono direto (ex.: media_uploads).
  let bobUserId: string;

  beforeEach(async () => {
    await resetDb();
    // Duas contas de verdade; o owner_id de cada uma é o user.id que o better-auth gerou.
    alice = await register('alice@exemplo.com');
    const bobUser = await register('bob@exemplo.com');
    bobUserId = bobUser.id;
    await seedOwner(alice.id, 'alice');
    bob = await seedOwner(bobUser.id, 'bob');
  });

  // GUARDA DO ARNÊS. Todo teste abaixo é da forma "A não vê o recurso de B", e essa forma passa
  // sozinha quando ninguém está autenticado — foi assim que 12 destes 13 passaram por vazio depois
  // que a identidade saiu do header e foi pra sessão. Este teste afirma o POSITIVO: se a sessão
  // deixar de identificar Alice, ele quebra antes de qualquer outro e explica o motivo.
  it('a sessão identifica o dono (sem isso, os testes abaixo passam por vazio)', async () => {
    const res = await call(asUser(alice, '/api/accounts'));
    const body = (await res.json()) as { accounts: unknown[] };
    expect(body.accounts.length).toBeGreaterThan(0);

    // E sem cookie nenhum a API recusa — antes ela respondia lista vazia, o que era pior: uma
    // resposta 200 sem dado é indistinguível de "esse dono não tem nada".
    const anon = await call(new Request(`${ORIGIN}/api/accounts`));
    expect(anon.status).toBe(401);
  });

  it('GET /api/accounts só devolve as contas do próprio dono', async () => {
    const res = await call(asUser(alice, '/api/accounts'));
    const body = (await res.json()) as { accounts: Array<{ id: string }> };
    expect(body.accounts.map((a) => a.id)).toEqual(['acc-alice']);
  });

  it('DELETE /api/accounts/:id de outro dono é 404 e NÃO desconecta', async () => {
    const res = await call(asUser(alice, `/api/accounts/${bob.accountId}`, { method: 'DELETE' }));
    expect(res.status).toBe(404);
    // A asserção que importa: 404 mas token apagado seria pior que não recusar.
    const row = await env.DB.prepare(`select status from accounts where id = ?`).bind(bob.accountId).first<{ status: string }>();
    expect(row?.status).toBe('active');
  });

  it('POST import-history na conta de outro dono é 404 e não importa nada', async () => {
    const antes = await env.DB.prepare(`select count(*) as n from post_targets`).first<{ n: number }>();
    const res = await call(asUser(alice, `/api/accounts/${bob.accountId}/import-history`, { method: 'POST' }));
    expect(res.status).toBe(404);
    const depois = await env.DB.prepare(`select count(*) as n from post_targets`).first<{ n: number }>();
    expect(depois?.n).toBe(antes?.n);
  });

  it('GET /api/posts não devolve posts de outro dono', async () => {
    const res = await call(asUser(alice, '/api/posts'));
    const body = (await res.json()) as { posts: Array<{ body: string }> };
    expect(JSON.stringify(body)).toContain('segredo de alice'); // vê o próprio…
    expect(JSON.stringify(body)).not.toContain('segredo de bob'); // …e só o próprio
  });

  it('GET /api/metrics não devolve métricas de outro dono', async () => {
    await env.DB.prepare(
      `insert into post_metrics (id, post_target_id, external_post_id, platform, fetched_at, likes)
       values ('m-bob', 'pt-bob', 'x', 'instagram', '2026-01-02T12:00:00Z', 999)`
    ).run();
    await env.DB.prepare(`update post_targets set status = 'published', published_at = '2026-01-01T12:00:00Z' where id = 'pt-bob'`).run();
    const res = await call(asUser(alice, '/api/metrics'));
    const body = (await res.json()) as { metrics: unknown[] };
    expect(body.metrics).toHaveLength(0);
  });

  it('GET /api/metrics/followers não devolve contas de outro dono', async () => {
    const res = await call(asUser(alice, '/api/metrics/followers'));
    const body = (await res.json()) as { followers: Array<{ account_id: string }> };
    // every() sobre lista vazia é true: sem esta primeira linha, o teste passaria com zero contas.
    expect(body.followers.length).toBeGreaterThan(0);
    expect(body.followers.every((f) => f.account_id === 'acc-alice')).toBe(true);
  });

  it('GET /api/grid-previews não devolve prévias de outro dono', async () => {
    const res = await call(asUser(alice, '/api/grid-previews?platform=instagram'));
    const body = (await res.json()) as { previews: Array<{ id: string }> };
    expect(body.previews.map((p) => p.id)).toContain('gp-alice');
    expect(body.previews.map((p) => p.id)).not.toContain('gp-bob');
  });

  it('PATCH /api/posts/:id de outro dono é 404 e NÃO altera o dado', async () => {
    const res = await call(
      asUser(alice, `/api/posts/${bob.postId}`, {
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
      asUser(alice, '/api/posts', {
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
    const res = await call(asUser(alice, `/api/post-targets/${bob.targetId}`, { method: 'DELETE' }));
    expect(res.status).toBe(404);
    const row = await env.DB.prepare(`select id from post_targets where id = ?`).bind(bob.targetId).first();
    expect(row).toBeTruthy();
  });

  it('POST /api/post-targets/:id/cancel de outro dono não muda o status', async () => {
    const res = await call(asUser(alice, `/api/post-targets/${bob.targetId}/cancel`, { method: 'POST' }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const row = await env.DB.prepare(`select status from post_targets where id = ?`).bind(bob.targetId).first<{ status: string }>();
    expect(row?.status).toBe('draft');
  });

  it('POST /api/post-targets/:id/queue de outro dono não muda o status', async () => {
    const res = await call(asUser(alice, `/api/post-targets/${bob.targetId}/queue`, { method: 'POST' }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const row = await env.DB.prepare(`select status from post_targets where id = ?`).bind(bob.targetId).first<{ status: string }>();
    expect(row?.status).toBe('draft');
  });

  it('DELETE /api/grid-previews/:id de outro dono é 404 e NÃO apaga', async () => {
    const res = await call(asUser(alice, `/api/grid-previews/${bob.previewId}`, { method: 'DELETE' }));
    expect(res.status).toBe(404);
    const row = await env.DB.prepare(`select id from grid_previews where id = ?`).bind(bob.previewId).first();
    expect(row).toBeTruthy();
  });

  it('POST /api/posts/reschedule não move posts de outro dono', async () => {
    const res = await call(
      asUser(alice, '/api/posts/reschedule', {
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
    const res = await call(asUser(alice, `/api/feed/${bob.accountId}`));
    expect(res.status).toBe(404);
  });

  // MÍDIA. media_assets ganhou owner_id na migração 0007 (é ele que sustenta a cota por dono), mas
  // os dois caminhos abaixo nunca passaram a filtrar por ele.
  //
  // Os bytes REAIS vão pro bucket antes de cada teste, de propósito: sem o objeto no R2 a rota
  // devolveria 404 por "arquivo não está no bucket" e o teste passaria pelo motivo errado, sem
  // provar nada sobre autorização. Com o objeto presente, um 404 só pode vir do filtro por dono.
  describe('mídia de outro dono', () => {
    beforeEach(async () => {
      await env.MEDIA.put('k-bob', 'conteudo-secreto-do-bob');
    });

    it('GET /api/media/:id/bytes de outro dono é 404 e NÃO devolve os bytes', async () => {
      const res = await call(asUser(alice, '/api/media/md-bob/bytes'));
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('conteudo-secreto-do-bob');
    });

    // Upload em partes: só `start` e `complete` recebiam o dono; `part` recebia key+upload_id pela
    // query string e escrevia no bucket sem conferir nada. A tabela media_uploads (migração 0019)
    // é o que liga cada upload em andamento a quem o iniciou.
    it('PUT multipart/part num upload de outro dono é 404', async () => {
      await env.DB.prepare(
        `insert into media_uploads (storage_key, upload_id, owner_id, created_at) values ('k-do-bob', 'up-bob', ?, '2026-01-01T00:00:00Z')`
      )
        .bind(bobUserId)
        .run();

      const res = await call(
        asUser(alice, '/api/media/multipart/part?key=k-do-bob&upload_id=up-bob&part=1', {
          method: 'PUT',
          body: 'bytes da alice no upload do bob',
        })
      );
      expect(res.status).toBe(404);
    });

    it('POST multipart/complete num upload de outro dono é 404 e não cria media_asset', async () => {
      await env.DB.prepare(
        `insert into media_uploads (storage_key, upload_id, owner_id, created_at) values ('k-do-bob2', 'up-bob2', ?, '2026-01-01T00:00:00Z')`
      )
        .bind(bobUserId)
        .run();

      const res = await call(
        asUser(alice, '/api/media/multipart/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'md-roubada',
            storage_key: 'k-do-bob2',
            upload_id: 'up-bob2',
            parts: [{ part_number: 1, etag: 'x' }],
          }),
        })
      );
      expect(res.status).toBe(404);

      const criada = await env.DB.prepare(`select count(*) as n from media_assets where id = 'md-roubada'`).first<{ n: number }>();
      expect(criada?.n ?? 0).toBe(0);
    });

    it('POST /api/posts com media_asset_id de outro dono é recusado', async () => {
      // O campo é target_account_ids (não account_ids) e a mídia precisa de public_url: com
      // qualquer um dos dois errado a rota recusa ANTES de resolver a mídia, e o teste passaria
      // sem nunca ter exercitado a autorização. Já aconteceu ao escrever este próprio teste.
      await env.DB.prepare(`update media_assets set public_url = 'https://cdn.test/bob.jpg' where id = 'md-bob'`).run();

      const res = await call(
        asUser(alice, '/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_account_ids: ['acc-alice'],
            body: 'usando a arte do bob',
            scheduled_for: '2030-01-01T12:00:00Z',
            media_asset_ids: ['md-bob'],
          }),
        })
      );
      expect(res.status).toBe(400);

      // E o vínculo não pode ter sido gravado: um 400 que já inseriu não protege nada.
      const vinculo = await env.DB.prepare(
        `select count(*) as n from post_target_media where media_asset_id = 'md-bob'`
      ).first<{ n: number }>();
      expect(vinculo?.n ?? 0).toBe(0);
    });
  });
});
