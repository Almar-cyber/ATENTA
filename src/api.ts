import { adapters } from './adapters/index.js';
import { nowIso, rowToAccount, rowToMediaAsset } from './lib/db.js';
import { getAccountTokens } from './lib/tokens.js';
import { fetchWithRetry } from './lib/http.js';
import { buildAuthUrl, isOAuthPlatform, OAUTH_CLIENT_ID_ENV } from './lib/oauth-urls.js';
import { encodeState, setStateCookie } from './lib/oauth-state.js';
import { currentUser } from './lib/identity.js';
import type { Env } from './lib/env.js';
import type { Account, MediaAsset, Platform, PostTarget } from './lib/types.js';

const PLATFORMS: readonly Platform[] = ['youtube', 'linkedin', 'instagram', 'facebook', 'pinterest', 'tiktok'];
const MAX_POSTS_LIMIT = 300;

// What the platforms actually ingest. Camera RAW (image/x-sony-arw, image/x-canon-cr2, ...) passes
// an `accept="image/*"` filter and uploads fine, but every platform rejects it at publish time —
// so it's refused here instead, where the error is still attached to the file you just picked.
const ALLOWED_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'video/mp4',
  'video/quicktime',
];

// Cota de armazenamento por dono. O R2 é o único recurso que sai do free tier (10 GB) conforme
// entram usuários — Workers e D1 têm folga de ordens de grandeza. 2 GB por dono deixa ~5 pessoas
// no free tier; ajuste conforme a conta comporte.
const MEDIA_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/** Bytes já ocupados por este dono no R2. */
async function usedBytes(owner: string, env: Env): Promise<number> {
  const row = await env.DB.prepare(`select coalesce(sum(size_bytes), 0) as total from media_assets where owner_id = ?`)
    .bind(owner)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/** Resposta 413 se este upload estourar a cota do dono; null se cabe. */
async function checkQuota(owner: string, incoming: number, env: Env): Promise<Response | null> {
  const used = await usedBytes(owner, env);
  if (used + incoming <= MEDIA_QUOTA_BYTES) return null;
  const gb = (n: number) => (n / 1024 / 1024 / 1024).toFixed(1).replace('.', ',');
  return jsonResponse(
    {
      error:
        `sem espaço: você já usa ${gb(used)} GB dos ${gb(MEDIA_QUOTA_BYTES)} GB disponíveis. ` +
        'Exclua posts antigos com mídia pesada pra liberar espaço.',
    },
    413
  );
}

export async function handleApiRequest(request: Request, url: URL, env: Env): Promise<Response> {
  const { pathname } = url;
  const method = request.method;
  // Dono de tudo que esta requisição ler ou escrever. Ponto único de entrada da identidade —
  // daqui pra baixo todo handler recebe `owner` e TODA query filtra por ele. Ver design-multiuser.md.
  const owner = currentUser(request, env);

  if (pathname === '/api/accounts' && method === 'GET') return listAccounts(owner, env);

  const connectMatch = /^\/api\/connect\/([^/]+)$/.exec(pathname);
  if (connectMatch && method === 'GET') return startConnect(connectMatch[1], url, owner, env);

  if (pathname === '/api/posts' && method === 'GET') return listPosts(url, owner, env);
  if (pathname === '/api/posts' && method === 'POST') return createPost(request, owner, env);
  if (pathname === '/api/posts/reschedule' && method === 'POST') return reschedulePosts(request, owner, env);
  if (pathname === '/api/media' && method === 'POST') return uploadMedia(request, owner, env);
  // Upload em partes: o navegador fatia o arquivo, então nem o limite de corpo da requisição
  // (100MB no plano free) nem a memória do Worker (128MB) são atingidos por vídeos grandes.
  if (pathname === '/api/media/multipart/start' && method === 'POST') return multipartStart(request, owner, env);
  if (pathname === '/api/media/multipart/part' && method === 'PUT') return multipartPart(request, url, env);
  if (pathname === '/api/media/multipart/complete' && method === 'POST') return multipartComplete(request, owner, env);

  // Feed real da conta conectada (busca AO VIVO na API da rede — as URLs de mídia do Instagram
  // expiram em dias, então guardar em cache no D1 renderia links quebrados).
  const feedMatch = /^\/api\/feed\/([^/]+)$/.exec(pathname);
  if (feedMatch && method === 'GET') return getAccountFeed(feedMatch[1], owner, env);

  // Bytes de uma mídia já no R2, servidos pela NOSSA origem. O domínio público do R2 é outro host
  // e sem CORS: uma imagem carregada de lá suja o canvas e o recorte no navegador quebra. Por aqui
  // é same-origin, então dá pra recortar mídia de post duplicado/editado igual a arquivo novo.
  const mediaBytesMatch = /^\/api\/media\/([^/]+)\/bytes$/.exec(pathname);
  if (mediaBytesMatch && method === 'GET') return getMediaBytes(mediaBytesMatch[1], env);

  // Métricas coletadas (Fase A, design-analytics.md): o snapshot mais recente por post publicado.
  if (pathname === '/api/metrics' && method === 'GET') return listMetrics(owner, env);
  // Seguidores por conta (mais recente + primeiro snapshot) — pro "novos seguidores".
  if (pathname === '/api/metrics/followers' && method === 'GET') return listFollowers(owner, env);
  // Série temporal de um destino (todos os snapshots, pro sparkline).
  const metricsSeriesMatch = /^\/api\/metrics\/([^/]+)$/.exec(pathname);
  if (metricsSeriesMatch && method === 'GET') return getMetricsSeries(metricsSeriesMatch[1], owner, env);

  // Prévias do planejador de grade (imagens sem post — só pra ver como o feed vai ficar).
  if (pathname === '/api/grid-previews' && method === 'GET') return listGridPreviews(url, owner, env);
  if (pathname === '/api/grid-previews' && method === 'POST') return createGridPreview(request, owner, env);
  const previewMatch = /^\/api\/grid-previews\/([^/]+)$/.exec(pathname);
  if (previewMatch && method === 'PATCH') return updateGridPreview(previewMatch[1], request, owner, env);
  if (previewMatch && method === 'DELETE') return deleteGridPreview(previewMatch[1], owner, env);

  const cancelMatch = /^\/api\/post-targets\/([^/]+)\/cancel$/.exec(pathname);
  if (cancelMatch && method === 'POST') return cancelTarget(cancelMatch[1], owner, env);

  const queueMatch = /^\/api\/post-targets\/([^/]+)\/queue$/.exec(pathname);
  if (queueMatch && method === 'POST') return queueTarget(queueMatch[1], owner, env);

  // Cancelado/falhou não é fim de linha: reativar devolve pra rascunho (não pra fila — a data
  // original já pode ter passado, e voltar direto pra fila publicaria na hora seguinte).
  const reactivateMatch = /^\/api\/post-targets\/([^/]+)\/reactivate$/.exec(pathname);
  if (reactivateMatch && method === 'POST') return reactivateTarget(reactivateMatch[1], owner, env);

  const deleteTargetMatch = /^\/api\/post-targets\/([^/]+)$/.exec(pathname);
  if (deleteTargetMatch && method === 'DELETE') return deleteTarget(deleteTargetMatch[1], owner, env);

  const updatePostMatch = /^\/api\/posts\/([^/]+)$/.exec(pathname);
  if (updatePostMatch && method === 'PATCH') return updatePost(updatePostMatch[1], request, owner, env);

  return jsonResponse({ error: 'not found' }, 404);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Início do fluxo de conexão pelo navegador: gera um nonce (guardado num cookie HttpOnly como CSRF),
// monta a URL de consentimento com redirect_uri = <origin>/oauth/callback/:platform e redireciona
// 302 pra plataforma. O botão "Conectar" do SPA só navega pra cá. Meta cobre Instagram + Facebook.
function startConnect(platform: string, url: URL, owner: string, env: Env): Response {
  if (!isOAuthPlatform(platform)) {
    return jsonResponse({ error: `conexão pelo app ainda não suportada para "${platform}"` }, 400);
  }
  const envVar = OAUTH_CLIENT_ID_ENV[platform];
  const clientId = String(env[envVar as keyof Env] ?? '');
  // Sem o secret, a plataforma recebe client_id vazio e devolve um erro críptico ("client_key")
  // na tela dela. Melhor falhar aqui e explicar o que falta configurar.
  if (!clientId) {
    return Response.redirect(`${url.origin}/?connect_error=${platform}&reason=missing_${envVar}`, 302);
  }
  const nonce = crypto.randomUUID();
  // o dono viaja no state: o callback OAuth roda sem sessão (vem da plataforma) e é ele que
  // decide de quem é a conta recém-conectada.
  const state = encodeState({ n: nonce, o: owner });
  const redirectUri = `${url.origin}/oauth/callback/${platform}`;
  const authUrl = buildAuthUrl(platform, { clientId, redirectUri, state });
  return new Response(null, { status: 302, headers: { Location: authUrl, 'Set-Cookie': setStateCookie(nonce) } });
}

async function listAccounts(owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `select id, platform, display_name, status, extra from accounts where owner_id = ? order by platform asc`
  )
    .bind(owner)
    .all<{ id: string; platform: string; display_name: string; status: string; extra: string }>();

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

async function listPosts(url: URL, owner: string, env: Env): Promise<Response> {
  const statusFilter = url.searchParams.get('status');
  const platformFilter = url.searchParams.get('platform');
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100, MAX_POSTS_LIMIT);

  // sp.owner_id é a primeira condição SEMPRE — os filtros de status/plataforma são opcionais,
  // o de dono não é.
  const conditions: string[] = ['sp.owner_id = ?'];
  const params: unknown[] = [owner];
  if (statusFilter) {
    conditions.push('pt.status = ?');
    params.push(statusFilter);
  }
  if (platformFilter) {
    conditions.push('pt.platform = ?');
    params.push(platformFilter);
  }
  const where = `where ${conditions.join(' and ')}`;

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
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
}

async function getMediaByTargetIds(env: Env, targetIds: string[]): Promise<Map<string, MediaByTargetRow[]>> {
  const map = new Map<string, MediaByTargetRow[]>();
  if (targetIds.length === 0) return map;

  const placeholders = targetIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `select ptm.post_target_id, ma.id, ma.public_url, ma.mime_type, ma.storage_key,
            ma.duration_seconds, ma.width, ma.height
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
  tiktok_privacy_level?: string;
  instagram_as_story?: boolean;
  /** 'post' | 'reel' | 'story' — escolhido no compositor. Substitui instagram_as_story, que
   *  continua aceito pra não quebrar chamadas antigas do CLI. */
  instagram_format?: string;
  cover_media_id?: string;
  cover_timestamp_ms?: number;
  save_as?: string;
  // Keyed by account_id; overrides the shared `body` for just that one target's caption.
  target_caption_overrides?: Record<string, string>;
}

// Same fields as CreatePostBody minus save_as — an edit never re-decides the initial
// draft/queued split (see updatePost's per-account status logic instead). Every field is
// optional and independently "only touch what's present" — see updatePost.
interface UpdatePostBody {
  title?: string;
  body?: string;
  scheduled_for?: string;
  target_account_ids?: string[];
  media_asset_id?: string;
  media_asset_ids?: string[];
  options?: Record<string, unknown>;
  youtube_privacy_status?: string;
  pinterest_board_id?: string;
  tiktok_privacy_level?: string;
  instagram_as_story?: boolean;
  /** 'post' | 'reel' | 'story' — escolhido no compositor. Substitui instagram_as_story, que
   *  continua aceito pra não quebrar chamadas antigas do CLI. */
  instagram_format?: string;
  cover_media_id?: string;
  cover_timestamp_ms?: number;
  target_caption_overrides?: Record<string, string>;
}

interface AccountRow {
  id: string;
  platform: string;
  status: string;
  extra: string;
}

// A target's status only ever starts life as one of these two (an update's newly-added account
// defaults to 'queued', matching what a non-draft createPost call would do) — every other
// PostTargetStatus is reached later, by the poller.
type NewTargetStatus = 'draft' | 'queued';

interface TargetToInsert {
  id: string;
  account: AccountRow;
  status: NewTargetStatus;
  options: Record<string, unknown>;
}

interface ValidateAccountsAndMediaParams {
  accountIds: string[] | undefined;
  mediaAssetId?: string;
  mediaAssetIds?: string[];
  options?: Record<string, unknown>;
  youtubePrivacyStatus?: string;
  pinterestBoardId?: string;
  tiktokPrivacyLevel?: string;
  instagramAsStory?: boolean;
  instagramFormat?: string;
  coverMediaId?: string;
  coverTimestampMs?: number;
  // Legenda canônica e título do post + overrides por conta, pra que o validate() de cada adapter
  // veja a MESMA legenda que o poller vai publicar (o poller resolve override ?? body). Sem isso, a
  // validação rodava com legenda vazia e um guard de "post só-texto precisa de legenda" nunca dispararia.
  body?: string;
  title?: string;
  captionOverrides?: Record<string, string>;
  // createPost uses one status for every target (from save_as); updatePost's full-replace uses a
  // per-account status (from each target's OLD status) — so the caller decides, not this helper.
  getTargetStatus: (accountId: string) => NewTargetStatus;
}

type ValidateAccountsAndMediaResult =
  | { ok: true; media: MediaAsset[]; targets: TargetToInsert[] }
  | { ok: false; response: Response };

// Shared by createPost and updatePost's full-replace branch: validate the target accounts exist
// and are active, validate the requested media exists with no duplicates, then — per target —
// merge platform-specific options and run the adapter's own validate() (skipped for drafts, same
// as createPost always did). Returns either the built target list or the 400 Response to send
// back verbatim; callers must not perform any DB write before checking `ok`.
async function validateAccountsAndMedia(env: Env, owner: string, params: ValidateAccountsAndMediaParams): Promise<ValidateAccountsAndMediaResult> {
  if (!Array.isArray(params.accountIds) || params.accountIds.length === 0) {
    return { ok: false, response: jsonResponse({ error: 'Selecione ao menos uma conta de destino' }, 400) };
  }
  const accountIds = params.accountIds;

  const { results: accountRows } = await env.DB.prepare(
    // `and owner_id = ?` é o que impede agendar um post mirando a conta de OUTRO dono: ids que
    // não são dele simplesmente não voltam, e o length check abaixo recusa a requisição.
    `select id, platform, status, extra from accounts where id in (${accountIds.map(() => '?').join(',')}) and owner_id = ?`
  )
    .bind(...accountIds, owner)
    .all<AccountRow>();
  const accounts = accountRows ?? [];

  if (accounts.length !== accountIds.length) {
    return { ok: false, response: jsonResponse({ error: 'Uma ou mais contas não foram encontradas' }, 400) };
  }
  const inactive = accounts.filter((a) => a.status !== 'active');
  if (inactive.length > 0) {
    return {
      ok: false,
      response: jsonResponse(
        { error: `Conta(s) inativa(s), precisa reautenticar: ${inactive.map((a) => a.platform).join(', ')}` },
        400
      ),
    };
  }

  // media_asset_ids is the carousel-capable form; media_asset_id is kept for single-media callers.
  // Order matters (it becomes post_target_media.position), so each id is fetched in turn rather
  // than with one IN (...) query, whose result order SQLite doesn't guarantee.
  const mediaIds = params.mediaAssetIds?.length ? params.mediaAssetIds : params.mediaAssetId ? [params.mediaAssetId] : [];
  // post_target_media's primary key is (post_target_id, media_asset_id, role), so the same asset
  // can't legally appear twice in one target — reject it here with a readable message instead of
  // letting the insert fail mid-loop.
  if (new Set(mediaIds).size !== mediaIds.length) {
    return { ok: false, response: jsonResponse({ error: 'a mesma mídia foi enviada mais de uma vez no carrossel' }, 400) };
  }
  const media: MediaAsset[] = [];
  for (const mediaId of mediaIds) {
    const row = await env.DB.prepare(`select * from media_assets where id = ?`).bind(mediaId).first<any>();
    if (!row) return { ok: false, response: jsonResponse({ error: `media_asset_id não encontrado: ${mediaId}` }, 400) };
    media.push(rowToMediaAsset(row));
  }

  const ts = nowIso();
  const targets: TargetToInsert[] = [];

  // Reuse each adapter's own validate() so an impossible post (missing required video, missing
  // public_url, ...) is rejected here instead of silently failing at poller time. Drafts skip this
  // entirely — the point of a draft is capturing the idea before media/details are final.
  for (const account of accounts) {
    const platform = account.platform as Platform;
    if (!PLATFORMS.includes(platform)) {
      return { ok: false, response: jsonResponse({ error: `plataforma desconhecida: ${platform}` }, 400) };
    }

    const options: Record<string, unknown> = { ...(params.options ?? {}) };
    if (platform === 'youtube' && params.youtubePrivacyStatus) {
      options.privacyStatus = params.youtubePrivacyStatus;
    }
    if (platform === 'pinterest' && params.pinterestBoardId) {
      options.board_id = params.pinterestBoardId;
    }
    if (platform === 'tiktok' && params.tiktokPrivacyLevel) {
      options.privacy_level = params.tiktokPrivacyLevel;
    }
    if (platform === 'instagram') {
      // O formato define o media_type do container (VIDEO / REELS / STORIES). `as_story` fica
      // gravado junto só pra compatibilidade com o que lê o campo antigo.
      const format = params.instagramFormat ?? (params.instagramAsStory ? 'story' : undefined);
      if (format) {
        options.format = format;
        if (format === 'story') options.as_story = true;
      }
    }
    // Capa do vídeo. YouTube e Instagram aceitam uma IMAGEM própria; o TikTok só deixa escolher um
    // frame do próprio vídeo (timestamp). Guarda os dois e cada adapter usa o que sua API suporta.
    if (params.coverMediaId && (platform === 'youtube' || platform === 'instagram')) {
      options.cover_media_id = params.coverMediaId;
    }
    if (params.coverTimestampMs != null && (platform === 'tiktok' || platform === 'instagram')) {
      options.cover_timestamp_ms = params.coverTimestampMs;
    }

    const status = params.getTargetStatus(account.id);
    if (status !== 'draft') {
      const fakeTarget: PostTarget = {
        id: '',
        scheduled_post_id: '',
        account_id: account.id,
        platform,
        status: 'draft',
        // Mesma resolução do poller (override do destino ?? legenda canônica), pra o validate()
        // enxergar a legenda real. `|| null` normaliza string vazia pra null.
        caption_override: params.captionOverrides?.[account.id] || params.body || null,
        title: params.title ?? null,
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
        // O validate() do Pinterest lê account.extra.default_board_id, então precisa de uma conta
        // com o extra parseado — não só o AccountRow leve. Os outros adapters ignoram a conta.
        const fakeAccount = { ...account, extra: JSON.parse(account.extra || '{}') } as unknown as Account;
        adapters[platform].validate(fakeTarget, media, fakeAccount);
      } catch (err) {
        return { ok: false, response: jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400) };
      }
    }

    targets.push({ id: crypto.randomUUID(), account, status, options });
  }

  return { ok: true, media, targets };
}

// Shared by createPost and updatePost's full-replace branch: insert one post_targets row per
// validated target plus its post_target_media rows, in the same two-level loop createPost always
// used. Assumes scheduledPostId already exists as a row in scheduled_posts.
async function insertTargets(
  env: Env,
  scheduledPostId: string,
  targets: TargetToInsert[],
  media: MediaAsset[],
  captionOverrides: Record<string, string> | undefined
): Promise<void> {
  for (const t of targets) {
    await env.DB.prepare(
      `insert into post_targets (id, scheduled_post_id, account_id, platform, status, options, caption_override) values (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        t.id,
        scheduledPostId,
        t.account.id,
        t.account.platform,
        t.status,
        JSON.stringify(t.options),
        captionOverrides?.[t.account.id] ?? null
      )
      .run();

    for (let i = 0; i < media.length; i++) {
      await env.DB.prepare(
        `insert into post_target_media (post_target_id, media_asset_id, position, role) values (?, ?, ?, 'primary')`
      )
        .bind(t.id, media[i].id, i)
        .run();
    }
  }
}

async function createPost(request: Request, owner: string, env: Env): Promise<Response> {
  let payload: CreatePostBody;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }

  // Legenda NÃO é obrigatória: Instagram publica sem legenda e Story sequer a exibe. O que não faz
  // sentido é um post vazio — então exige conteúdo: legenda OU mídia.
  const hasMediaOnCreate = (payload.media_asset_ids?.length ?? 0) > 0 || !!payload.media_asset_id;
  if (!payload.body?.trim() && !hasMediaOnCreate) {
    return jsonResponse({ error: 'Escreva uma legenda ou anexe um arquivo' }, 400);
  }
  if (!payload.scheduled_for || Number.isNaN(Date.parse(payload.scheduled_for))) {
    return jsonResponse({ error: 'scheduled_for inválido' }, 400);
  }

  const targetStatus: NewTargetStatus = payload.save_as === 'draft' ? 'draft' : 'queued';

  const result = await validateAccountsAndMedia(env, owner, {
    accountIds: payload.target_account_ids,
    mediaAssetId: payload.media_asset_id,
    mediaAssetIds: payload.media_asset_ids,
    options: payload.options,
    youtubePrivacyStatus: payload.youtube_privacy_status,
    pinterestBoardId: payload.pinterest_board_id,
    tiktokPrivacyLevel: payload.tiktok_privacy_level,
    instagramAsStory: payload.instagram_as_story,
    coverMediaId: payload.cover_media_id,
    coverTimestampMs: payload.cover_timestamp_ms,
    body: payload.body,
    title: payload.title,
    captionOverrides: payload.target_caption_overrides,
    getTargetStatus: () => targetStatus,
  });
  if (!result.ok) return result.response;

  const scheduledPostId = crypto.randomUUID();
  await env.DB.prepare(`insert into scheduled_posts (id, title, body, scheduled_for, owner_id) values (?, ?, ?, ?, ?)`)
    .bind(scheduledPostId, payload.title ?? null, payload.body, payload.scheduled_for, owner)
    .run();

  await insertTargets(env, scheduledPostId, result.targets, result.media, payload.target_caption_overrides);

  return jsonResponse({ id: scheduledPostId, target_count: result.targets.length }, 201);
}

async function updatePost(id: string, request: Request, owner: string, env: Env): Promise<Response> {
  let payload: UpdatePostBody;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }

  // Pure shape validation before any DB access, same as createPost — and, importantly, before any
  // DB write below, so a bad date can never be discovered only after the full-replace branch has
  // already deleted/inserted post_targets (which would leave the edit half-applied).
  if (payload.scheduled_for !== undefined && (!payload.scheduled_for || Number.isNaN(Date.parse(payload.scheduled_for)))) {
    return jsonResponse({ error: 'scheduled_for inválido' }, 400);
  }
  // Mesma regra do createPost: limpar a legenda é permitido desde que sobre mídia — o que não pode
  // é o post ficar sem nada.
  const hasMediaOnUpdate = (payload.media_asset_ids?.length ?? 0) > 0 || !!payload.media_asset_id;
  if (payload.body !== undefined && !payload.body.trim() && !hasMediaOnUpdate) {
    return jsonResponse({ error: 'Escreva uma legenda ou anexe um arquivo' }, 400);
  }

  const post = await env.DB.prepare(`select id from scheduled_posts where id = ? and owner_id = ?`)
    .bind(id, owner)
    .first<{ id: string }>();
  if (!post) return jsonResponse({ error: 'post não encontrado' }, 404);

  // Guard applies to every PATCH, not just the full-replace branch below: the moment any target
  // moves past 'queued' (publishing/processing/published/failed/canceled/ambiguous) the whole post
  // locks. No partial/per-target editing — real complexity for near-zero benefit in a solo-user app.
  const { results: targetRows } = await env.DB.prepare(`select account_id, status from post_targets where scheduled_post_id = ?`)
    .bind(id)
    .all<{ account_id: string; status: string }>();
  const existingTargets = targetRows ?? [];

  // Editável enquanto nada foi publicado de fato. Cancelado e falhou entram aqui de propósito: é
  // justamente o caso de reaproveitar a peça (mudar a data, corrigir o que quebrou) em vez de
  // refazer do zero. Publicando/processando/publicado seguem trancados.
  const EDITABLE = new Set(['draft', 'queued', 'canceled', 'failed']);
  const locked = existingTargets.some((t) => !EDITABLE.has(t.status));
  if (locked) {
    return jsonResponse({ error: 'não é possível editar: um ou mais destinos já estão publicando/publicados' }, 409);
  }

  // target_account_ids present signals "full replace": the caller is editing accounts/media/
  // options, not just nudging the date, so every target is validated and rebuilt from scratch.
  if (payload.target_account_ids !== undefined) {
    // Um destino que estava cancelado/falho volta como RASCUNHO, nunca direto pra fila: a data
    // que ele carregava já pode ter passado, e aí o poller publicaria no minuto seguinte à edição.
    const oldStatusMap = new Map<string, NewTargetStatus>();
    for (const t of existingTargets) {
      oldStatusMap.set(t.account_id, t.status === 'draft' || t.status === 'queued' ? (t.status as NewTargetStatus) : 'draft');
    }

    const result = await validateAccountsAndMedia(env, owner, {
      accountIds: payload.target_account_ids,
      mediaAssetId: payload.media_asset_id,
      mediaAssetIds: payload.media_asset_ids,
      options: payload.options,
      youtubePrivacyStatus: payload.youtube_privacy_status,
      pinterestBoardId: payload.pinterest_board_id,
      tiktokPrivacyLevel: payload.tiktok_privacy_level,
      instagramAsStory: payload.instagram_as_story,
      instagramFormat: payload.instagram_format,
      coverMediaId: payload.cover_media_id,
      coverTimestampMs: payload.cover_timestamp_ms,
      body: payload.body,
      title: payload.title,
      captionOverrides: payload.target_caption_overrides,
      // An account not previously targeted (newly added during this edit) defaults to 'queued' —
      // matching what a non-draft createPost call would do.
      getTargetStatus: (accountId) => oldStatusMap.get(accountId) ?? 'queued',
    });
    if (!result.ok) return result.response;

    // Cascades to post_target_media (ON DELETE CASCADE — migrations/0001_init.sql), so the fresh
    // insert below starts from a clean slate instead of trying to diff old vs new media rows.
    await env.DB.prepare(`delete from post_targets where scheduled_post_id = ?`).bind(id).run();
    await insertTargets(env, id, result.targets, result.media, payload.target_caption_overrides);
  }

  // D1 bind semantics have no clean "leave this column alone if it wasn't sent" (a plain
  // `set title = coalesce(?, title)` would need a real NULL-vs-absent distinction we don't have),
  // so the SET clause is built dynamically from whichever fields actually showed up in the
  // payload — the same approach listPosts already uses for its WHERE clause.
  const setClauses: string[] = [];
  const setParams: unknown[] = [];
  if (payload.title !== undefined) {
    setClauses.push('title = ?');
    setParams.push(payload.title);
  }
  if (payload.body !== undefined) {
    setClauses.push('body = ?');
    setParams.push(payload.body);
  }
  if (payload.scheduled_for !== undefined) {
    setClauses.push('scheduled_for = ?');
    setParams.push(payload.scheduled_for);
  }
  if (setClauses.length > 0) {
    setClauses.push('updated_at = ?');
    setParams.push(nowIso());
    await env.DB.prepare(`update scheduled_posts set ${setClauses.join(', ')} where id = ? and owner_id = ?`)
      .bind(...setParams, id, owner)
      .run();
  }

  return jsonResponse({ ok: true });
}

interface RescheduleBody {
  // scheduled_post ids in their NEW visual order; they get the same set of scheduled_for
  // timestamps those posts already had, reassigned so the first id takes the earliest slot, etc.
  // This is how the Instagram grid drag-and-drop reorders posts without inventing new times.
  ordered_post_ids?: string[];
}

async function reschedulePosts(request: Request, owner: string, env: Env): Promise<Response> {
  let payload: RescheduleBody;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const ids = payload.ordered_post_ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return jsonResponse({ error: 'ordered_post_ids é obrigatório' }, 400);
  }

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `select id, scheduled_for from scheduled_posts where id in (${placeholders}) and owner_id = ?`
  )
    .bind(...ids, owner)
    .all<{ id: string; scheduled_for: string }>();
  const rows = results ?? [];

  if (rows.length !== ids.length) {
    return jsonResponse({ error: 'um ou mais posts não foram encontrados' }, 400);
  }

  // The pool of timestamps is exactly the ones these posts already hold, sorted ascending; the
  // i-th id in the requested order gets the i-th earliest timestamp. So dragging only ever
  // permutes existing slots — it never creates a brand-new time or leaves a gap.
  const slots = rows.map((r) => r.scheduled_for).sort();
  const ts = nowIso();
  for (let i = 0; i < ids.length; i++) {
    await env.DB.prepare(`update scheduled_posts set scheduled_for = ?, updated_at = ? where id = ? and owner_id = ?`)
      .bind(slots[i], ts, ids[i], owner)
      .run();
  }

  return jsonResponse({ ok: true, reordered: ids.length });
}

async function uploadMedia(request: Request, owner: string, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: 'esperado multipart/form-data com um campo "file"' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) return jsonResponse({ error: 'envie um arquivo no campo "file"' }, 400);

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return jsonResponse(
      {
        error:
          `formato não suportado em "${file.name}" (${file.type || 'tipo desconhecido'}). ` +
          'As plataformas aceitam JPEG, PNG, MP4 e MOV — RAW de câmera (.ARW, .CR2, .NEF) precisa ser exportado antes.',
      },
      400
    );
  }

  // Cota antes de gravar: recusar depois de subir os bytes desperdiça banda e deixa lixo no R2.
  const overQuota = await checkQuota(owner, file.size, env);
  if (overQuota) return overQuota;

  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload';
  const storageKey = `${id}-${safeName}`;
  const bytes = await file.arrayBuffer();
  const mimeType = file.type || 'application/octet-stream';

  // Client-measured (via <video>/createImageBitmap) — best-effort, so a missing/unparsable
  // value is just left null rather than rejected.
  const durationSeconds = parseOptionalFloat(form.get('duration_seconds'));
  const width = parseOptionalInt(form.get('width'));
  const height = parseOptionalInt(form.get('height'));

  await env.MEDIA.put(storageKey, bytes, { httpMetadata: { contentType: mimeType } });

  const publicUrl = env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${storageKey}` : null;

  await env.DB.prepare(
    `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes, duration_seconds, width, height, owner_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, storageKey, publicUrl, mimeType, bytes.byteLength, durationSeconds, width, height, owner)
    .run();

  return jsonResponse(
    {
      id,
      storage_key: storageKey,
      public_url: publicUrl,
      mime_type: mimeType,
      size_bytes: bytes.byteLength,
      duration_seconds: durationSeconds,
      width,
      height,
    },
    201
  );
}

export interface FeedItem {
  id: string;
  thumbnail_url: string | null;
  permalink: string | null;
  caption: string | null;
  published_at: string | null;
  is_video: boolean;
}

// Busca os posts já publicados na conta, pra o planejador de grade mostrar o feed real ao lado do
// que está agendado. Só Instagram e YouTube: são as redes com escopo de leitura já concedido e
// cujo perfil tem uma estética de grade/lista que valha planejar.
async function getAccountFeed(accountId: string, owner: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(`select * from accounts where id = ? and owner_id = ?`)
    .bind(accountId, owner)
    .first<any>();
  if (!row) return jsonResponse({ error: 'conta não encontrada' }, 404);
  const account = rowToAccount(row);

  try {
    if (account.platform === 'instagram') return jsonResponse({ items: await fetchInstagramFeed(account, env) });
    if (account.platform === 'youtube') return jsonResponse({ items: await fetchYoutubeFeed(account, env) });
    return jsonResponse({ items: [], unsupported: true });
  } catch (err) {
    // Feed é um extra: se a plataforma recusar, o grid segue mostrando os agendados.
    return jsonResponse({ items: [], error: err instanceof Error ? err.message : String(err) }, 200);
  }
}

async function fetchInstagramFeed(account: Account, env: Env): Promise<FeedItem[]> {
  const tokens = await getAccountTokens<{ access_token: string }>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
  if (!tokens?.access_token || !account.external_account_id) return [];
  const url =
    `https://graph.facebook.com/v21.0/${account.external_account_id}/media` +
    `?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp,caption&limit=24` +
    `&access_token=${encodeURIComponent(tokens.access_token)}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`instagram feed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as {
    data?: Array<{
      id: string;
      media_type?: string;
      media_url?: string;
      thumbnail_url?: string;
      permalink?: string;
      timestamp?: string;
      caption?: string;
    }>;
  };
  return (json.data ?? []).map((m) => ({
    id: m.id,
    // VIDEO usa thumbnail_url; imagem e carrossel usam media_url.
    thumbnail_url: m.thumbnail_url ?? m.media_url ?? null,
    permalink: m.permalink ?? null,
    caption: m.caption ?? null,
    published_at: m.timestamp ?? null,
    is_video: m.media_type === 'VIDEO',
  }));
}

async function fetchYoutubeFeed(account: Account, env: Env): Promise<FeedItem[]> {
  const tokens = await getAccountTokens<{ access_token: string }>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
  if (!tokens?.access_token) return [];
  const auth = { Authorization: `Bearer ${tokens.access_token}` };

  // O canal guarda os uploads numa playlist própria; é preciso descobri-la antes de listar.
  const chRes = await fetchWithRetry('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true', {
    headers: auth,
  });
  if (!chRes.ok) throw new Error(`youtube feed: ${chRes.status} ${await chRes.text()}`);
  const chJson = (await chRes.json()) as {
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
  };
  const uploads = chJson.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];

  const plRes = await fetchWithRetry(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=24&playlistId=${encodeURIComponent(uploads)}`,
    { headers: auth }
  );
  if (!plRes.ok) throw new Error(`youtube feed: ${plRes.status} ${await plRes.text()}`);
  const plJson = (await plRes.json()) as {
    items?: Array<{
      snippet?: {
        title?: string;
        publishedAt?: string;
        resourceId?: { videoId?: string };
        thumbnails?: Record<string, { url?: string }>;
      };
    }>;
  };
  return (plJson.items ?? []).map((it) => {
    const sn = it.snippet ?? {};
    const videoId = sn.resourceId?.videoId ?? '';
    const thumbs = sn.thumbnails ?? {};
    return {
      id: videoId,
      thumbnail_url: thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null,
      permalink: videoId ? `https://youtu.be/${videoId}` : null,
      caption: sn.title ?? null,
      published_at: sn.publishedAt ?? null,
      is_video: true,
    };
  });
}

interface MultipartStartBody {
  name?: string;
  mime_type?: string;
}

async function multipartStart(request: Request, owner: string, env: Env): Promise<Response> {
  let body: MultipartStartBody;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const mimeType = body.mime_type ?? '';
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return jsonResponse({ error: `formato não suportado (${mimeType || 'tipo desconhecido'})` }, 400);
  }
  const id = crypto.randomUUID();
  const safeName = (body.name ?? 'upload').replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload';
  const storageKey = `${id}-${safeName}`;
  const upload = await env.MEDIA.createMultipartUpload(storageKey, { httpMetadata: { contentType: mimeType } });
  return jsonResponse({ id, storage_key: storageKey, upload_id: upload.uploadId }, 201);
}

async function multipartPart(request: Request, url: URL, env: Env): Promise<Response> {
  const storageKey = url.searchParams.get('key');
  const uploadId = url.searchParams.get('upload_id');
  const partNumber = Number(url.searchParams.get('part'));
  if (!storageKey || !uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
    return jsonResponse({ error: 'parâmetros key/upload_id/part obrigatórios' }, 400);
  }
  if (!request.body) return jsonResponse({ error: 'corpo vazio' }, 400);
  const upload = env.MEDIA.resumeMultipartUpload(storageKey, uploadId);
  // O corpo vai direto pro R2 como stream — nada é acumulado na memória do Worker.
  const part = await upload.uploadPart(partNumber, request.body);
  return jsonResponse({ part_number: part.partNumber, etag: part.etag });
}

interface MultipartCompleteBody {
  id?: string;
  storage_key?: string;
  upload_id?: string;
  mime_type?: string;
  size_bytes?: number;
  parts?: Array<{ part_number: number; etag: string }>;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
}

async function multipartComplete(request: Request, owner: string, env: Env): Promise<Response> {
  let body: MultipartCompleteBody;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const { id, storage_key: storageKey, upload_id: uploadId, parts } = body;
  if (!id || !storageKey || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return jsonResponse({ error: 'id/storage_key/upload_id/parts obrigatórios' }, 400);
  }

  const upload = env.MEDIA.resumeMultipartUpload(storageKey, uploadId);
  await upload.complete(parts.map((p) => ({ partNumber: p.part_number, etag: p.etag })));

  const mimeType = body.mime_type || 'application/octet-stream';
  const publicUrl = env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${storageKey}` : null;

  await env.DB.prepare(
    `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes, duration_seconds, width, height, owner_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, storageKey, publicUrl, mimeType, body.size_bytes ?? 0, body.duration_seconds ?? null, body.width ?? null, body.height ?? null, owner)
    .run();

  return jsonResponse(
    {
      id,
      storage_key: storageKey,
      public_url: publicUrl,
      mime_type: mimeType,
      size_bytes: body.size_bytes ?? 0,
      duration_seconds: body.duration_seconds ?? null,
      width: body.width ?? null,
      height: body.height ?? null,
    },
    201
  );
}

async function getMediaBytes(id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(`select storage_key, mime_type from media_assets where id = ?`)
    .bind(id)
    .first<{ storage_key: string; mime_type: string }>();
  if (!row) return jsonResponse({ error: 'mídia não encontrada' }, 404);

  const obj = await env.MEDIA.get(row.storage_key);
  if (!obj) return jsonResponse({ error: 'arquivo não está no bucket' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': row.mime_type || 'application/octet-stream',
      // Imutável: o storage_key carrega o uuid, então o conteúdo daquele endereço nunca muda.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

// Snapshot mais recente de métrica por post publicado (Fase A). Um post sem nenhum snapshot ainda
// (coleta não rodou, ou rede sem coletor) simplesmente não aparece — a lista cresce conforme o
// poller coleta. `m.id = (subquery do último por destino)` pega só o snapshot mais novo de cada um.
async function listMetrics(owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `select pt.id as target_id, pt.platform, pt.external_url, pt.published_at,
            a.display_name as account_name,
            -- Formato (post/reel/story/video/short) pros insights por formato — vem do options JSON.
            json_extract(pt.options, '$.format') as format,
            -- Duração do vídeo (maior mídia do destino) pro insight de "duração ideal".
            (select max(ma.duration_seconds) from post_target_media ptm
               join media_assets ma on ma.id = ptm.media_asset_id
              where ptm.post_target_id = pt.id) as duration_seconds,
            -- No YouTube o conteúdo é o título (body vazio); cai nele quando não há legenda.
            coalesce(nullif(pt.caption_override, ''), nullif(sp.body, ''), sp.title) as caption,
            m.fetched_at, m.impressions, m.reach, m.likes, m.comments, m.shares, m.saves,
            m.video_views, m.avg_watch_seconds
       from post_targets pt
       join accounts a on a.id = pt.account_id
       join scheduled_posts sp on sp.id = pt.scheduled_post_id
       join post_metrics m on m.id = (
         select id from post_metrics where post_target_id = pt.id order by fetched_at desc limit 1
       )
      where pt.status = 'published' and sp.owner_id = ?
      order by pt.published_at desc
      limit 200`
  )
    .bind(owner)
    .all<Record<string, unknown>>();

  return jsonResponse({ metrics: results ?? [] });
}

// Seguidores por conta: o valor mais recente e o primeiro snapshot, pra UI calcular o delta
// ("novos seguidores"). Contas sem nenhum snapshot ainda voltam com followers null.
async function listFollowers(owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `select a.id as account_id, a.platform, a.display_name,
            (select followers from account_metrics m where m.account_id = a.id order by m.fetched_at desc limit 1) as followers,
            (select followers from account_metrics m where m.account_id = a.id order by m.fetched_at asc limit 1) as followers_first,
            (select fetched_at from account_metrics m where m.account_id = a.id order by m.fetched_at asc limit 1) as since
       from accounts a where a.status = 'active' and a.owner_id = ?`
  )
    .bind(owner)
    .all<Record<string, unknown>>();
  return jsonResponse({ followers: results ?? [] });
}

// Todos os snapshots de um destino, do mais antigo pro mais novo (pro gráfico de evolução).
async function getMetricsSeries(targetId: string, owner: string, env: Env): Promise<Response> {
  // post_metrics não tem dono próprio — o escopo vem do post pai do destino.
  const { results } = await env.DB.prepare(
    `select pm.fetched_at, pm.impressions, pm.reach, pm.likes, pm.comments, pm.shares, pm.saves,
            pm.video_views, pm.avg_watch_seconds
       from post_metrics pm
       join post_targets pt on pt.id = pm.post_target_id
       join scheduled_posts sp on sp.id = pt.scheduled_post_id
      where pm.post_target_id = ? and sp.owner_id = ?
      order by pm.fetched_at asc`
  )
    .bind(targetId, owner)
    .all<Record<string, unknown>>();

  return jsonResponse({ series: results ?? [] });
}

interface GridPreviewRow {
  id: string;
  platform: Platform;
  media_asset_id: string;
  sort_at: string;
  public_url: string | null;
  mime_type: string;
  width: number | null;
  height: number | null;
}

const GRID_PREVIEW_SELECT = `select p.id, p.platform, p.media_asset_id, p.sort_at,
       m.public_url, m.mime_type, m.width, m.height
  from grid_previews p
  join media_assets m on m.id = p.media_asset_id`;

async function listGridPreviews(url: URL, owner: string, env: Env): Promise<Response> {
  const platform = url.searchParams.get('platform');
  if (platform && !PLATFORMS.includes(platform as Platform)) {
    return jsonResponse({ error: `plataforma inválida: ${platform}` }, 400);
  }
  const stmt = platform
    ? env.DB.prepare(`${GRID_PREVIEW_SELECT} where p.owner_id = ? and p.platform = ? order by p.sort_at desc`).bind(owner, platform)
    : env.DB.prepare(`${GRID_PREVIEW_SELECT} where p.owner_id = ? order by p.sort_at desc`).bind(owner);
  const { results } = await stmt.all<GridPreviewRow>();
  return jsonResponse({ previews: results ?? [] });
}

async function createGridPreview(request: Request, owner: string, env: Env): Promise<Response> {
  let payload: { platform?: string; media_asset_id?: string; sort_at?: string };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const { platform, media_asset_id: mediaAssetId } = payload;
  if (!platform || !PLATFORMS.includes(platform as Platform)) {
    return jsonResponse({ error: 'platform obrigatória' }, 400);
  }
  if (!mediaAssetId) return jsonResponse({ error: 'media_asset_id obrigatório' }, 400);

  const asset = await env.DB.prepare(`select id from media_assets where id = ?`).bind(mediaAssetId).first<{ id: string }>();
  if (!asset) return jsonResponse({ error: 'mídia não encontrada' }, 404);

  const id = crypto.randomUUID();
  await env.DB.prepare(`insert into grid_previews (id, platform, media_asset_id, sort_at, owner_id) values (?, ?, ?, ?, ?)`)
    .bind(id, platform, mediaAssetId, payload.sort_at || nowIso(), owner)
    .run();

  const row = await env.DB.prepare(`${GRID_PREVIEW_SELECT} where p.id = ? and p.owner_id = ?`)
    .bind(id, owner)
    .first<GridPreviewRow>();
  return jsonResponse(row, 201);
}

async function updateGridPreview(id: string, request: Request, owner: string, env: Env): Promise<Response> {
  let payload: { sort_at?: string };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  if (!payload.sort_at) return jsonResponse({ error: 'sort_at obrigatório' }, 400);

  const { results } = await env.DB.prepare(`update grid_previews set sort_at = ? where id = ? and owner_id = ? returning id`)
    .bind(payload.sort_at, id, owner)
    .all<{ id: string }>();
  if ((results?.length ?? 0) === 0) return jsonResponse({ error: 'prévia não encontrada' }, 404);
  return jsonResponse({ ok: true });
}

// Só apaga a linha da grade — o media_asset (e o objeto no R2) fica, porque a mesma mídia pode já
// ter sido reaproveitada num post agendado.
async function deleteGridPreview(id: string, owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`delete from grid_previews where id = ? and owner_id = ? returning id`)
    .bind(id, owner)
    .all<{ id: string }>();
  if ((results?.length ?? 0) === 0) return jsonResponse({ error: 'prévia não encontrada' }, 404);
  return jsonResponse({ ok: true });
}

function parseOptionalFloat(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInt(value: FormDataEntryValue | null): number | null {
  const n = parseOptionalFloat(value);
  return n === null ? null : Math.round(n);
}

async function cancelTarget(targetId: string, owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    // post_targets não tem owner_id — o escopo vem do post pai. Sem esta subquery, um id de
    // destino de OUTRO dono seria cancelado por quem soubesse o uuid.
    `update post_targets set status = 'canceled', updated_at = ? where id = ? and status in ('draft','queued') and scheduled_post_id in (select id from scheduled_posts where owner_id = ?) returning id`
  )
    .bind(nowIso(), targetId, owner)
    .all<{ id: string }>();

  if ((results?.length ?? 0) === 0) {
    return jsonResponse({ error: 'não é possível cancelar: já está publicando/publicado, ou o post não existe' }, 409);
  }
  return jsonResponse({ ok: true });
}

// Cancelado/falhou volta pra rascunho, e não pra fila: a data original pode já ter passado e o
// poller publicaria na próxima varredura. De rascunho, a pessoa escolhe a data e manda pra fila.
async function reactivateTarget(targetId: string, owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `update post_targets set status = 'draft', last_error = null, attempt_count = 0, updated_at = ?
       where id = ? and status in ('canceled','failed','ambiguous') and scheduled_post_id in (select id from scheduled_posts where owner_id = ?) returning id`
  )
    .bind(nowIso(), targetId, owner)
    .all<{ id: string }>();

  if ((results?.length ?? 0) === 0) {
    return jsonResponse({ error: 'só dá pra reativar o que foi cancelado ou falhou' }, 409);
  }
  return jsonResponse({ ok: true });
}

// Apaga um destino de vez. Se era o último do post, o post vai junto — senão sobra uma linha em
// scheduled_posts sem destino nenhum, invisível na interface e impossível de limpar depois.
async function deleteTarget(targetId: string, owner: string, env: Env): Promise<Response> {
  // O join com scheduled_posts é o escopo de dono: destino de outro dono não é encontrado (404),
  // e o delete abaixo nunca chega a rodar.
  const row = await env.DB.prepare(
    `select pt.scheduled_post_id, pt.status from post_targets pt
       join scheduled_posts sp on sp.id = pt.scheduled_post_id
      where pt.id = ? and sp.owner_id = ?`
  )
    .bind(targetId, owner)
    .first<{ scheduled_post_id: string; status: string }>();
  if (!row) return jsonResponse({ error: 'destino não encontrado' }, 404);

  // Em voo não dá: o poller já está falando com a plataforma e apagar aqui perderia o rastro do
  // que foi publicado (ou está sendo).
  if (row.status === 'publishing' || row.status === 'processing') {
    return jsonResponse({ error: 'não é possível excluir enquanto está publicando — espere terminar' }, 409);
  }

  // post_target_media tem `on delete cascade` pro destino (0001), então some junto.
  await env.DB.prepare(`delete from post_targets where id = ?`).bind(targetId).run();

  const remaining = await env.DB.prepare(`select count(*) as n from post_targets where scheduled_post_id = ?`)
    .bind(row.scheduled_post_id)
    .first<{ n: number }>();
  const postDeleted = (remaining?.n ?? 0) === 0;
  if (postDeleted) {
    // owner_id redundante aqui (o SELECT acima já provou o dono), mas defesa em profundidade:
    // nenhum DELETE deste arquivo roda sem o dono na cláusula.
    await env.DB.prepare(`delete from scheduled_posts where id = ? and owner_id = ?`)
      .bind(row.scheduled_post_id, owner)
      .run();
  }

  return jsonResponse({ ok: true, post_deleted: postDeleted });
}

async function queueTarget(targetId: string, owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `update post_targets set status = 'queued', updated_at = ? where id = ? and status = 'draft' and scheduled_post_id in (select id from scheduled_posts where owner_id = ?) returning id`
  )
    .bind(nowIso(), targetId, owner)
    .all<{ id: string }>();

  if ((results?.length ?? 0) === 0) {
    return jsonResponse({ error: 'não é possível mover para a fila: não está mais em rascunho, ou o post não existe' }, 409);
  }
  return jsonResponse({ ok: true });
}
