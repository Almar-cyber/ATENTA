import type { PlatformAdapter } from '../lib/types.js';
import { classifyByKnownCodes, safeParseJson } from '../lib/errors.js';
import { fetchWithRetry, toFixedLengthBody } from '../lib/http.js';
import { getAccountTokens, setAccountTokens } from '../lib/tokens.js';
import { nowIso } from '../lib/db.js';
import { checkDuration } from '../lib/videoLimits.js';

const API_BASE = 'https://open.tiktokapis.com/v2';

// developers.tiktok.com — absolute ceiling across all creators. The real, tighter per-creator
// limit is live data from creator_info/query, checked in publish() below before upload.
const MAX_VIDEO_DURATION_SECONDS = 600;

interface TiktokTokens {
  access_token: string;
  refresh_token: string;
}

interface AdapterState {
  publish_id?: string;
  [key: string]: unknown;
}

// Phase 4 — the longest lead time of all six platforms: the Content Posting API scope needs a
// review (demo video + privacy policy, ~5 days to 6 weeks) before this can post anything but
// SELF_ONLY to sandboxed test accounts. Submit that application as early as possible; this
// adapter is written so the integration is ready the moment it clears, not blocking on it.
//
// LOWER CONFIDENCE THAN THE OTHER ADAPTERS: TikTok's exact request/response field names below
// come from documented patterns at research time, not a live test against their API — verify
// against https://developers.tiktok.com/doc/content-posting-api-reference-direct-post before
// trusting this against a real (non-sandbox) account.
export const tiktokAdapter: PlatformAdapter = {
  platform: 'tiktok',

  needsRefresh(account) {
    if (!account.access_token_expires_at) return true;
    return new Date(account.access_token_expires_at).getTime() - Date.now() < 10 * 60_000;
  },

  async ensureFreshToken(account, env) {
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
    if (!res.ok) throw new Error(`tiktok: token refresh failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };

    await setAccountTokens(env.DB, account.id, json, env.TOKEN_ENCRYPTION_KEY);
    await env.DB.prepare(`update accounts set access_token_expires_at = ?, updated_at = ? where id = ?`)
      .bind(new Date(Date.now() + json.expires_in * 1000).toISOString(), nowIso(), account.id)
      .run();

    return account;
  },

  validate(_target, media) {
    if (media.length !== 1) throw new Error('tiktok: exactly one video is required');
    if (!media[0].mime_type.startsWith('video/')) throw new Error('tiktok: media must be a video');
    checkDuration('tiktok', media[0], undefined, MAX_VIDEO_DURATION_SECONDS);
  },

  async publish(target, media, account, env) {
    const tokens = await getAccountTokens<TiktokTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) throw new Error('tiktok: missing access_token');

    // Mandatory pre-call — also where the enforced SELF_ONLY privacy_level (until the scope
    // audit clears) becomes visible in privacy_level_options.
    const creatorRes = await fetchWithRetry(`${API_BASE}/post/publish/creator_info/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
    });
    if (!creatorRes.ok) {
      const bodyText = await creatorRes.text();
      throw Object.assign(new Error(`tiktok: creator_info/query failed: ${creatorRes.status} ${bodyText}`), {
        code: tiktokErrorCode(bodyText),
      });
    }
    const creatorJson = (await creatorRes.json()) as {
      data: { privacy_level_options: string[]; max_video_post_duration_sec?: number };
    };

    const options = target.options as { privacy_level?: string; disable_duet?: boolean; disable_comment?: boolean; disable_stitch?: boolean; cover_timestamp_ms?: number };
    const privacyLevel = options.privacy_level ?? creatorJson.data.privacy_level_options[0];
    if (!privacyLevel) throw new Error('tiktok: no privacy_level available from creator_info');

    const asset = media[0];

    // The real, per-creator ceiling — tighter than (and only knowable via) this live call, unlike
    // the platform-wide absolute limit already checked in validate(). Not a known-codes API error,
    // so classifyError() below needs its own entry to route this to 'permanent' instead of the
    // 'retryable' default (retrying won't shrink the video).
    const creatorMaxDuration = creatorJson.data.max_video_post_duration_sec;
    if (creatorMaxDuration != null && asset.duration_seconds != null && asset.duration_seconds > creatorMaxDuration) {
      throw Object.assign(
        new Error(`tiktok: vídeo muito longo para este criador (${asset.duration_seconds.toFixed(0)}s, máximo ${creatorMaxDuration}s)`),
        { code: 'video_too_long_for_creator' }
      );
    }

    const initRes = await fetchWithRetry(`${API_BASE}/post/publish/video/init/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_info: {
          title: target.caption_override ?? '',
          privacy_level: privacyLevel,
          disable_duet: options.disable_duet ?? false,
          disable_comment: options.disable_comment ?? false,
          disable_stitch: options.disable_stitch ?? false,
          // TikTok não aceita imagem de capa: só escolher um frame do próprio vídeo.
          ...(options.cover_timestamp_ms != null ? { video_cover_timestamp_ms: options.cover_timestamp_ms } : {}),
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: asset.size_bytes,
          chunk_size: asset.size_bytes,
          total_chunk_count: 1,
        },
      }),
    });
    if (!initRes.ok) {
      const bodyText = await initRes.text();
      throw Object.assign(new Error(`tiktok: video/init failed: ${initRes.status} ${bodyText}`), { code: tiktokErrorCode(bodyText) });
    }
    const initJson = (await initRes.json()) as { data: { publish_id: string; upload_url: string } };

    // Single request (source_info above already told TikTok this is one chunk covering the whole
    // file) — streamed from R2 rather than buffered, so the Worker never holds the whole video
    // in memory at once. Uploads to a signed storage URL, not TikTok's own API, so there's no
    // {error:{code,...}} envelope to parse here on failure (unlike the other throws in this file).
    const uploadRes = await fetchWithRetry(initJson.data.upload_url, async () => {
      const object = await env.MEDIA.get(asset.storage_key);
      if (!object) throw new Error(`tiktok: media not found in R2: ${asset.storage_key}`);
      return {
        method: 'PUT',
        headers: {
          'Content-Type': asset.mime_type,
          'Content-Range': `bytes 0-${asset.size_bytes - 1}/${asset.size_bytes}`,
        },
        body: toFixedLengthBody(object.body, asset.size_bytes),
      };
    });
    if (!uploadRes.ok) throw new Error(`tiktok: chunk upload failed: ${uploadRes.status}`);

    return { state: 'processing', adapterState: { publish_id: initJson.data.publish_id } satisfies AdapterState };
  },

  async checkStatus(target, account, env) {
    const tokens = await getAccountTokens<TiktokTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) throw new Error('tiktok: missing access_token');

    const state = target.adapter_state as AdapterState;
    if (!state.publish_id) throw new Error('tiktok: missing publish_id in adapter_state');

    const res = await fetchWithRetry(`${API_BASE}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish_id: state.publish_id }),
    });
    if (!res.ok) {
      const bodyText = await res.text();
      throw Object.assign(new Error(`tiktok: status/fetch failed: ${res.status} ${bodyText}`), { code: tiktokErrorCode(bodyText) });
    }
    const json = (await res.json()) as { data: { status: string; publicaly_available_post_id?: string[] } };

    if (json.data.status === 'PROCESSING_DOWNLOAD' || json.data.status === 'PROCESSING_UPLOAD' || json.data.status === 'PROCESSING') {
      return { state: 'processing', adapterState: state };
    }
    if (json.data.status === 'FAILED') {
      // 200 OK with a business-level failure, not the {error:{code,...}} envelope the other
      // throws above parse — TikTok's docs don't confirm a stable machine-readable failure-reason
      // field on this endpoint's `data`, so nothing is attached here (stays 'retryable' via
      // classifyError's fallback, same as before this change).
      throw new Error(`tiktok: publish ${state.publish_id} ended in FAILED`);
    }
    // PUBLISH_COMPLETE (naming per TikTok docs at research time — verify before relying on it)
    const postId = json.data.publicaly_available_post_id?.[0];
    return { state: 'published', externalId: postId ?? state.publish_id };
  },

  classifyError(err) {
    return classifyByKnownCodes(err, {
      access_token_invalid: 'auth',
      spam_risk_too_many_posts: 'quota',
      url_ownership_unverified: 'permanent',
      privacy_level_option_mismatch: 'permanent',
      video_too_long_for_creator: 'permanent',
    });
  },
};

// TikTok's v2 envelope: { data, error: { code, message, log_id } } — `error.code` is the
// documented machine-readable string (e.g. "access_token_invalid"), matching classifyError's
// table keys directly with no coercion needed.
function tiktokErrorCode(bodyText: string): string | undefined {
  const parsed = safeParseJson(bodyText) as { error?: { code?: string } } | undefined;
  return parsed?.error?.code;
}
