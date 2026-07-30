import type { PlatformAdapter, MediaAsset } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { classifyByKnownCodes, safeParseJson } from '../lib/errors.js';
import { fetchWithRetry, toFixedLengthBody } from '../lib/http.js';
import { getAccountTokens } from '../lib/tokens.js';
import { checkDuration } from '../lib/videoLimits.js';

export const LINKEDIN_VERSION = '202607';

// content.multiImage.images accepts 2-20 images (LinkedIn MultiImage API schema).
const MULTI_IMAGE_MAX = 20;

// learn.microsoft.com/linkedin video spec (API technically accepts up to 5GB, but spec's own
// duration figure is what's enforced here).
const MIN_VIDEO_DURATION_SECONDS = 3;
const MAX_VIDEO_DURATION_SECONDS = 1800;

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

// Single image, single video, or a 2-20 image multiImage post. Organic posts have no multi-video
// or mixed image+video shape — content.carousel is sponsored-only, so it isn't used here.
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
    if (media.length > MULTI_IMAGE_MAX) {
      throw new Error(`linkedin: at most ${MULTI_IMAGE_MAX} images per post (got ${media.length})`);
    }
    // content.multiImage.images[] only accepts urn:li:image URNs — LinkedIn has no organic
    // multi-video or mixed image+video post type (carousel cards are ads-only).
    if (media.length > 1 && media.some((m) => m.mime_type.startsWith('video/'))) {
      throw new Error('linkedin: multi-media posts support images only (vídeo apenas sozinho)');
    }
    if (media.length === 1 && media[0].mime_type.startsWith('video/')) {
      checkDuration('linkedin', media[0], MIN_VIDEO_DURATION_SECONDS, MAX_VIDEO_DURATION_SECONDS);
    }
  },

  async publish(target, media, account, env) {
    const tokens = await getAccountTokens<LinkedinTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token || !tokens.member_urn) throw new Error('linkedin: missing access_token/member_urn');

    let content: Record<string, unknown> | undefined;
    if (media.length > 1) {
      // Each image needs its own initializeUpload + PUT — there's no batch upload endpoint, so
      // this is just the single-image helper run once per asset, collecting the URNs in order.
      const images: Array<{ id: string }> = [];
      for (const asset of media) {
        images.push({ id: await uploadImage(env, tokens, asset) });
      }
      content = { multiImage: { images } };
    } else if (media.length === 1) {
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
      const bodyText = await res.text();
      throw Object.assign(new Error(`linkedin: post failed: ${res.status} ${bodyText}`), { code: linkedinErrorCode(bodyText) });
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
  if (!initRes.ok) {
    const bodyText = await initRes.text();
    throw Object.assign(new Error(`linkedin: image init failed: ${initRes.status} ${bodyText}`), { code: linkedinErrorCode(bodyText) });
  }
  const initJson = (await initRes.json()) as { value: { uploadUrl: string; image: string } };

  const object = await env.MEDIA.get(asset.storage_key);
  if (!object) throw new Error(`linkedin: media not found in R2: ${asset.storage_key}`);

  // No Authorization header on this PUT — it's a pre-signed one-time upload URL (per LinkedIn docs),
  // not a LinkedIn REST API response, so there's no {code,message} envelope here to parse.
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
  if (!initRes.ok) {
    const bodyText = await initRes.text();
    throw Object.assign(new Error(`linkedin: video init failed: ${initRes.status} ${bodyText}`), { code: linkedinErrorCode(bodyText) });
  }
  const initJson = (await initRes.json()) as {
    value: {
      uploadInstructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>;
      video: string;
      uploadToken: string;
    };
  };

  // One range read per chunk (not the whole video up front) — keeps memory bounded to a single
  // chunk regardless of the video's total size. The read happens inside the fetchWithRetry
  // factory so a retry gets a fresh R2 read instead of an already-consumed stream.
  const uploadedPartIds: string[] = [];
  for (const instr of initJson.value.uploadInstructions) {
    const length = instr.lastByte - instr.firstByte + 1;
    const res = await fetchWithRetry(instr.uploadUrl, async () => {
      const object = await env.MEDIA.get(asset.storage_key, { range: { offset: instr.firstByte, length } });
      if (!object || !('body' in object)) throw new Error(`linkedin: media not found in R2: ${asset.storage_key}`);
      return { method: 'PUT', body: toFixedLengthBody(object.body, length) };
    });
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
  if (!finalizeRes.ok) {
    const bodyText = await finalizeRes.text();
    throw Object.assign(new Error(`linkedin: video finalize failed: ${finalizeRes.status} ${bodyText}`), {
      code: linkedinErrorCode(bodyText),
    });
  }

  return initJson.value.video;
}

// LinkedIn's versioned REST APIs return { status, code, message } on failure (Handling Errors,
// learn.microsoft.com/linkedin) — `code` (e.g. "REVOKED_ACCESS_TOKEN", "ACCESS_DENIED") is the
// documented field and is checked first. Falls back to a bare `error` field in case a 401 instead
// carries an OAuth-Bearer-style body (RFC 6750) — unconfirmed against a live account, but cheap to
// also check. NOTE: classifyError's lowercase `invalid_access_token` key doesn't obviously match
// either documented shape above (both are UPPER_SNAKE_CASE) — flagging as unverified rather than
// guessing further; worth checking against a real expired/invalid-token response.
function linkedinErrorCode(bodyText: string): string | undefined {
  const parsed = safeParseJson(bodyText) as { code?: string; error?: string } | undefined;
  return parsed?.code ?? parsed?.error;
}
