import { adapters } from './adapters/index.js';
import { handleApiRequest } from './api.js';
import { nowIso, rowToAccount, rowToMediaAsset, rowToPostTarget } from './lib/db.js';
import { checkDashboardAuth } from './lib/auth.js';
import { encryptJSON } from './lib/crypto.js';
import { fetchWithRetry } from './lib/http.js';
import { OAUTH_STATE_COOKIE, clearStateCookie, decodeState, getCookie } from './lib/oauth-state.js';
import type { Env } from './lib/env.js';
import type { Account, ErrorClass, MediaAsset, PlatformAdapter, Platform, PostTarget, PublishResult } from './lib/types.js';

const CLAIM_BATCH_SIZE = 5;
const PROCESSING_RECHECK_BATCH_SIZE = 10;
const PUBLISHING_STALE_MINUTES = 30;
const PROCESSING_TIMEOUT_HOURS = 6;
const MAX_ATTEMPTS = 5;

// Required by Pinterest/TikTok app review — this is a single-user personal tool, not a service
// with outside users, so this states plainly what it actually does rather than boilerplate legalese.
const PRIVACY_POLICY_TEXT = `ALMAR Social Scheduler — Politica de Privacidade

Esta ferramenta (ALMAR Social Scheduler) e uma ferramenta pessoal de agendamento de posts,
operada e usada por ALMAR para publicar nas suas proprias contas do YouTube, LinkedIn, Facebook,
Instagram, Pinterest e TikTok. Nao e um servico oferecido a terceiros nem a outros usuarios.

Dados coletados:
- Tokens de acesso/atualizacao (OAuth) das contas conectadas pelo proprio proprietario.
- Metadados dos posts agendados (legenda, horario, plataforma de destino).

Como os dados sao armazenados:
- Os tokens sao criptografados (AES-256-GCM) antes de serem salvos num banco de dados privado
  (Cloudflare D1), acessivel apenas pelo proprietario da ferramenta.

O que NAO fazemos:
- Nao compartilhamos, vendemos ou usamos esses dados para publicidade.
- Nao coletamos dados de nenhum outro usuario ou visitante.

Retencao: os tokens ficam armazenados ate o proprietario revogar o acesso do app ou remover a
conta da ferramenta.

Contato: alexia01native@gmail.com`;

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPoller(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Unauthenticated: these are cross-site redirects landing here straight from each platform's
    // consent screen, not a browser tab that's already presented dashboard credentials.
    const oauthMatch = /^\/oauth\/callback\/(linkedin|meta|pinterest|tiktok|youtube)$/.exec(url.pathname);
    if (oauthMatch) {
      return handleOAuthCallback(oauthMatch[1] as OAuthCallbackPlatform, request, url, env);
    }

    // Unauthenticated: platform app-review processes (Pinterest, TikTok, ...) fetch this
    // directly, with no way to present dashboard credentials. Accepts an optional trailing
    // segment (e.g. /privacy/almar) — some app-review forms require the company/app name to
    // literally appear in the URL to prove ownership; the suffix is otherwise ignored.
    if (/^\/privacy(\/.*)?$/.test(url.pathname)) {
      return new Response(PRIVACY_POLICY_TEXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    const authError = checkDashboardAuth(request, env);
    if (authError) return authError;

    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, url, env);
    }

    // Everything else is the React SPA (web/ → dist/), served by the assets binding. With
    // not_found_handling = "single-page-application", unknown paths return index.html.
    return env.ASSETS.fetch(request);
  },
};

// Cron entrypoint. NOTE: unlike the original GitHub Actions design, Cron Triggers have no
// built-in "run failed" email — failures here only show up in `wrangler tail` / the dashboard
// Logs tab. TODO (Phase 1+): push failures to a free webhook (e.g. a Discord/ntfy.sh URL) if you
// want push alerting instead of checking logs manually.
async function runPoller(env: Env): Promise<void> {
  await stepTokenHealthScan(env);
  await stepClaimAndPublishDue(env);
  await stepRecheckProcessing(env);
  await stepSweeps(env);
}

// Step 0 — unconditional token-health scan. Runs every invocation, independent of whether
// anything is due, so a quiet platform can't silently sail past its refresh window.
async function stepTokenHealthScan(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(`select * from accounts where status = 'active'`).all<any>();
  for (const row of results ?? []) {
    const account = rowToAccount(row);
    const adapter = adapters[account.platform];
    if (!adapter.needsRefresh(account)) continue;
    try {
      await adapter.ensureFreshToken(account, env);
    } catch (err) {
      console.error(`[token-refresh] ${account.platform}/${account.display_name} failed:`, err);
      await env.DB.prepare(`update accounts set status = 'needs_reauth', updated_at = ? where id = ?`)
        .bind(nowIso(), account.id)
        .run();
    }
  }
}

// Step 1 — claim and publish due posts. Atomic claim via UPDATE ... WHERE status='queued'
// RETURNING id, so two overlapping runs never double-publish.
async function stepClaimAndPublishDue(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `select pt.* from post_targets pt
     join accounts a on a.id = pt.account_id
     join scheduled_posts sp on sp.id = pt.scheduled_post_id
     where pt.status = 'queued' and sp.scheduled_for <= ? and a.status = 'active'
     order by sp.scheduled_for asc
     limit ?`
  )
    .bind(nowIso(), CLAIM_BATCH_SIZE)
    .all<any>();

  for (const row of results ?? []) {
    const target = rowToPostTarget(row);
    const claimed = await claim(env, target.id, 'queued', 'publishing');
    if (!claimed) continue; // another run already grabbed it

    const account = await getAccount(env, target.account_id);
    if (!account) throw new Error(`account not found: ${target.account_id}`);
    const media = await getMediaForTarget(env, target.id);

    const adapter = adapters[target.platform];
    try {
      adapter.validate(target, media);
      const result = await adapter.publish(target, media, account, env);
      await applyPublishResult(env, target, result);
    } catch (err) {
      await handlePublishError(env, target, adapter, err);
    }
  }
}

// Step 2 — recheck anything left processing. Processing rows must be actively re-queried here,
// not just assumed to be "picked up again by the next run."
async function stepRecheckProcessing(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `select pt.* from post_targets pt
     join accounts a on a.id = pt.account_id
     where pt.status = 'processing' and a.status = 'active'
     order by pt.updated_at asc
     limit ?`
  )
    .bind(PROCESSING_RECHECK_BATCH_SIZE)
    .all<any>();

  for (const row of results ?? []) {
    const target = rowToPostTarget(row);
    const account = await getAccount(env, target.account_id);
    if (!account) continue;
    const adapter = adapters[target.platform];
    try {
      const result = await adapter.checkStatus(target, account, env);
      await applyPublishResult(env, target, result);
    } catch (err) {
      await handlePublishError(env, target, adapter, err);
    }
  }
}

// Step 3 — two sweeps: crashed-mid-publish, and processing that never resolves.
async function stepSweeps(env: Env): Promise<void> {
  const publishingCutoff = new Date(Date.now() - PUBLISHING_STALE_MINUTES * 60_000).toISOString();
  await env.DB.prepare(`update post_targets set status = 'queued', updated_at = ? where status = 'publishing' and updated_at < ?`)
    .bind(nowIso(), publishingCutoff)
    .run();

  const processingCutoff = new Date(Date.now() - PROCESSING_TIMEOUT_HOURS * 3_600_000).toISOString();
  await env.DB.prepare(
    `update post_targets set status = 'failed', last_error = 'timed out waiting on platform processing', updated_at = ?
     where status = 'processing' and updated_at < ?`
  )
    .bind(nowIso(), processingCutoff)
    .run();
}

async function claim(env: Env, id: string, fromStatus: string, toStatus: string): Promise<boolean> {
  const { results } = await env.DB.prepare(
    `update post_targets set status = ?, updated_at = ? where id = ? and status = ? returning id`
  )
    .bind(toStatus, nowIso(), id, fromStatus)
    .all<{ id: string }>();
  return (results?.length ?? 0) > 0;
}

async function getAccount(env: Env, accountId: string): Promise<Account | null> {
  const row = await env.DB.prepare(`select * from accounts where id = ?`).bind(accountId).first<any>();
  return row ? rowToAccount(row) : null;
}

async function getMediaForTarget(env: Env, postTargetId: string): Promise<MediaAsset[]> {
  const { results } = await env.DB.prepare(
    `select ma.* from post_target_media ptm
     join media_assets ma on ma.id = ptm.media_asset_id
     where ptm.post_target_id = ?
     order by ptm.position asc`
  )
    .bind(postTargetId)
    .all<any>();
  return (results ?? []).map(rowToMediaAsset);
}

async function applyPublishResult(env: Env, target: PostTarget, result: PublishResult): Promise<void> {
  const ts = nowIso();

  if (result.state === 'published') {
    await env.DB.prepare(
      `update post_targets set status = 'published', external_post_id = ?, external_url = ?, published_at = ?, updated_at = ? where id = ?`
    )
      .bind(result.externalId, result.externalUrl ?? null, ts, ts, target.id)
      .run();
    return;
  }

  if (result.state === 'processing') {
    await env.DB.prepare(`update post_targets set status = 'processing', adapter_state = ?, updated_at = ? where id = ?`)
      .bind(JSON.stringify(result.adapterState ?? target.adapter_state), ts, target.id)
      .run();
    return;
  }

  await handleFailure(env, target, result.class, result.message);
}

async function handlePublishError(env: Env, target: PostTarget, adapter: PlatformAdapter, err: unknown): Promise<void> {
  const errorClass = adapter.classifyError(err);
  const message = err instanceof Error ? err.message : String(err);
  await handleFailure(env, target, errorClass, message);
}

// Error classification (architecture doc): each class maps to a distinct poller action.
async function handleFailure(env: Env, target: PostTarget, errorClass: ErrorClass, message: string): Promise<void> {
  const ts = nowIso();

  if (errorClass === 'auth') {
    // Flip the account directly rather than relying on Step 0 to catch it next run: some
    // adapters (e.g. Meta page tokens, which don't track an expiry) never trip needsRefresh()
    // on their own, so a publish-time auth error is the only signal that ever arrives. Without
    // this, the target would requeue forever against a token that's already dead (auth errors
    // don't increment attempt_count, by design, since they aren't the target's fault).
    await env.DB.prepare(`update accounts set status = 'needs_reauth', updated_at = ? where id = ?`)
      .bind(ts, target.account_id)
      .run();
    await env.DB.prepare(`update post_targets set status = 'queued', last_error = ?, updated_at = ? where id = ?`)
      .bind(message, ts, target.id)
      .run();
    return;
  }

  if (errorClass === 'ambiguous') {
    await env.DB.prepare(`update post_targets set status = 'ambiguous', last_error = ?, updated_at = ? where id = ?`)
      .bind(message, ts, target.id)
      .run();
    return;
  }

  if (errorClass === 'permanent') {
    await env.DB.prepare(`update post_targets set status = 'failed', last_error = ?, updated_at = ? where id = ?`)
      .bind(message, ts, target.id)
      .run();
    return;
  }

  // retryable or quota
  const attemptCount = target.attempt_count + 1;
  if (attemptCount >= MAX_ATTEMPTS) {
    await env.DB.prepare(`update post_targets set status = 'failed', last_error = ?, attempt_count = ?, updated_at = ? where id = ?`)
      .bind(message, attemptCount, ts, target.id)
      .run();
    return;
  }

  // TODO (per adapter, Phase 1+): use the platform's real quota-reset boundary instead of a flat 24h.
  const delayMs = errorClass === 'quota' ? 24 * 3_600_000 : 15 * 60_000;
  const nextRunAt = new Date(Date.now() + delayMs).toISOString();
  // scheduled_for lives on scheduled_posts, not post_targets (one schedule shared by all of a
  // post's targets) — two updates, one per table.
  await env.DB.prepare(`update post_targets set status = 'queued', last_error = ?, attempt_count = ?, updated_at = ? where id = ?`)
    .bind(message, attemptCount, ts, target.id)
    .run();
  await env.DB.prepare(`update scheduled_posts set scheduled_for = ?, updated_at = ? where id = ?`)
    .bind(nextRunAt, ts, target.scheduled_post_id)
    .run();
}

// OAuth callback — LinkedIn, Meta, Pinterest, TikTok only (their dev consoles require a
// registered HTTPS redirect_uri with no loopback exception). YouTube uses the local loopback
// flow instead (see adapters/youtube.ts + cli/youtube-auth.ts), so it never hits this Worker.
type OAuthCallbackPlatform = 'linkedin' | 'meta' | 'pinterest' | 'tiktok' | 'youtube';

async function handleOAuthCallback(platform: OAuthCallbackPlatform, request: Request, url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get('code');
  if (!code) {
    return new Response('missing ?code=', { status: 400 });
  }

  if (platform === 'linkedin') return handleLinkedinCallback(code, request, url, env);
  if (platform === 'meta') return handleMetaCallback(code, request, url, env);
  if (platform === 'pinterest') return handlePinterestCallback(code, request, url, env);
  if (platform === 'tiktok') return handleTiktokCallback(code, request, url, env);
  if (platform === 'youtube') return handleYoutubeCallback(code, request, url, env);

  return new Response(`${platform} OAuth callback not implemented yet — see phased roadmap`, { status: 501 });
}

// Valida o `state`. Fluxo pelo navegador (endpoint /api/connect) manda `{ n: nonce }` e um cookie
// oauth_state igual — comparamos os dois (CSRF). Fluxo antigo do CLI manda `{ displayName }` sem
// cookie — aceito e usado como nome de fallback. Retorna o nome de fallback, ou uma Response de erro.
function checkState(request: Request, url: URL): { fallbackName?: string } | Response {
  const parsed = decodeState(url.searchParams.get('state'));
  if (parsed.n) {
    const cookie = getCookie(request, OAUTH_STATE_COOKIE);
    if (!cookie || cookie !== parsed.n) return new Response('state inválido (csrf)', { status: 400 });
    return {};
  }
  if (parsed.displayName) return { fallbackName: parsed.displayName };
  return new Response('missing ?state=', { status: 400 });
}

// Sucesso: volta pro SPA (`/?connected=<plataforma>`), que abre o modal de "conta conectada".
// Limpa o cookie de state de quebra.
function connectedRedirect(url: URL, platform: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${url.origin}/?connected=${encodeURIComponent(platform)}`, 'Set-Cookie': clearStateCookie() },
  });
}

// O nome é puxado do próprio LinkedIn (userinfo.name); o `state` só carrega o nonce de CSRF (fluxo
// pelo app) ou um displayName de fallback (fluxo antigo do CLI).
async function handleLinkedinCallback(code: string, request: Request, url: URL, env: Env): Promise<Response> {
  const checked = checkState(request, url);
  if (checked instanceof Response) return checked;

  // Must match the redirect_uri used to request `code` exactly (LinkedIn requires an exact match).
  const redirectUri = `${url.origin}${url.pathname}`;

  const tokenRes = await fetchWithRetry('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env.LINKEDIN_CLIENT_ID,
      client_secret: env.LINKEDIN_CLIENT_SECRET,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    return new Response(`linkedin token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`, { status: 502 });
  }
  const tokenJson = (await tokenRes.json()) as { access_token: string; expires_in: number };

  const userinfoRes = await fetchWithRetry('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!userinfoRes.ok) return new Response(`linkedin userinfo failed: ${userinfoRes.status}`, { status: 502 });
  const userinfo = (await userinfoRes.json()) as { sub: string; name?: string };
  const memberUrn = `urn:li:person:${userinfo.sub}`;
  const displayName = userinfo.name || checked.fallbackName || 'LinkedIn';

  const { ciphertext, iv } = await encryptJSON(
    { access_token: tokenJson.access_token, member_urn: memberUrn },
    env.TOKEN_ENCRYPTION_KEY
  );
  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();
  await upsertAccount(env, 'linkedin', displayName, memberUrn, ciphertext, iv, nowIso(), {}, expiresAt);

  return connectedRedirect(url, 'linkedin');
}

const GRAPH_VERSION = 'v21.0';

// Conecta TODAS as Pages que o usuário autorizou no consentimento (ele escolhe quais lá) — assim
// dá pra ter, por ex., dois Instagrams. Cada Page vira uma linha 'facebook' e, se tiver Instagram
// Business vinculado, uma linha 'instagram', ambas com o token da própria Page. Nomes puxados da
// API (page.name para o Facebook, username para o Instagram).
async function handleMetaCallback(code: string, request: Request, url: URL, env: Env): Promise<Response> {
  const checked = checkState(request, url);
  if (checked instanceof Response) return checked;

  const redirectUri = `${url.origin}${url.pathname}`;

  const shortLivedRes = await fetchWithRetry(
    `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        client_id: env.META_APP_ID,
        client_secret: env.META_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      })
  );
  if (!shortLivedRes.ok) {
    return new Response(`meta token exchange failed: ${shortLivedRes.status} ${await shortLivedRes.text()}`, { status: 502 });
  }
  const shortLived = (await shortLivedRes.json()) as { access_token: string };

  const longLivedRes = await fetchWithRetry(
    `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: env.META_APP_ID,
        client_secret: env.META_APP_SECRET,
        fb_exchange_token: shortLived.access_token,
      })
  );
  if (!longLivedRes.ok) {
    return new Response(`meta long-lived exchange failed: ${longLivedRes.status} ${await longLivedRes.text()}`, { status: 502 });
  }
  const longLived = (await longLivedRes.json()) as { access_token: string };

  const pagesRes = await fetchWithRetry(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?access_token=${encodeURIComponent(longLived.access_token)}`
  );
  if (!pagesRes.ok) return new Response(`meta /me/accounts failed: ${pagesRes.status} ${await pagesRes.text()}`, { status: 502 });
  const pagesJson = (await pagesRes.json()) as { data: Array<{ id: string; name: string; access_token: string }> };
  if (pagesJson.data.length === 0) {
    return new Response('nenhuma Page encontrada — confirme que você é admin de uma Page do Facebook', { status: 400 });
  }

  const ts = nowIso();
  for (const page of pagesJson.data) {
    const { ciphertext, iv } = await encryptJSON({ access_token: page.access_token }, env.TOKEN_ENCRYPTION_KEY);
    await upsertAccount(env, 'facebook', page.name, page.id, ciphertext, iv, ts);

    const igRes = await fetchWithRetry(
      `https://graph.facebook.com/${GRAPH_VERSION}/${page.id}?fields=instagram_business_account{username}&access_token=${encodeURIComponent(page.access_token)}`
    );
    const igJson = igRes.ok ? ((await igRes.json()) as { instagram_business_account?: { id: string; username?: string } }) : {};
    const ig = igJson.instagram_business_account;
    if (ig?.id) {
      await upsertAccount(env, 'instagram', ig.username || page.name, ig.id, ciphertext, iv, ts);
    }
  }

  return connectedRedirect(url, 'meta');
}

// Chaveia por (platform, external_account_id) — várias contas por rede convivem, mas reconectar a
// MESMA conta (mesmo external id) atualiza a linha em vez de duplicar. `access_token_expires_at`
// entra aqui em vez de um UPDATE separado por plataforma (que não servia mais no mundo multi-conta).
async function upsertAccount(
  env: Env,
  platform: Platform,
  displayName: string,
  externalAccountId: string,
  ciphertext: string,
  iv: string,
  ts: string,
  extra: Record<string, unknown> = {},
  expiresAt: string | null = null
): Promise<void> {
  const existing = await env.DB.prepare(`select id from accounts where platform = ? and external_account_id = ?`)
    .bind(platform, externalAccountId)
    .first<{ id: string }>();
  const extraJson = JSON.stringify(extra);
  if (existing) {
    await env.DB.prepare(
      `update accounts set display_name = ?, token_ciphertext = ?, token_iv = ?, extra = ?, access_token_expires_at = ?, status = 'active', updated_at = ? where id = ?`
    )
      .bind(displayName, ciphertext, iv, extraJson, expiresAt, ts, existing.id)
      .run();
  } else {
    await env.DB.prepare(
      `insert into accounts (id, platform, display_name, external_account_id, status, token_ciphertext, token_iv, extra, access_token_expires_at) values (?, ?, ?, ?, 'active', ?, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), platform, displayName, externalAccountId, ciphertext, iv, extraJson, expiresAt)
      .run();
  }
}

// Nome + external id puxados de /v5/user_account (username). Auto-seleciona o primeiro board em
// extra.default_board_id (um post ainda pode sobrescrever com options.board_id).
async function handlePinterestCallback(code: string, request: Request, url: URL, env: Env): Promise<Response> {
  const checked = checkState(request, url);
  if (checked instanceof Response) return checked;

  const redirectUri = `${url.origin}${url.pathname}`;
  const basicAuth = `Basic ${Buffer.from(`${env.PINTEREST_CLIENT_ID}:${env.PINTEREST_CLIENT_SECRET}`).toString('base64')}`;

  const tokenRes = await fetchWithRetry('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: { Authorization: basicAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });
  if (!tokenRes.ok) return new Response(`pinterest token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`, { status: 502 });
  const tokenJson = (await tokenRes.json()) as { access_token: string; refresh_token: string; expires_in: number };

  const userRes = await fetchWithRetry('https://api.pinterest.com/v5/user_account', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const userJson = userRes.ok ? ((await userRes.json()) as { username?: string }) : {};
  const username = userJson.username || checked.fallbackName || 'Pinterest';

  const boardsRes = await fetchWithRetry('https://api.pinterest.com/v5/boards', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const boardsJson = boardsRes.ok ? ((await boardsRes.json()) as { items: Array<{ id: string; name: string }> }) : { items: [] };
  const defaultBoard = boardsJson.items[0];

  const { ciphertext, iv } = await encryptJSON(
    { access_token: tokenJson.access_token, refresh_token: tokenJson.refresh_token },
    env.TOKEN_ENCRYPTION_KEY
  );
  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();

  await upsertAccount(
    env,
    'pinterest',
    username,
    username, // external id = username (único no Pinterest)
    ciphertext,
    iv,
    nowIso(),
    defaultBoard ? { default_board_id: defaultBoard.id } : {},
    expiresAt
  );

  return connectedRedirect(url, 'pinterest');
}

// Nome puxado de /v2/user/info/ (display_name); external id = open_id do token.
async function handleTiktokCallback(code: string, request: Request, url: URL, env: Env): Promise<Response> {
  const checked = checkState(request, url);
  if (checked instanceof Response) return checked;

  const redirectUri = `${url.origin}${url.pathname}`;

  const tokenRes = await fetchWithRetry('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) return new Response(`tiktok token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`, { status: 502 });
  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    open_id: string;
  };

  const infoRes = await fetchWithRetry('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const infoJson = infoRes.ok ? ((await infoRes.json()) as { data?: { user?: { display_name?: string } } }) : {};
  const displayName = infoJson.data?.user?.display_name || checked.fallbackName || 'TikTok';

  const { ciphertext, iv } = await encryptJSON(
    { access_token: tokenJson.access_token, refresh_token: tokenJson.refresh_token },
    env.TOKEN_ENCRYPTION_KEY
  );
  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();
  await upsertAccount(env, 'tiktok', displayName, tokenJson.open_id, ciphertext, iv, nowIso(), {}, expiresAt);

  return connectedRedirect(url, 'tiktok');
}

// YouTube pelo navegador. O CLI (cli/youtube-auth.ts) usa credencial "Desktop app" com redirect
// loopback, que só funciona na máquina do dono; aqui o app é do tipo "Web application" e o redirect
// aponta pro próprio Worker, igual às outras redes. Grava o mesmo formato de token que o adapter
// espera ({access_token, refresh_token}) e puxa o nome do canal da API.
async function handleYoutubeCallback(code: string, request: Request, url: URL, env: Env): Promise<Response> {
  const checked = checkState(request, url);
  if (checked instanceof Response) return checked;

  const redirectUri = `${url.origin}${url.pathname}`;

  const tokenRes = await fetchWithRetry('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    return new Response(`youtube token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`, { status: 502 });
  }
  const tokenJson = (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in: number };

  // Sem refresh_token o poller não consegue renovar e a conta morre em 1h. Acontece quando essa
  // conta Google já autorizou o app antes — o jeito é revogar e reconectar.
  if (!tokenJson.refresh_token) {
    return new Response(
      'O Google não devolveu refresh_token. Revogue o acesso em https://myaccount.google.com/permissions e conecte de novo.',
      { status: 400 }
    );
  }

  // Nome e id do canal (o escopo youtube.readonly cobre esta chamada).
  const chRes = await fetchWithRetry('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const chJson = chRes.ok
    ? ((await chRes.json()) as { items?: Array<{ id: string; snippet?: { title?: string } }> })
    : {};
  const channel = chJson.items?.[0];
  const displayName = channel?.snippet?.title || checked.fallbackName || 'YouTube';

  const { ciphertext, iv } = await encryptJSON(
    { access_token: tokenJson.access_token, refresh_token: tokenJson.refresh_token },
    env.TOKEN_ENCRYPTION_KEY
  );
  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();
  await upsertAccount(env, 'youtube', displayName, channel?.id ?? '', ciphertext, iv, nowIso(), {}, expiresAt);

  return connectedRedirect(url, 'youtube');
}
