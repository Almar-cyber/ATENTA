import { adapters } from './adapters/index.js';
import { nowIso, rowToAccount, rowToMediaAsset, rowToPostTarget } from './lib/db.js';
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
      await adapter.ensureFreshToken(account);
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
      const result = await adapter.publish(target, media, account);
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
      const result = await adapter.checkStatus(target, account);
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
    // don't increment attempt_count — the token-health scan (Step 0) drives reauth next run
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
// flow instead (see adapters/youtube.ts), so it never hits this Worker.
// Phase 1-4 fill in the real code-for-token exchange per platform; this is the routing shell.
async function handleOAuthCallback(platform: 'linkedin' | 'meta' | 'pinterest' | 'tiktok', url: URL, _env: Env): Promise<Response> {
  const code = url.searchParams.get('code');
  if (!code) {
    return new Response('missing ?code=', { status: 400 });
  }
  // TODO: exchange `code` for tokens against the platform's token endpoint, then
  // setAccountTokens(env.DB, accountId, tokenPayload, env.TOKEN_ENCRYPTION_KEY).
  return new Response(`${platform} OAuth callback not implemented yet — see phased roadmap`, { status: 501 });
}
