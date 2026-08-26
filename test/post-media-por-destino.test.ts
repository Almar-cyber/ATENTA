import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { installFakeAdapter, resetDb } from './helpers.js';
import type { MediaAsset } from '../src/lib/types.js';

// Mídia POR DESTINO (`target_media_asset_ids`): a mesma foto recortada numa proporção por rede —
// 4:5 no feed, 9:16 no Reel — dentro de UM post, em vez de um post por recorte.
//
// O que estes testes protegem: post_target_media SEMPRE foi por destino, mas o createPost gravava
// a mesma lista pra todos. O risco da mudança não é a feature nova e sim o caminho antigo — um
// post sem `target_media_asset_ids` tem que continuar gravando a lista compartilhada em todo
// destino, exatamente como antes.

const ORIGIN = 'https://atenta.omangue.co';
const DONO = 'dono@exemplo.com';

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const request = new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cf-Access-Authenticated-User-Email': DONO, ...(init.headers ?? {}) },
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function seedAccount(id: string, platform: string): Promise<string> {
  await env.DB.prepare(
    `insert into accounts (id, platform, display_name, external_account_id, status, extra, owner_id)
     values (?, ?, ?, ?, 'active', '{}', ?)`
  )
    .bind(id, platform, `conta ${platform}`, `ext-${id}`, DONO)
    .run();
  return id;
}

async function seedMedia(id: string): Promise<string> {
  await env.DB.prepare(
    `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes, width, height)
     values (?, ?, ?, 'image/jpeg', 1000, 1080, 1350)`
  )
    .bind(id, `k-${id}`, `https://cdn.exemplo.com/${id}.jpg`)
    .run();
  return id;
}

/** O que ficou gravado em post_target_media, por conta. */
async function mediaGravada(postId: string): Promise<Record<string, string[]>> {
  const { results } = await env.DB.prepare(
    `select pt.account_id, ptm.media_asset_id
       from post_targets pt
       join post_target_media ptm on ptm.post_target_id = pt.id
      where pt.scheduled_post_id = ?
      order by pt.account_id, ptm.position asc`
  )
    .bind(postId)
    .all<{ account_id: string; media_asset_id: string }>();

  const out: Record<string, string[]> = {};
  for (const r of results ?? []) (out[r.account_id] ??= []).push(r.media_asset_id);
  return out;
}

function agendar(payload: Record<string, unknown>): Promise<Response> {
  return call('/api/posts', {
    method: 'POST',
    body: JSON.stringify({ scheduled_for: '2026-09-01T12:00:00Z', ...payload }),
  });
}

describe('mídia por destino', () => {
  const restores: Array<() => void> = [];
  let igValidate: Array<{ media: MediaAsset[] }>;
  let fbValidate: Array<{ media: MediaAsset[] }>;

  beforeEach(async () => {
    await resetDb();
    await seedAccount('acc-ig', 'instagram');
    await seedAccount('acc-fb', 'facebook');
    await seedMedia('md-padrao');
    await seedMedia('md-reel');
    await seedMedia('md-extra');

    // Os adapters reais recusariam a mídia falsa por outros motivos (public_url, duração...); aqui
    // o que interessa é QUAL mídia cada plataforma recebe pra validar.
    const ig = installFakeAdapter('instagram');
    const fb = installFakeAdapter('facebook');
    igValidate = ig.spy.validateCalls;
    fbValidate = fb.spy.validateCalls;
    restores.push(ig.restore, fb.restore);
  });

  afterEach(() => {
    while (restores.length) restores.pop()!();
  });

  it('sem target_media_asset_ids, todo destino recebe a lista compartilhada (comportamento de antes)', async () => {
    const res = await agendar({
      body: 'legenda',
      target_account_ids: ['acc-ig', 'acc-fb'],
      media_asset_ids: ['md-padrao'],
    });
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();

    expect(await mediaGravada(id)).toEqual({ 'acc-fb': ['md-padrao'], 'acc-ig': ['md-padrao'] });
  });

  it('com recorte próprio, cada destino grava a sua mídia e quem ficou de fora usa a padrão', async () => {
    const res = await agendar({
      body: 'legenda',
      target_account_ids: ['acc-ig', 'acc-fb'],
      media_asset_ids: ['md-padrao'],
      target_media_asset_ids: { 'acc-ig': ['md-reel'] },
    });
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();

    expect(await mediaGravada(id)).toEqual({ 'acc-fb': ['md-padrao'], 'acc-ig': ['md-reel'] });
  });

  it('o validate() de cada plataforma julga a mídia DAQUELE destino, não a compartilhada', async () => {
    await agendar({
      body: 'legenda',
      target_account_ids: ['acc-ig', 'acc-fb'],
      media_asset_ids: ['md-padrao'],
      target_media_asset_ids: { 'acc-ig': ['md-reel'] },
    });

    expect(igValidate.map((c) => c.media.map((m) => m.id))).toEqual([['md-reel']]);
    expect(fbValidate.map((c) => c.media.map((m) => m.id))).toEqual([['md-padrao']]);
  });

  it('a ordem do carrossel é preservada por destino', async () => {
    const res = await agendar({
      body: 'legenda',
      target_account_ids: ['acc-ig'],
      target_media_asset_ids: { 'acc-ig': ['md-extra', 'md-padrao', 'md-reel'] },
    });
    expect(res.status).toBe(201);
    const { id } = await res.json<{ id: string }>();

    expect((await mediaGravada(id))['acc-ig']).toEqual(['md-extra', 'md-padrao', 'md-reel']);
  });

  it('post sem legenda e sem lista compartilhada vale, desde que algum destino traga mídia', async () => {
    const res = await agendar({
      body: '',
      target_account_ids: ['acc-ig'],
      target_media_asset_ids: { 'acc-ig': ['md-reel'] },
    });
    expect(res.status).toBe(201);
  });

  it('mapa de mídia por destino vazio não conta como conteúdo', async () => {
    const res = await agendar({
      body: '',
      target_account_ids: ['acc-ig'],
      target_media_asset_ids: { 'acc-ig': [] },
    });
    expect(res.status).toBe(400);
  });

  it('id inexistente no recorte de um destino é 400, e nada é gravado', async () => {
    const res = await agendar({
      body: 'legenda',
      target_account_ids: ['acc-ig', 'acc-fb'],
      media_asset_ids: ['md-padrao'],
      target_media_asset_ids: { 'acc-ig': ['md-que-nao-existe'] },
    });
    expect(res.status).toBe(400);

    const { results } = await env.DB.prepare(`select id from scheduled_posts`).all();
    expect(results ?? []).toHaveLength(0);
  });

  it('a mesma mídia repetida no recorte de um destino é 400', async () => {
    const res = await agendar({
      body: 'legenda',
      target_account_ids: ['acc-ig'],
      target_media_asset_ids: { 'acc-ig': ['md-reel', 'md-reel'] },
    });
    expect(res.status).toBe(400);
  });

  it('editar o post reescreve a mídia por destino', async () => {
    const criado = await agendar({
      body: 'legenda',
      target_account_ids: ['acc-ig', 'acc-fb'],
      media_asset_ids: ['md-padrao'],
    });
    const { id } = await criado.json<{ id: string }>();

    const res = await call(`/api/posts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        target_account_ids: ['acc-ig', 'acc-fb'],
        media_asset_ids: ['md-padrao'],
        target_media_asset_ids: { 'acc-fb': ['md-extra'] },
      }),
    });
    expect(res.status).toBe(200);

    expect(await mediaGravada(id)).toEqual({ 'acc-fb': ['md-extra'], 'acc-ig': ['md-padrao'] });
  });
});
