import type { PlatformAdapter, MediaAsset } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { classifyByKnownCodes } from '../lib/errors.js';
import { fetchWithRetry } from '../lib/http.js';
import { getAccountTokens } from '../lib/tokens.js';

export const LINKEDIN_VERSION = '202607';

interface LinkedinTokens {
  access_token: string;
  member_urn: string; // urn:li:person:{sub} — resolved once at auth time (see worker.ts callback)
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'LinkedIn-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

// Phase 1 scope: single image or single video per post (no multi-image carousel yet).
export const linkedinAdapter: PlatformAdapter = {
  platform: 'linkedin',

  needsRefresh(account) {
    if (!account.access_token_expires_at) return true;
    return new Date(account.access_token_expires_at).getTime() - Date.now() < 24 * 3_600_000;
  },

  async ensureFreshToken() {
    // No refresh token on the self-serve w_member_social tier (architecture doc §4) — there is
    // nothing to silently refresh. The token-health scan (worker.ts Step 0) calling this when
    // the 60-day access token is close to expiry is itself the signal to flip needs_reauth;
    // reauth is a human clicking through `npm run linkedin-auth-url` again.
    throw new Error('linkedin: token nearing expiry, no refresh possible — run linkedin-auth-url again');
  },

  validate(_target, media) {
    if (media.length > 1) throw new Error('linkedin: only a single image or video is supported in Phase 1');
  },

  async publish(target, media, account, env) {
    const tokens = await getAccountTokens<LinkedinTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token || !tokens.member_urn) throw new Error('linkedin: missing access_token/member_urn');

    let content: Record<string, unknown> | undefined;
    if (media.length === 1) {
      const asset = media[0];
      const mediaUrn = asset.mime_type.startsWith('video/')
        ? await uploadVideo(env, tokens, asset)
        : await uploadImage(env, tokens, asset);
      content = { media: { id: mediaUrn } };
    }

    const body = {
      author: tokens.member_urn,
      commentary: target.caption_override ?? '',
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED' },
      lifecycleState: 'PUBLISHED',
      ...(content ? { content } : {}),
    };

    const res = await fetchWithRetry('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: authHeaders(tokens.access_token),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // No read-back permission on this tier — classifyError() below routes network-level
      // failures here to 'ambiguous' rather than a blind retry (architecture doc §2/§3).
      throw new Error(`linkedin: post failed: ${res.status} ${await res.text()}`);
    }
    const postUrn = res.headers.get('x-restli-id');
    if (!postUrn) throw new Error('linkedin: no post URN in x-restli-id header');

    return { state: 'published', externalId: postUrn };
  },

  async checkStatus() {
    throw new Error('linkedin: checkStatus is unused — publish() completes synchronously end-to-end');
  },

  classifyError(err) {
    if (err instanceof TypeError) return 'ambiguous'; // network-level failure after send — can't confirm receipt
    return classifyByKnownCodes(err, {
      invalid_access_token: 'auth',
      REVOKED_ACCESS_TOKEN: 'auth',
      ACCESS_DENIED: 'permanent',
    });
  },
};

async function uploadImage(env: Env, tokens: LinkedinTokens, asset: MediaAsset): Promise<string> {
  const initRes = await fetchWithRetry('https://api.linkedin.com/rest/images?action=initializeUpload', {
    method: 'POST',
    headers: authHeaders(tokens.access_token),
    body: JSON.stringify({ initializeUploadRequest: { owner: tokens.member_urn } }),
  });
  if (!initRes.ok) throw new Error(`linkedin: image init failed: ${initRes.status} ${await initRes.text()}`);
  const initJson = (await initRes.json()) as { value: { uploadUrl: string; image: string } };

  const object = await env.MEDIA.get(asset.storage_key);
  if (!object) throw new Error(`linkedin: media not found in R2: ${asset.storage_key}`);

  // No Authorization header on this PUT — it's a pre-signed one-time upload URL (per LinkedIn docs).
  const uploadRes = await fetchWithRetry(initJson.value.uploadUrl, { method: 'PUT', body: await object.arrayBuffer() });
  if (!uploadRes.ok) throw new Error(`linkedin: image upload failed: ${uploadRes.status}`);

  return initJson.value.image;
}

async function uploadVideo(env: Env, tokens: LinkedinTokens, asset: MediaAsset): Promise<string> {
  const initRes = await fetchWithRetry('https://api.linkedin.com/rest/videos?action=initializeUpload', {
    method: 'POST',
    headers: authHeaders(tokens.access_token),
    body: JSON.stringify({
      initializeUploadRequest: { owner: tokens.member_urn, fileSizeBytes: asset.size_bytes, uploadCaptions: false },
    }),
  });
  if (!initRes.ok) throw new Error(`linkedin: video init failed: ${initRes.status} ${await initRes.text()}`);
  const initJson = (await initRes.json()) as {
    value: {
      uploadInstructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>;
      video: string;
      uploadToken: string;
    };
  };

  const object = await env.MEDIA.get(asset.storage_key);
  if (!object) throw new Error(`linkedin: media not found in R2: ${asset.storage_key}`);
  const bytes = new Uint8Array(await object.arrayBuffer());

  const uploadedPartIds: string[] = [];
  for (const instr of initJson.value.uploadInstructions) {
    const chunk = bytes.slice(instr.firstByte, instr.lastByte + 1);
    const res = await fetchWithRetry(instr.uploadUrl, { method: 'PUT', body: chunk });
    if (!res.ok) throw new Error(`linkedin: video chunk upload failed: ${res.status}`);
    const etag = res.headers.get('ETag');
    if (etag) uploadedPartIds.push(etag);
  }

  const finalizeRes = await fetchWithRetry('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
    method: 'POST',
    headers: authHeaders(tokens.access_token),
    body: JSON.stringify({
      finalizeUploadRequest: { video: initJson.value.video, uploadToken: initJson.value.uploadToken, uploadedPartIds },
    }),
  });
  if (!finalizeRes.ok) throw new Error(`linkedin: video finalize failed: ${finalizeRes.status} ${await finalizeRes.text()}`);

  return initJson.value.video;
}
