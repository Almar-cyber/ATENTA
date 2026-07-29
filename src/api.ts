import { adapters } from './adapters/index.js';
import { nowIso, rowToMediaAsset } from './lib/db.js';
import type { Env } from './lib/env.js';
import type { MediaAsset, Platform, PostTarget } from './lib/types.js';

const PLATFORMS: readonly Platform[] = ['youtube', 'linkedin', 'instagram', 'facebook', 'pinterest', 'tiktok'];
const MAX_POSTS_LIMIT = 300;

export async function handleApiRequest(request: Request, url: URL, env: Env): Promise<Response> {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/accounts' && method === 'GET') return listAccounts(env);
  if (pathname === '/api/posts' && method === 'GET') return listPosts(url, env);
  if (pathname === '/api/posts' && method === 'POST') return createPost(request, env);
  if (pathname === '/api/media' && method === 'POST') return uploadMedia(request, env);

  const cancelMatch = /^\/api\/post-targets\/([^/]+)\/cancel$/.exec(pathname);
  if (cancelMatch && method === 'POST') return cancelTarget(cancelMatch[1], env);

  const queueMatch = /^\/api\/post-targets\/([^/]+)\/queue$/.exec(pathname);
  if (queueMatch && method === 'POST') return queueTarget(queueMatch[1], env);

  return jsonResponse({ error: 'not found' }, 404);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function listAccounts(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `select id, platform, display_name, status, extra from accounts order by platform asc`
  ).all<{ id: string; platform: string; display_name: string; status: string; extra: string }>();

  const accounts = (results ?? []).map((r) => ({
    id: r.id,
    platform: r.platform,
    display_name: r.display_name,
    status: r.status,
    extra: JSON.parse(r.extra || '{}'),
  }));

  return jsonResponse({ accounts });
}

interface PostTargetRow {
  post_id: string;
  title: string | null;
  body: string | null;
  scheduled_for: string;
  created_at: string;
  target_id: string;
  platform: string;
  status: string;
  caption_override: string | null;
  options: string;
  external_url: string | null;
  external_post_id: string | null;
  attempt_count: number;
  last_error: string | null;
  published_at: string | null;
  updated_at: string;
  account_id: string;
  account_name: string;
}

async function listPosts(url: URL, env: Env): Promise<Response> {
  const statusFilter = url.searchParams.get('status');
  const platformFilter = url.searchParams.get('platform');
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100, MAX_POSTS_LIMIT);

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (statusFilter) {
    conditions.push('pt.status = ?');
    params.push(statusFilter);
  }
  if (platformFilter) {
    conditions.push('pt.platform = ?');
    params.push(platformFilter);
  }
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

  const { results } = await env.DB.prepare(
    `select sp.id as post_id, sp.title, sp.body, sp.scheduled_for, sp.created_at,
            pt.id as target_id, pt.platform, pt.status, pt.caption_override, pt.options,
            pt.external_url, pt.external_post_id, pt.attempt_count, pt.last_error, pt.published_at, pt.updated_at,
            a.id as account_id, a.display_name as account_name
     from post_targets pt
     join scheduled_posts sp on sp.id = pt.scheduled_post_id
     join accounts a on a.id = pt.account_id
     ${where}
     order by sp.scheduled_for desc
     limit ?`
  )
    .bind(...params, limit)
    .all<PostTargetRow>();

  const rows = results ?? [];
  const mediaByTarget = await getMediaByTargetIds(
    env,
    rows.map((r) => r.target_id)
  );

  const postsById = new Map<
    string,
    {
      id: string;
      title: string | null;
      body: string | null;
      scheduled_for: string;
      created_at: string;
      targets: unknown[];
    }
  >();

  for (const row of rows) {
    if (!postsById.has(row.post_id)) {
      postsById.set(row.post_id, {
        id: row.post_id,
        title: row.title,
        body: row.body,
        scheduled_for: row.scheduled_for,
        created_at: row.created_at,
        targets: [],
      });
    }
    postsById.get(row.post_id)!.targets.push({
      id: row.target_id,
      platform: row.platform,
      account_id: row.account_id,
      account_name: row.account_name,
      status: row.status,
      caption_override: row.caption_override,
      options: JSON.parse(row.options || '{}'),
      external_url: row.external_url,
      external_post_id: row.external_post_id,
      attempt_count: row.attempt_count,
      last_error: row.last_error,
      published_at: row.published_at,
      updated_at: row.updated_at,
      media: mediaByTarget.get(row.target_id) ?? [],
    });
  }

  return jsonResponse({ posts: Array.from(postsById.values()) });
}

interface MediaByTargetRow {
  post_target_id: string;
  id: string;
  public_url: string | null;
  mime_type: string;
  storage_key: string;
}

async function getMediaByTargetIds(env: Env, targetIds: string[]): Promise<Map<string, MediaByTargetRow[]>> {
  const map = new Map<string, MediaByTargetRow[]>();
  if (targetIds.length === 0) return map;

  const placeholders = targetIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `select ptm.post_target_id, ma.id, ma.public_url, ma.mime_type, ma.storage_key
     from post_target_media ptm
     join media_assets ma on ma.id = ptm.media_asset_id
     where ptm.post_target_id in (${placeholders})
     order by ptm.position asc`
  )
    .bind(...targetIds)
    .all<MediaByTargetRow>();

  for (const r of results ?? []) {
    const list = map.get(r.post_target_id) ?? [];
    list.push(r);
    map.set(r.post_target_id, list);
  }
  return map;
}

interface CreatePostBody {
  title?: string;
  body?: string;
  scheduled_for?: string;
  target_account_ids?: string[];
  media_asset_id?: string;
  media_asset_ids?: string[];
  options?: Record<string, unknown>;
  youtube_privacy_status?: string;
  pinterest_board_id?: string;
  instagram_as_story?: boolean;
  save_as?: string;
}

interface AccountRow {
  id: string;
  platform: string;
  status: string;
}

async function createPost(request: Request, env: Env): Promise<Response> {
  let payload: CreatePostBody;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }

  if (!payload.body?.trim()) return jsonResponse({ error: 'Legenda (body) é obrigatória' }, 400);
  if (!payload.scheduled_for || Number.isNaN(Date.parse(payload.scheduled_for))) {
    return jsonResponse({ error: 'scheduled_for inválido' }, 400);
  }
  if (!Array.isArray(payload.target_account_ids) || payload.target_account_ids.length === 0) {
    return jsonResponse({ error: 'Selecione ao menos uma conta de destino' }, 400);
  }

  const accountIds = payload.target_account_ids;
  const { results: accountRows } = await env.DB.prepare(
    `select id, platform, status from accounts where id in (${accountIds.map(() => '?').join(',')})`
  )
    .bind(...accountIds)
    .all<AccountRow>();
  const accounts = accountRows ?? [];

  if (accounts.length !== accountIds.length) {
    return jsonResponse({ error: 'Uma ou mais contas não foram encontradas' }, 400);
  }
  const inactive = accounts.filter((a) => a.status !== 'active');
  if (inactive.length > 0) {
    return jsonResponse(
      { error: `Conta(s) inativa(s), precisa reautenticar: ${inactive.map((a) => a.platform).join(', ')}` },
      400
    );
  }

  // media_asset_ids is the carousel-capable form; media_asset_id is kept for single-media callers.
  // Order matters (it becomes post_target_media.position), so each id is fetched in turn rather
  // than with one IN (...) query, whose result order SQLite doesn't guarantee.
  const mediaIds = payload.media_asset_ids?.length ? payload.media_asset_ids : payload.media_asset_id ? [payload.media_asset_id] : [];
  // post_target_media's primary key is (post_target_id, media_asset_id, role), so the same asset
  // can't legally appear twice in one target — reject it here with a readable message instead of
  // letting the insert fail mid-loop.
  if (new Set(mediaIds).size !== mediaIds.length) {
    return jsonResponse({ error: 'a mesma mídia foi enviada mais de uma vez no carrossel' }, 400);
  }
  const media: MediaAsset[] = [];
  for (const mediaId of mediaIds) {
    const row = await env.DB.prepare(`select * from media_assets where id = ?`).bind(mediaId).first<any>();
    if (!row) return jsonResponse({ error: `media_asset_id não encontrado: ${mediaId}` }, 400);
    media.push(rowToMediaAsset(row));
  }

  const scheduledPostId = crypto.randomUUID();
  const ts = nowIso();
  const targetStatus = payload.save_as === 'draft' ? 'draft' : 'queued';
  const targetsToInsert: Array<{ id: string; account: AccountRow; options: Record<string, unknown> }> = [];

  // Reuse each adapter's own validate() so an impossible post (missing required video, missing
  // public_url, ...) is rejected here instead of silently failing at poller time. Drafts skip this
  // entirely — the point of a draft is capturing the idea before media/details are final.
  for (const account of accounts) {
    const platform = account.platform as Platform;
    if (!PLATFORMS.includes(platform)) return jsonResponse({ error: `plataforma desconhecida: ${platform}` }, 400);

    const options: Record<string, unknown> = { ...(payload.options ?? {}) };
    if (platform === 'youtube' && payload.youtube_privacy_status) {
      options.privacyStatus = payload.youtube_privacy_status;
    }
    if (platform === 'pinterest' && payload.pinterest_board_id) {
      options.board_id = payload.pinterest_board_id;
    }
    if (platform === 'instagram' && payload.instagram_as_story) {
      options.as_story = true;
    }

    if (targetStatus !== 'draft') {
      const fakeTarget: PostTarget = {
        id: '',
        scheduled_post_id: '',
        account_id: account.id,
        platform,
        status: 'draft',
        caption_override: null,
        options,
        adapter_state: {},
        external_post_id: null,
        external_url: null,
        attempt_count: 0,
        last_error: null,
        published_at: null,
        updated_at: ts,
      };
      try {
        // Each adapter's own message is already prefixed with its platform name (e.g. "youtube: ...").
        adapters[platform].validate(fakeTarget, media);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
    }

    targetsToInsert.push({ id: crypto.randomUUID(), account, options });
  }

  await env.DB.prepare(`insert into scheduled_posts (id, title, body, scheduled_for) values (?, ?, ?, ?)`)
    .bind(scheduledPostId, payload.title ?? null, payload.body, payload.scheduled_for)
    .run();

  for (const t of targetsToInsert) {
    await env.DB.prepare(
      `insert into post_targets (id, scheduled_post_id, account_id, platform, status, options) values (?, ?, ?, ?, ?, ?)`
    )
      .bind(t.id, scheduledPostId, t.account.id, t.account.platform, targetStatus, JSON.stringify(t.options))
      .run();

    for (let i = 0; i < media.length; i++) {
      await env.DB.prepare(
        `insert into post_target_media (post_target_id, media_asset_id, position, role) values (?, ?, ?, 'primary')`
      )
        .bind(t.id, media[i].id, i)
        .run();
    }
  }

  return jsonResponse({ id: scheduledPostId, target_count: targetsToInsert.length }, 201);
}

async function uploadMedia(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: 'esperado multipart/form-data com um campo "file"' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) return jsonResponse({ error: 'envie um arquivo no campo "file"' }, 400);

  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload';
  const storageKey = `${id}-${safeName}`;
  const bytes = await file.arrayBuffer();
  const mimeType = file.type || 'application/octet-stream';

  await env.MEDIA.put(storageKey, bytes, { httpMetadata: { contentType: mimeType } });

  const publicUrl = env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${storageKey}` : null;

  await env.DB.prepare(
    `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes) values (?, ?, ?, ?, ?)`
  )
    .bind(id, storageKey, publicUrl, mimeType, bytes.byteLength)
    .run();

  return jsonResponse({ id, storage_key: storageKey, public_url: publicUrl, mime_type: mimeType, size_bytes: bytes.byteLength }, 201);
}

async function cancelTarget(targetId: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `update post_targets set status = 'canceled', updated_at = ? where id = ? and status in ('draft','queued') returning id`
  )
    .bind(nowIso(), targetId)
    .all<{ id: string }>();

  if ((results?.length ?? 0) === 0) {
    return jsonResponse({ error: 'não é possível cancelar: já está publicando/publicado, ou o post não existe' }, 409);
  }
  return jsonResponse({ ok: true });
}

async function queueTarget(targetId: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `update post_targets set status = 'queued', updated_at = ? where id = ? and status = 'draft' returning id`
  )
    .bind(nowIso(), targetId)
    .all<{ id: string }>();

  if ((results?.length ?? 0) === 0) {
    return jsonResponse({ error: 'não é possível mover para a fila: não está mais em rascunho, ou o post não existe' }, 409);
  }
  return jsonResponse({ ok: true });
}
