import type { PlatformAdapter } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { classifyByKnownCodes } from '../lib/errors.js';
import { fetchWithRetry } from '../lib/http.js';
import { getAccountTokens, setAccountTokens } from '../lib/tokens.js';
import { nowIso } from '../lib/db.js';

interface YoutubeTokens {
  access_token: string;
  refresh_token: string;
}

// NOTE: single-PUT upload below (not the chunked 256KB-boundary resumable protocol from the
// architecture doc) — fine for typical personal-use video sizes, but large files can exceed a
// Worker's CPU/memory limits in one shot. TODO: chunk + persist byte offset in
// post_targets.adapter_state if that becomes a real constraint.
export const youtubeAdapter: PlatformAdapter = {
  platform: 'youtube',

  needsRefresh(account) {
    if (!account.access_token_expires_at) return true;
    return new Date(account.access_token_expires_at).getTime() - Date.now() < 5 * 60_000;
  },

  async ensureFreshToken(account, env) {
    const tokens = await getAccountTokens<YoutubeTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.refresh_token) {
      throw new Error('youtube: no refresh_token on file — run `npm run youtube-auth` again');
    }

    const res = await fetchWithRetry('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.YOUTUBE_CLIENT_ID,
        client_secret: env.YOUTUBE_CLIENT_SECRET,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new Error(`youtube: token refresh failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };

    await setAccountTokens(env.DB, account.id, { ...tokens, access_token: json.access_token }, env.TOKEN_ENCRYPTION_KEY);
    await env.DB.prepare(`update accounts set access_token_expires_at = ?, updated_at = ? where id = ?`)
      .bind(new Date(Date.now() + json.expires_in * 1000).toISOString(), nowIso(), account.id)
      .run();

    return account;
  },

  validate(_target, media) {
    if (media.length !== 1) throw new Error('youtube: exactly one video file required');
    if (!media[0].mime_type.startsWith('video/')) throw new Error('youtube: media must be a video file');
  },

  async publish(target, media, account, env) {
    const tokens = await getAccountTokens<YoutubeTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) throw new Error('youtube: no access_token on file');

    const video = media[0];
    const object = await env.MEDIA.get(video.storage_key);
    if (!object) throw new Error(`youtube: media object not found in R2: ${video.storage_key}`);
    const bytes = await object.arrayBuffer();

    // NOT using YouTube's native privacyStatus:'private' + publishAt scheduling: the poller
    // (worker.ts) only calls publish() once scheduled_for is already due, so by the time we'd
    // send publishAt it could already be in the past — YouTube rejects that with 400
    // invalidPublishAt. Publishing straight to 'public' here keeps one uniform timing model
    // (the poller's ~10-15min cadence) across all six platforms instead of a second,
    // finer-grained native-scheduling path — see README "Pendências".
    const options = target.options as { categoryId?: string; title?: string; madeForKids?: boolean };
    const metadata = {
      snippet: {
        title: options.title ?? target.caption_override?.slice(0, 100) ?? 'Untitled',
        description: target.caption_override ?? '',
        categoryId: options.categoryId ?? '22',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: options.madeForKids ?? false,
      },
    };

    const initRes = await fetchWithRetry(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': video.mime_type,
          'X-Upload-Content-Length': String(video.size_bytes),
        },
        body: JSON.stringify(metadata),
      }
    );
    if (!initRes.ok) throw new Error(`youtube: upload init failed: ${initRes.status} ${await initRes.text()}`);
    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) throw new Error('youtube: no resumable upload URL returned');

    const uploadRes = await fetchWithRetry(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': video.mime_type, 'Content-Length': String(video.size_bytes) },
      body: bytes,
    });
    if (!uploadRes.ok) throw new Error(`youtube: upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
    const result = (await uploadRes.json()) as { id: string };

    return { state: 'published', externalId: result.id, externalUrl: `https://youtu.be/${result.id}` };
  },

  async checkStatus() {
    throw new Error('youtube: checkStatus is unused — publish() completes synchronously end-to-end');
  },

  classifyError(err) {
    return classifyByKnownCodes(err, {
      quotaExceeded: 'quota',
      invalid_grant: 'auth',
      invalidPublishAt: 'permanent',
    });
  },
};
