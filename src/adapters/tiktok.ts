import type { ErrorClass, MediaAsset, PlatformAdapter } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { classifyByKnownCodes } from '../lib/errors.js';
import { fetchWithRetry } from '../lib/http.js';
import { getAccountTokens, setAccountTokens } from '../lib/tokens.js';
import { nowIso, saveAdapterState } from '../lib/db.js';

const API_BASE = 'https://open.tiktokapis.com/v2';

// Chunk rules from TikTok's Media Transfer Guide:
//   - a chunk is 5MB..64MB, except the last one, which absorbs the remainder (up to 128MB);
//   - total_chunk_count = floor(video_size / chunk_size), between 1 and 1000;
//   - a video smaller than a single chunk goes up whole, with chunk_size === video_size.
// CHUNK_BYTES sits well inside the legal window on purpose: the Worker holds one chunk in memory
// at a time (128MB cap for the whole isolate), so 16MB keeps peak usage ~32MB even on the final
// oversized chunk, while still allowing 1000 * 16MB = 16GB of video — far above TikTok's own cap.
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_CHUNKS = 1000;
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_TITLE_CHARS = 2200;
// TikTok documents the signed upload URL as good for about an hour. 45min is that minus a margin:
// past it a resume is abandoned and the post re-inits, which is safe precisely because a partial
// upload never publishes anything.
const UPLOAD_URL_TTL_MS = 45 * 60_000;

interface TiktokTokens {
  access_token: string;
  refresh_token: string;
}

// Two shapes share this column. Mid-upload it carries the whole resumable transfer; once the bytes
// are in, publish() narrows it to what checkStatus actually needs.
interface AdapterState {
  publish_id?: string;
  creator_username?: string;
  upload_url?: string;
  upload_started_at?: string;
  video_size?: number;
  chunk_size?: number;
  total_chunks?: number;
  next_chunk?: number;
  [key: string]: unknown;
}

interface CreatorInfo {
  creator_username?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

interface TiktokOptions {
  privacy_level?: string;
  disable_comment?: boolean;
  disable_duet?: boolean;
  disable_stitch?: boolean;
  brand_content_toggle?: boolean;
  brand_organic_toggle?: boolean;
  is_aigc?: boolean;
  video_cover_timestamp_ms?: number;
}

/** Carries TikTok's own error code so classifyError() can act on it instead of guessing. */
class TiktokError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TiktokError';
    this.code = code;
  }
}

// Every v2 response carries an `error` envelope — including the successful ones, where the code is
// literally "ok" — and TikTok answers plenty of failures with HTTP 200. Status alone is therefore
// not a success check. The /oauth/ endpoints are the exception: they put a flat string in `error`
// plus `error_description`, and their payload is top-level rather than under `data`.
async function readEnvelope(res: Response, label: string): Promise<Record<string, any>> {
  const text = await res.text();
  let body: Record<string, any>;
  try {
    body = JSON.parse(text) as Record<string, any>;
  } catch {
    throw new TiktokError('invalid_response', `tiktok: ${label} returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
  }

  const err = body.error;
  const code: string | undefined = typeof err === 'string' ? err : err?.code;
  const message: string | undefined = typeof err === 'string' ? body.error_description : err?.message;
  if (code && code !== 'ok') {
    throw new TiktokError(code, `tiktok: ${label} failed (${res.status} ${code}): ${message ?? text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new TiktokError(`http_${res.status}`, `tiktok: ${label} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return body;
}

function requireData<T>(body: Record<string, any>, label: string): T {
  if (!body.data) throw new TiktokError('invalid_response', `tiktok: ${label} returned no data block`);
  return body.data as T;
}

function planChunks(sizeBytes: number): { chunkSize: number; totalChunks: number } {
  if (sizeBytes <= MAX_CHUNK_BYTES) return { chunkSize: sizeBytes, totalChunks: 1 };

  let chunkSize = CHUNK_BYTES;
  if (Math.floor(sizeBytes / chunkSize) > MAX_CHUNKS) {
    chunkSize = Math.min(MAX_CHUNK_BYTES, Math.ceil(sizeBytes / MAX_CHUNKS));
  }
  // floor(), not ceil(): TikTok expects the final chunk to carry the remainder, so the count is
  // one less than a naive division would suggest whenever the size isn't an exact multiple.
  return { chunkSize, totalChunks: Math.floor(sizeBytes / chunkSize) };
}

// A publish() that died mid-transfer left its progress in adapter_state; the poller's stale sweep
// requeues the target and we land back here. Resuming is only valid while every premise still
// holds — same video, an upload URL that hasn't aged out, and chunks genuinely left to send.
function resumableUpload(prior: AdapterState, sizeBytes: number): Required<
  Pick<AdapterState, 'publish_id' | 'upload_url' | 'chunk_size' | 'total_chunks' | 'next_chunk'>
> | null {
  const { publish_id, upload_url, upload_started_at, chunk_size, total_chunks } = prior;
  if (!publish_id || !upload_url || !upload_started_at) return null;
  if (typeof chunk_size !== 'number' || typeof total_chunks !== 'number') return null;
  if (prior.video_size !== sizeBytes) return null;
  const next_chunk = prior.next_chunk ?? 0;
  if (next_chunk <= 0 || next_chunk >= total_chunks) return null;
  if (Date.now() - new Date(upload_started_at).getTime() > UPLOAD_URL_TTL_MS) return null;
  return { publish_id, upload_url, chunk_size, total_chunks, next_chunk };
}

// The audit is approved, so PUBLIC_TO_EVERYONE is a real option now and is the sane default for a
// scheduler. Anything explicitly requested still has to appear in creator_info's list — TikTok
// rejects a mismatch server-side, and failing here saves the upload.
function pickPrivacyLevel(requested: string | undefined, available: string[]): string {
  if (requested) {
    if (available.length > 0 && !available.includes(requested)) {
      throw new TiktokError(
        'privacy_level_option_mismatch',
        `tiktok: privacy_level "${requested}" is not offered for this account (${available.join(', ')})`
      );
    }
    return requested;
  }
  if (available.includes('PUBLIC_TO_EVERYONE')) return 'PUBLIC_TO_EVERYONE';
  if (available.length === 0) {
    throw new TiktokError('privacy_level_option_mismatch', 'tiktok: creator_info returned no privacy_level_options');
  }
  return available[0];
}

// Chunks go up strictly in order, each one read out of R2 by byte range so a large video never has
// to exist in the isolate all at once. Progress is written back after every chunk — that is what
// makes a resume possible, and the updated_at bump it carries also tells the stale-'publishing'
// sweep that this target is alive and must not be requeued mid-transfer.
async function uploadChunks(
  postTargetId: string,
  asset: MediaAsset,
  uploadUrl: string,
  chunkSize: number,
  totalChunks: number,
  fromChunk: number,
  state: AdapterState,
  env: Env
): Promise<void> {
  for (let index = fromChunk; index < totalChunks; index++) {
    const start = index * chunkSize;
    const end = index === totalChunks - 1 ? asset.size_bytes - 1 : start + chunkSize - 1;
    const part = await env.MEDIA.get(asset.storage_key, { range: { offset: start, length: end - start + 1 } });
    if (!part) throw new Error(`tiktok: media not found in R2: ${asset.storage_key}`);

    const uploadRes = await fetchWithRetry(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': asset.mime_type,
        'Content-Range': `bytes ${start}-${end}/${asset.size_bytes}`,
      },
      body: await part.arrayBuffer(),
    });
    if (!uploadRes.ok) {
      // Distinct from TikTok's own invalid_file_upload (a bad file, permanent): a chunk that dies
      // mid-transfer after fetchWithRetry already exhausted its 5xx retries is worth one more shot,
      // and now it resumes from here instead of restarting. The poller's attempt cap bounds it.
      throw new TiktokError(
        'chunk_upload_failed',
        `tiktok: chunk ${index + 1}/${totalChunks} upload failed: ${uploadRes.status} ${(await uploadRes.text()).slice(0, 300)}`
      );
    }

    await saveAdapterState(env.DB, postTargetId, { ...state, next_chunk: index + 1 });
  }
}

export const tiktokAdapter: PlatformAdapter = {
  platform: 'tiktok',

  needsRefresh(account) {
    if (!account.access_token_expires_at) return true;
    return new Date(account.access_token_expires_at).getTime() - Date.now() < 10 * 60_000;
  },

  async ensureFreshToken(account, env) {
    // The refresh token is itself finite (~365 days) and rotates on every use. Once it's gone
    // there is no recovery except a new consent round, so say that instead of looping on a call
    // that can only fail; 'auth' classification flips the account to needs_reauth.
    if (account.refresh_token_expires_at && new Date(account.refresh_token_expires_at).getTime() <= Date.now()) {
      throw new TiktokError('access_token_invalid', 'tiktok: refresh_token expired — run tiktok-auth-url again');
    }

    const tokens = await getAccountTokens<TiktokTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.refresh_token) throw new Error('tiktok: no refresh_token on file — run tiktok-auth-url again');

    const res = await fetchWithRetry(`${API_BASE}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY,
        client_secret: env.TIKTOK_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
      }),
    });
    const json = (await readEnvelope(res, 'oauth/token (refresh)')) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      refresh_expires_in?: number;
      scope?: string;
    };

    await setAccountTokens(
      env.DB,
      account.id,
      { access_token: json.access_token, refresh_token: json.refresh_token },
      env.TOKEN_ENCRYPTION_KEY
    );
    const refreshExpiresAt = json.refresh_expires_in
      ? new Date(Date.now() + json.refresh_expires_in * 1000).toISOString()
      : account.refresh_token_expires_at;
    await env.DB.prepare(
      `update accounts set access_token_expires_at = ?, refresh_token_expires_at = ?, scope = ?, updated_at = ? where id = ?`
    )
      .bind(
        new Date(Date.now() + json.expires_in * 1000).toISOString(),
        refreshExpiresAt,
        json.scope ?? account.scope,
        nowIso(),
        account.id
      )
      .run();

    return account;
  },

  validate(_target, media) {
    if (media.length !== 1) throw new Error('tiktok: exactly one video is required');
    const asset = media[0] as MediaAsset;
    if (!asset.mime_type.startsWith('video/')) throw new Error('tiktok: media must be a video');
    // video/init declares video_size up front and the upload is rejected if the bytes don't match
    // it exactly, so a missing/zero size is a hard stop rather than something to guess around.
    if (!asset.size_bytes || asset.size_bytes <= 0) {
      throw new Error('tiktok: media_assets.size_bytes must hold the exact byte size of the video');
    }
    if (asset.size_bytes > MAX_VIDEO_BYTES) {
      throw new Error(`tiktok: video is ${asset.size_bytes} bytes, over the ${MAX_VIDEO_BYTES} byte limit`);
    }
  },

  async publish(target, media, account, env) {
    const tokens = await getAccountTokens<TiktokTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) throw new Error('tiktok: missing access_token');
    const authHeaders = {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    };

    const asset = media[0];
    const prior = target.adapter_state as AdapterState;

    // Every chunk already went up on an earlier run and only the bookkeeping was lost. TikTok is
    // holding a complete video against that publish_id, so the one thing we must not do is init a
    // second upload — that publishes the same video twice. Hand it to checkStatus instead.
    if (prior.publish_id && prior.total_chunks !== undefined && (prior.next_chunk ?? 0) >= prior.total_chunks) {
      return {
        state: 'processing',
        adapterState: { publish_id: prior.publish_id, creator_username: prior.creator_username } satisfies AdapterState,
      };
    }

    const resume = resumableUpload(prior, asset.size_bytes);
    if (resume) {
      console.log(`[tiktok] resuming upload ${resume.publish_id} at chunk ${resume.next_chunk + 1}/${resume.total_chunks}`);
      await uploadChunks(target.id, asset, resume.upload_url, resume.chunk_size, resume.total_chunks, resume.next_chunk, prior, env);
      return {
        state: 'processing',
        adapterState: { publish_id: resume.publish_id, creator_username: prior.creator_username } satisfies AdapterState,
      };
    }

    // Mandatory pre-call: it is the only source of truth for which privacy levels this creator can
    // use, which interactions they've turned off account-wide, and how long a video they may post.
    const creator = requireData<CreatorInfo>(
      await readEnvelope(
        await fetchWithRetry(`${API_BASE}/post/publish/creator_info/query/`, { method: 'POST', headers: authHeaders }),
        'creator_info/query'
      ),
      'creator_info/query'
    );

    const options = target.options as TiktokOptions;

    if (
      creator.max_video_post_duration_sec &&
      asset.duration_seconds &&
      asset.duration_seconds > creator.max_video_post_duration_sec
    ) {
      throw new TiktokError(
        'duration_check_failed',
        `tiktok: video is ${asset.duration_seconds}s, over this account's ${creator.max_video_post_duration_sec}s limit`
      );
    }

    const privacyLevel = pickPrivacyLevel(options.privacy_level, creator.privacy_level_options ?? []);
    // Branded content is public by definition — TikTok refuses the combination outright.
    if (options.brand_content_toggle && privacyLevel === 'SELF_ONLY') {
      throw new TiktokError('privacy_level_option_mismatch', 'tiktok: brand_content_toggle cannot be used with SELF_ONLY');
    }

    // An interaction the creator disabled account-wide must be sent as disabled; asking for the
    // opposite is an error, not a silent override.
    const postInfo: Record<string, unknown> = {
      title: (target.caption_override ?? '').slice(0, MAX_TITLE_CHARS),
      privacy_level: privacyLevel,
      disable_comment: Boolean(options.disable_comment) || Boolean(creator.comment_disabled),
      disable_duet: Boolean(options.disable_duet) || Boolean(creator.duet_disabled),
      disable_stitch: Boolean(options.disable_stitch) || Boolean(creator.stitch_disabled),
      brand_content_toggle: Boolean(options.brand_content_toggle),
      brand_organic_toggle: Boolean(options.brand_organic_toggle),
    };
    if (options.is_aigc !== undefined) postInfo.is_aigc = options.is_aigc;
    if (options.video_cover_timestamp_ms !== undefined) postInfo.video_cover_timestamp_ms = options.video_cover_timestamp_ms;

    const { chunkSize, totalChunks } = planChunks(asset.size_bytes);

    const init = requireData<{ publish_id: string; upload_url: string }>(
      await readEnvelope(
        await fetchWithRetry(`${API_BASE}/post/publish/video/init/`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            post_info: postInfo,
            source_info: {
              source: 'FILE_UPLOAD',
              video_size: asset.size_bytes,
              chunk_size: chunkSize,
              total_chunk_count: totalChunks,
            },
          }),
        }),
        'video/init'
      ),
      'video/init'
    );

    // Checkpoint before the first byte moves: from here on the upload is resumable, and a crash
    // costs the remaining chunks rather than the whole transfer.
    const uploadState: AdapterState = {
      publish_id: init.publish_id,
      creator_username: creator.creator_username,
      upload_url: init.upload_url,
      upload_started_at: nowIso(),
      video_size: asset.size_bytes,
      chunk_size: chunkSize,
      total_chunks: totalChunks,
      next_chunk: 0,
    };
    await saveAdapterState(env.DB, target.id, uploadState);

    await uploadChunks(target.id, asset, init.upload_url, chunkSize, totalChunks, 0, uploadState, env);

    return {
      state: 'processing',
      adapterState: { publish_id: init.publish_id, creator_username: creator.creator_username } satisfies AdapterState,
    };
  },

  async checkStatus(target, account, env) {
    const tokens = await getAccountTokens<TiktokTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) throw new Error('tiktok: missing access_token');

    const state = target.adapter_state as AdapterState;
    if (!state.publish_id) throw new Error('tiktok: missing publish_id in adapter_state');

    const data = requireData<{ status: string; fail_reason?: string; publicaly_available_post_id?: string[] }>(
      await readEnvelope(
        await fetchWithRetry(`${API_BASE}/post/publish/status/fetch/`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({ publish_id: state.publish_id }),
        }),
        'status/fetch'
      ),
      'status/fetch'
    );

    if (data.status === 'FAILED') {
      // fail_reason is a code from the same family as the API error codes, so hand it to
      // classifyError the same way rather than flattening everything into a retry.
      throw new TiktokError(data.fail_reason ?? 'publish_failed', `tiktok: publish ${state.publish_id} FAILED (${data.fail_reason ?? 'no reason given'})`);
    }

    if (data.status === 'PUBLISH_COMPLETE') {
      // publicaly_available_post_id — TikTok's own spelling — only fills in once moderation clears,
      // which for a public post can lag the PUBLISH_COMPLETE by a moment.
      const postId = data.publicaly_available_post_id?.[0];
      const username = state.creator_username;
      return {
        state: 'published',
        externalId: postId ?? state.publish_id,
        externalUrl: postId && username ? `https://www.tiktok.com/@${username}/video/${postId}` : undefined,
      };
    }

    // PROCESSING_UPLOAD / PROCESSING_DOWNLOAD / SEND_TO_USER_INBOX, plus anything new they add:
    // keep waiting and let the poller's 6h processing timeout be the backstop.
    return { state: 'processing', adapterState: state };
  },

  classifyError(err) {
    return classifyByKnownCodes(err, TIKTOK_ERROR_CLASSES);
  },
};

// Codes come from both the API error envelope and status/fetch's fail_reason — same vocabulary.
const TIKTOK_ERROR_CLASSES: Record<string, ErrorClass> = {
  access_token_invalid: 'auth',
  scope_not_authorized: 'auth',
  scope_permission_missed: 'auth',

  rate_limit_exceeded: 'quota',
  spam_risk_too_many_posts: 'quota',
  spam_risk_too_many_pending_share: 'quota',
  reached_active_user_cap: 'quota',

  spam_risk_user_banned_from_posting: 'permanent',
  spam_risk_text: 'permanent',
  unaudited_client_can_only_post_to_private_accounts: 'permanent',
  privacy_level_option_mismatch: 'permanent',
  url_ownership_unverified: 'permanent',
  file_format_check_failed: 'permanent',
  duration_check_failed: 'permanent',
  frame_rate_check_failed: 'permanent',
  picture_size_check_failed: 'permanent',
  invalid_params: 'permanent',
  invalid_file_upload: 'permanent',

  video_pull_failed: 'retryable',
  internal_error: 'retryable',
  chunk_upload_failed: 'retryable',
};
