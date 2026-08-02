import type { PublishResult, PlatformAdapter } from '../lib/types.js';
import { classifyByKnownCodes, safeParseJson } from '../lib/errors.js';
import { fetchWithRetry } from '../lib/http.js';
import { getAccountTokens } from '../lib/tokens.js';
import { checkDuration } from '../lib/videoLimits.js';

const GRAPH_VERSION = 'v21.0';

// Meta documents no numeric cap for attached_media on a Page /feed post; 10 is a conservative
// self-imposed limit matching what the Facebook composer itself allows.
const CAROUSEL_MAX_ITEMS = 10;

// Meta's own docs are inconsistent across endpoints (simple upload vs. resumable vs. Business
// Help Center figures range from 1200s to 4h) — using the most conservative documented figure.
// No minimum duration is documented, so none is enforced.
const MAX_VIDEO_DURATION_SECONDS = 1200;

interface MetaTokens {
  access_token: string; // Page access token, shared with instagram.ts's own copy on the linked IG account row
}

// Phase 2. Page access tokens obtained via a long-lived user token are effectively non-expiring
// in normal use (die on password change / permission revoke / ~90 days unused) — there's no
// standard refresh grant to call proactively, so needsRefresh stays false and a dead token is
// instead caught reactively when a publish call fails with an OAuthException (classifyError below
// -> 'auth' -> worker.ts flips the account to needs_reauth). Re-authenticate with `npm run
// meta-auth-url`. No native scheduled_publish_time here — see youtube.ts for why (same reasoning:
// the poller already waits until the due time before calling publish()).
export const facebookAdapter: PlatformAdapter = {
  platform: 'facebook',

  needsRefresh() {
    return false;
  },

  async ensureFreshToken() {
    throw new Error('facebook: no refresh mechanism implemented — run meta-auth-url again if needs_reauth');
  },

  validate(target, media, _account) {
    // Diferente do Instagram/TikTok/Pinterest, onde legenda vazia é aceita: um post só-texto no
    // Facebook sem legenda não tem o que publicar. Com mídia, a legenda é opcional (vira o texto
    // que acompanha a foto/vídeo).
    if (media.length === 0 && !target.caption_override) {
      throw new Error('facebook: um post só-texto precisa de legenda — não há o que publicar');
    }
    if (media.length > CAROUSEL_MAX_ITEMS) {
      throw new Error(`facebook: at most ${CAROUSEL_MAX_ITEMS} photos per post (got ${media.length})`);
    }
    // Page /feed carousels are photos-only: there's no documented way to put a video's media_fbid
    // in attached_media, and Meta's own dev forum confirms mixed photo+video posts aren't possible
    // this way. A single video still publishes fine via /videos below.
    if (media.length > 1 && media.some((m) => m.mime_type.startsWith('video/'))) {
      throw new Error('facebook: multi-media posts support images only (vídeo apenas sozinho)');
    }
    for (const asset of media) {
      if (!asset.public_url) {
        throw new Error('facebook: media needs a public_url (custom R2 domain) — see README Pendências');
      }
      if (asset.mime_type.startsWith('video/')) {
        checkDuration('facebook', asset, undefined, MAX_VIDEO_DURATION_SECONDS);
      }
    }
  },

  async publish(target, media, account, env) {
    const tokens = await getAccountTokens<MetaTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) throw new Error('facebook: missing access_token');
    if (!account.external_account_id) throw new Error('facebook: missing page id (external_account_id)');

    const pageId = account.external_account_id;
    const message = target.caption_override ?? '';

    // Multi-photo carousel: upload each photo unpublished (published=false) to collect its
    // media_fbid, then attach them all to one /feed post. Unpublished photos are dropped by Meta
    // after ~24h if never attached, so the second call has to follow promptly — it does, both
    // happen in this one invocation.
    if (media.length > 1) {
      const mediaFbids: string[] = [];
      for (const asset of media) {
        const photoRes = await fetchWithRetry(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`, {
          method: 'POST',
          body: new URLSearchParams({
            access_token: tokens.access_token,
            url: asset.public_url!,
            published: 'false',
          }),
        });
        if (!photoRes.ok) {
          const bodyText = await photoRes.text();
          throw Object.assign(new Error(`facebook: unpublished photo upload failed: ${photoRes.status} ${bodyText}`), {
            code: metaErrorType(bodyText),
          });
        }
        mediaFbids.push(((await photoRes.json()) as { id: string }).id);
      }

      const feedBody = new URLSearchParams({ access_token: tokens.access_token, message });
      // Indexed bracket keys, each value a JSON object — the only form Meta documents for this.
      mediaFbids.forEach((fbid, i) => feedBody.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: fbid })));

      return publishTo(`${pageId}/feed`, feedBody);
    }

    const body = new URLSearchParams({ access_token: tokens.access_token });

    let endpoint: string;
    if (media.length === 0) {
      endpoint = `${pageId}/feed`;
      body.set('message', message);
    } else {
      const asset = media[0];
      if (asset.mime_type.startsWith('video/')) {
        endpoint = `${pageId}/videos`;
        body.set('description', message);
        body.set('file_url', asset.public_url!);
      } else {
        endpoint = `${pageId}/photos`;
        body.set('caption', message);
        body.set('url', asset.public_url!);
      }
    }

    return publishTo(endpoint, body);
  },

  async checkStatus() {
    throw new Error('facebook: checkStatus is unused — publish() completes synchronously end-to-end');
  },

  classifyError(err) {
    return classifyByKnownCodes(err, { OAuthException: 'auth', '190': 'auth' });
  },
};

async function publishTo(endpoint: string, body: URLSearchParams): Promise<PublishResult> {
  const res = await fetchWithRetry(`https://graph.facebook.com/${GRAPH_VERSION}/${endpoint}`, { method: 'POST', body });
  if (!res.ok) {
    const bodyText = await res.text();
    throw Object.assign(new Error(`facebook: publish failed: ${res.status} ${bodyText}`), { code: metaErrorType(bodyText) });
  }
  const json = (await res.json()) as { id: string; post_id?: string };
  const externalId = json.post_id ?? json.id;

  return { state: 'published', externalId, externalUrl: `https://www.facebook.com/${externalId}` };
}

// Graph API error envelope: { error: { message, type, code, error_subcode?, fbtrace_id } }. `type`
// (e.g. "OAuthException") is used over the numeric `code` since it covers the whole family of
// token-invalid codes (190, 102, ...) that classifyError's 'OAuthException' key is meant to catch,
// not just the specific 190 case.
function metaErrorType(bodyText: string): string | undefined {
  const parsed = safeParseJson(bodyText) as { error?: { type?: string } } | undefined;
  return parsed?.error?.type;
}
