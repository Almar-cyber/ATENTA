import { adapters } from './adapters/index.js';
import { nowIso, rowToAccount, rowToMediaAsset, rowToPostTarget } from './lib/db.js';
import { encryptJSON } from './lib/crypto.js';
import { fetchWithRetry } from './lib/http.js';
import type { Env } from './lib/env.js';
import type { Account, ErrorClass, MediaAsset, PlatformAdapter, Platform, PostTarget, PublishResult } from './lib/types.js';

const CLAIM_BATCH_SIZE = 5;
const PROCESSING_RECHECK_BATCH_SIZE = 10;
const PUBLISHING_STALE_MINUTES = 30;
const PROCESSING_TIMEOUT_HOURS = 6;
const MAX_ATTEMPTS = 5;

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPoller(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/oauth\/callback\/(linkedin|meta|pinterest|tiktok)$/.exec(url.pathname);
    if (match) {
      return handleOAuthCallback(match[1] as 'linkedin' | 'meta' | 'pinterest' | 'tiktok', url, env);
    }
    return new Response('not found', { status: 404 });
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
    `select pt.*, sp.body as post_body from post_targets pt
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
    // scheduled_posts.body is the canonical caption; post_targets.caption_override is exactly
    // that — an override. Adapters only ever see the target, so resolve the fallback here or the
    // caption typed into `npm run enqueue --caption=...` never reaches the platform at all.
    target.caption_override = target.caption_override ?? (row.post_body as string | null);
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
  await env.DB.prepare(
    `update post_targets set status = 'queued', last_error = ?, attempt_count = ?, scheduled_for = ?, updated_at = ? where id = ?`
  )
    .bind(message, attemptCount, new Date(Date.now() + delayMs).toISOString(), ts, target.id)
    .run();
}

// OAuth callback — LinkedIn, Meta, Pinterest, TikTok only (their dev consoles require a
// registered HTTPS redirect_uri with no loopback exception). YouTube uses the local loopback
// flow instead (see adapters/youtube.ts + cli/youtube-auth.ts), so it never hits this Worker.
async function handleOAuthCallback(platform: 'linkedin' | 'meta' | 'pinterest' | 'tiktok', url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get('code');
  if (!code) {
    return new Response('missing ?code=', { status: 400 });
  }

  if (platform === 'linkedin') {
    return handleLinkedinCallback(code, url, env);
  }
  if (platform === 'meta') {
    return handleMetaCallback(code, url, env);
  }
  if (platform === 'pinterest') {
    return handlePinterestCallback(code, url, env);
  }
  if (platform === 'tiktok') {
    return handleTiktokCallback(code, url, env);
  }

  // TODO: exchange `code` for tokens against each platform's token endpoint, then
  // setAccountTokens(env.DB, accountId, tokenPayload, env.TOKEN_ENCRYPTION_KEY).
  return new Response(`${platform} OAuth callback not implemented yet — see phased roadmap`, { status: 501 });
}

// state carries {displayName}, base64url-encoded by cli/linkedin-auth-url.ts — the Worker has no
// other way to know which account a given redirect belongs to.
async function handleLinkedinCallback(code: string, url: URL, env: Env): Promise<Response> {
  const state = url.searchParams.get('state');
  if (!state) return new Response('missing ?state=', { status: 400 });

  let displayName: string;
  try {
    displayName = (JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as { displayName: string }).displayName;
    if (!displayName) throw new Error('empty displayName');
  } catch {
    return new Response('invalid ?state=', { status: 400 });
  }

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
  const userinfo = (await userinfoRes.json()) as { sub: string };
  const memberUrn = `urn:li:person:${userinfo.sub}`;

  const { ciphertext, iv } = await encryptJSON(
    { access_token: tokenJson.access_token, member_urn: memberUrn },
    env.TOKEN_ENCRYPTION_KEY
  );
  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();
  const ts = nowIso();

  // platform is UNIQUE on accounts (one row per platform, ever) — look up by platform alone so
  // re-running this with a changed display_name updates the row instead of hitting a
  // unique-constraint violation on insert.
  const existing = await env.DB.prepare(`select id from accounts where platform = 'linkedin'`).first<{ id: string }>();

  if (existing) {
    await env.DB.prepare(
      `update accounts set display_name = ?, token_ciphertext = ?, token_iv = ?, access_token_expires_at = ?, external_account_id = ?, status = 'active', updated_at = ? where id = ?`
    )
      .bind(displayName, ciphertext, iv, expiresAt, memberUrn, ts, existing.id)
      .run();
  } else {
    await env.DB.prepare(
      `insert into accounts (id, platform, display_name, external_account_id, status, token_ciphertext, token_iv, access_token_expires_at) values (?, 'linkedin', ?, ?, 'active', ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), displayName, memberUrn, ciphertext, iv, expiresAt)
      .run();
  }

  return new Response(`Conta "${displayName}" autenticada no LinkedIn. Pode fechar esta aba.`);
}

const GRAPH_VERSION = 'v21.0';

// state carries {displayName}, base64url-encoded by cli/meta-auth-url.ts. Assumes exactly one
// Page was granted (personal-tool scope, not a Page picker) — if /me/accounts ever returns more
// than one, only the first is used; see README Pendências. One Page's access_token is reused for
// both the 'facebook' row and (if the Page has a linked Instagram Business account) the
// 'instagram' row, since Meta authenticates both platforms with the same Page token.
async function handleMetaCallback(code: string, url: URL, env: Env): Promise<Response> {
  const state = url.searchParams.get('state');
  if (!state) return new Response('missing ?state=', { status: 400 });

  let displayName: string;
  try {
    displayName = (JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as { displayName: string }).displayName;
    if (!displayName) throw new Error('empty displayName');
  } catch {
    return new Response('invalid ?state=', { status: 400 });
  }

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
  const page = pagesJson.data[0];

  const igRes = await fetchWithRetry(
    `https://graph.facebook.com/${GRAPH_VERSION}/${page.id}?fields=instagram_business_account&access_token=${encodeURIComponent(page.access_token)}`
  );
  const igJson = igRes.ok ? ((await igRes.json()) as { instagram_business_account?: { id: string } }) : {};
  const igUserId = igJson.instagram_business_account?.id;

  const { ciphertext, iv } = await encryptJSON({ access_token: page.access_token }, env.TOKEN_ENCRYPTION_KEY);
  const ts = nowIso();

  await upsertAccount(env, 'facebook', displayName, page.id, ciphertext, iv, ts);
  if (igUserId) {
    await upsertAccount(env, 'instagram', displayName, igUserId, ciphertext, iv, ts);
  }

  const summary = igUserId
    ? `Facebook Page "${page.name}" e Instagram vinculado autenticados como "${displayName}".`
    : `Facebook Page "${page.name}" autenticado como "${displayName}" (sem conta Instagram Business vinculada).`;
  return new Response(`${summary} Pode fechar esta aba.`);
}

async function upsertAccount(
  env: Env,
  platform: Platform,
  displayName: string,
  externalAccountId: string,
  ciphertext: string,
  iv: string,
  ts: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const existing = await env.DB.prepare(`select id from accounts where platform = ?`).bind(platform).first<{ id: string }>();
  const extraJson = JSON.stringify(extra);
  if (existing) {
    await env.DB.prepare(
      `update accounts set display_name = ?, external_account_id = ?, token_ciphertext = ?, token_iv = ?, extra = ?, status = 'active', updated_at = ? where id = ?`
    )
      .bind(displayName, externalAccountId, ciphertext, iv, extraJson, ts, existing.id)
      .run();
  } else {
    await env.DB.prepare(
      `insert into accounts (id, platform, display_name, external_account_id, status, token_ciphertext, token_iv, extra) values (?, ?, ?, ?, 'active', ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), platform, displayName, externalAccountId, ciphertext, iv, extraJson)
      .run();
  }
}

// state carries {displayName}, base64url-encoded by cli/pinterest-auth-url.ts. Auto-selects the
// first board returned by /v5/boards into accounts.extra.default_board_id (personal-tool
// simplification — a post can still override with options.board_id).
async function handlePinterestCallback(code: string, url: URL, env: Env): Promise<Response> {
  const state = url.searchParams.get('state');
  if (!state) return new Response('missing ?state=', { status: 400 });

  let displayName: string;
  try {
    displayName = (JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as { displayName: string }).displayName;
    if (!displayName) throw new Error('empty displayName');
  } catch {
    return new Response('invalid ?state=', { status: 400 });
  }

  const redirectUri = `${url.origin}${url.pathname}`;
  const basicAuth = `Basic ${Buffer.from(`${env.PINTEREST_CLIENT_ID}:${env.PINTEREST_CLIENT_SECRET}`).toString('base64')}`;

  const tokenRes = await fetchWithRetry('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: { Authorization: basicAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });
  if (!tokenRes.ok) return new Response(`pinterest token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`, { status: 502 });
  const tokenJson = (await tokenRes.json()) as { access_token: string; refresh_token: string; expires_in: number };

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
  const ts = nowIso();

  await upsertAccount(
    env,
    'pinterest',
    displayName,
    '', // Pinterest has no single "external account id" equivalent at this stage
    ciphertext,
    iv,
    ts,
    defaultBoard ? { default_board_id: defaultBoard.id } : {}
  );
  await env.DB.prepare(`update accounts set access_token_expires_at = ? where platform = 'pinterest'`).bind(expiresAt).run();

  const summary = defaultBoard
    ? `Pinterest autenticado como "${displayName}", board padrão "${defaultBoard.name}".`
    : `Pinterest autenticado como "${displayName}" (nenhum board encontrado — crie um antes de postar).`;
  return new Response(`${summary} Pode fechar esta aba.`);
}

// state carries {displayName}, base64url-encoded by cli/tiktok-auth-url.ts.
async function handleTiktokCallback(code: string, url: URL, env: Env): Promise<Response> {
  const state = url.searchParams.get('state');
  if (!state) return new Response('missing ?state=', { status: 400 });

  let displayName: string;
  try {
    displayName = (JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as { displayName: string }).displayName;
    if (!displayName) throw new Error('empty displayName');
  } catch {
    return new Response('invalid ?state=', { status: 400 });
  }

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
    refresh_expires_in?: number;
    scope?: string;
    open_id: string;
  };

  const { ciphertext, iv } = await encryptJSON(
    { access_token: tokenJson.access_token, refresh_token: tokenJson.refresh_token },
    env.TOKEN_ENCRYPTION_KEY
  );
  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();
  const ts = nowIso();

  // The refresh token is finite too (~365 days) and rotates on every use — recording its expiry
  // lets the adapter say "reauth" instead of burning refresh attempts that can no longer succeed.
  const refreshExpiresAt = tokenJson.refresh_expires_in
    ? new Date(Date.now() + tokenJson.refresh_expires_in * 1000).toISOString()
    : null;

  await upsertAccount(env, 'tiktok', displayName, tokenJson.open_id, ciphertext, iv, ts);
  await env.DB.prepare(
    `update accounts set access_token_expires_at = ?, refresh_token_expires_at = ?, scope = ? where platform = 'tiktok'`
  )
    .bind(expiresAt, refreshExpiresAt, tokenJson.scope ?? null)
    .run();

  return new Response(`Conta "${displayName}" autenticada no TikTok. Pode fechar esta aba.`);
}
