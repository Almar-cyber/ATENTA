import type { PlatformAdapter } from '../lib/types.js';
import { classifyByKnownCodes } from '../lib/errors.js';
import { fetchWithRetry } from '../lib/http.js';
import { getAccountTokens, setAccountTokens } from '../lib/tokens.js';
import { nowIso } from '../lib/db.js';

const API_BASE = 'https://open.tiktokapis.com/v2';

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
    if (!creatorRes.ok) throw new Error(`tiktok: creator_info/query failed: ${creatorRes.status} ${await creatorRes.text()}`);
    const creatorJson = (await creatorRes.json()) as { data: { privacy_level_options: string[] } };

    const options = target.options as { privacy_level?: string; disable_duet?: boolean; disable_comment?: boolean; disable_stitch?: boolean };
    const privacyLevel = options.privacy_level ?? creatorJson.data.privacy_level_options[0];
    if (!privacyLevel) throw new Error('tiktok: no privacy_level available from creator_info');

    const asset = media[0];
    const object = await env.MEDIA.get(asset.storage_key);
    if (!object) throw new Error(`tiktok: media not found in R2: ${asset.storage_key}`);
    const bytes = await object.arrayBuffer();

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
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: asset.size_bytes,
          chunk_size: asset.size_bytes,
          total_chunk_count: 1,
        },
      }),
    });
    if (!initRes.ok) throw new Error(`tiktok: video/init failed: ${initRes.status} ${await initRes.text()}`);
    const initJson = (await initRes.json()) as { data: { publish_id: string; upload_url: string } };

    const uploadRes = await fetchWithRetry(initJson.data.upload_url, {
      method: 'PUT',
      headers: {
        'Content-Type': asset.mime_type,
        'Content-Range': `bytes 0-${asset.size_bytes - 1}/${asset.size_bytes}`,
      },
      body: bytes,
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
    if (!res.ok) throw new Error(`tiktok: status/fetch failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data: { status: string; publicaly_available_post_id?: string[] } };

    if (json.data.status === 'PROCESSING_DOWNLOAD' || json.data.status === 'PROCESSING_UPLOAD' || json.data.status === 'PROCESSING') {
      return { state: 'processing', adapterState: state };
    }
    if (json.data.status === 'FAILED') {
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
    });
  },
};
