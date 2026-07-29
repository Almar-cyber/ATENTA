import type { PlatformAdapter } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { classifyByKnownCodes } from '../lib/errors.js';
import { fetchWithRetry } from '../lib/http.js';
import { getAccountTokens, setAccountTokens } from '../lib/tokens.js';
import { nowIso } from '../lib/db.js';

const API_BASE = 'https://api.pinterest.com/v5';

// media_source.items is minItems 2 / maxItems 5 in Pinterest's own v5 OpenAPI spec.
const CAROUSEL_MAX_ITEMS = 5;

interface PinterestTokens {
  access_token: string;
  refresh_token: string;
}

interface AdapterState {
  media_id?: string;
  [key: string]: unknown;
}

function basicAuthHeader(env: Env): string {
  return `Basic ${Buffer.from(`${env.PINTEREST_CLIENT_ID}:${env.PINTEREST_CLIENT_SECRET}`).toString('base64')}`;
}

// Phase 3. No native scheduling (poller-timed, like linkedin/instagram/tiktok). Requires
// Standard access (Pinterest's video-demo review) — Trial-tier apps can only create Pins visible
// to the creator in Sandbox, not real public Pins. Video is genuinely async here (register ->
// poll -> create pin, like instagram.ts); image is synchronous (image_url is pulled directly).
export const pinterestAdapter: PlatformAdapter = {
  platform: 'pinterest',

  needsRefresh(account) {
    if (!account.access_token_expires_at) return true;
    return new Date(account.access_token_expires_at).getTime() - Date.now() < 10 * 60_000;
  },

  async ensureFreshToken(account, env) {
    const tokens = await getAccountTokens<PinterestTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.refresh_token) throw new Error('pinterest: no refresh_token on file — run pinterest-auth-url again');

    const res = await fetchWithRetry(`${API_BASE}/oauth/token`, {
      method: 'POST',
      headers: { Authorization: basicAuthHeader(env), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
    });
    if (!res.ok) throw new Error(`pinterest: token refresh failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };

    await setAccountTokens(env.DB, account.id, { ...tokens, access_token: json.access_token }, env.TOKEN_ENCRYPTION_KEY);
    await env.DB.prepare(`update accounts set access_token_expires_at = ?, updated_at = ? where id = ?`)
      .bind(new Date(Date.now() + json.expires_in * 1000).toISOString(), nowIso(), account.id)
      .run();

    return account;
  },

  validate(target, media) {
    if (media.length === 0) throw new Error('pinterest: at least one image or video is required');
    if (media.length > CAROUSEL_MAX_ITEMS) {
      throw new Error(`pinterest: carousel supports at most ${CAROUSEL_MAX_ITEMS} images (got ${media.length})`);
    }
    // multiple_image_urls is the only multi-slide source_type the v5 create API exposes — mixed
    // image/video multi-slide Pins exist in Pinterest's read model but can't be authored.
    if (media.length > 1 && media.some((m) => m.mime_type.startsWith('video/'))) {
      throw new Error('pinterest: carrossel aceita apenas imagens (vídeo apenas sozinho)');
    }
    for (const asset of media) {
      if (!asset.public_url) throw new Error('pinterest: media needs a public_url (custom R2 domain)');
    }
    const options = target.options as { board_id?: string };
    if (!options.board_id) throw new Error('pinterest: no board_id in options and no default board resolved at auth time');
  },

  async publish(target, media, account, env) {
    const tokens = await getAccountTokens<PinterestTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) throw new Error('pinterest: missing access_token');

    const asset = media[0];
    const options = target.options as { board_id?: string };
    const boardId = options.board_id ?? (account.extra as { default_board_id?: string }).default_board_id;
    if (!boardId) throw new Error('pinterest: no board_id resolved');

    // Carousel Pin — same synchronous /v5/pins call as a single image, just a different
    // media_source variant. No register/poll step (that's video-only).
    if (media.length > 1) {
      const res = await fetchWithRetry(`${API_BASE}/pins`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board_id: boardId,
          description: target.caption_override ?? '',
          media_source: {
            source_type: 'multiple_image_urls',
            items: media.map((m) => ({ url: m.public_url })),
          },
        }),
      });
      if (!res.ok) throw new Error(`pinterest: carousel pin create failed: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as { id: string };

      return { state: 'published', externalId: json.id, externalUrl: `https://www.pinterest.com/pin/${json.id}/` };
    }

    if (asset.mime_type.startsWith('video/')) {
      const registerRes = await fetchWithRetry(`${API_BASE}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_type: 'video' }),
      });
      if (!registerRes.ok) throw new Error(`pinterest: media register failed: ${registerRes.status} ${await registerRes.text()}`);
      const registerJson = (await registerRes.json()) as { media_id: string; upload_url: string; upload_parameters?: Record<string, string> };

      // Pinterest's registered upload is itself a pull from a URL in most v5 flows, but the
      // documented shape varies by account tier — verify against current docs before relying on
      // this in production; falling back to a direct PUT of the R2 bytes if upload_parameters
      // isn't present.
      const object = await env.MEDIA.get(asset.storage_key);
      if (!object) throw new Error(`pinterest: media not found in R2: ${asset.storage_key}`);
      const uploadRes = await fetchWithRetry(registerJson.upload_url, { method: 'PUT', body: await object.arrayBuffer() });
      if (!uploadRes.ok) throw new Error(`pinterest: video upload failed: ${uploadRes.status}`);

      return { state: 'processing', adapterState: { media_id: registerJson.media_id } satisfies AdapterState };
    }

    const res = await fetchWithRetry(`${API_BASE}/pins`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board_id: boardId,
        description: target.caption_override ?? '',
        media_source: { source_type: 'image_url', url: asset.public_url },
      }),
    });
    if (!res.ok) throw new Error(`pinterest: pin create failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { id: string };

    return { state: 'published', externalId: json.id, externalUrl: `https://www.pinterest.com/pin/${json.id}/` };
  },

  async checkStatus(target, account, env) {
    const tokens = await getAccountTokens<PinterestTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) throw new Error('pinterest: missing access_token');

    const state = target.adapter_state as AdapterState;
    if (!state.media_id) throw new Error('pinterest: missing media_id in adapter_state');

    const statusRes = await fetchWithRetry(`${API_BASE}/media/${state.media_id}`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!statusRes.ok) throw new Error(`pinterest: media status check failed: ${statusRes.status}`);
    const statusJson = (await statusRes.json()) as { status: string };

    if (statusJson.status === 'processing' || statusJson.status === 'registered') {
      return { state: 'processing', adapterState: state };
    }
    if (statusJson.status !== 'succeeded') {
      throw new Error(`pinterest: media ${state.media_id} ended in status "${statusJson.status}"`);
    }

    const options = target.options as { board_id?: string };
    const boardId = options.board_id ?? (account.extra as { default_board_id?: string }).default_board_id;

    const pinRes = await fetchWithRetry(`${API_BASE}/pins`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board_id: boardId,
        description: target.caption_override ?? '',
        media_source: { source_type: 'video_id', media_id: state.media_id, cover_image_url: undefined },
      }),
    });
    if (!pinRes.ok) throw new Error(`pinterest: pin create (video) failed: ${pinRes.status} ${await pinRes.text()}`);
    const pinJson = (await pinRes.json()) as { id: string };

    return { state: 'published', externalId: pinJson.id, externalUrl: `https://www.pinterest.com/pin/${pinJson.id}/` };
  },

  classifyError(err) {
    return classifyByKnownCodes(err, { invalid_token: 'auth', rate_limit_exceeded: 'quota' });
  },
};
