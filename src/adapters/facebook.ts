import type { PublishResult, PlatformAdapter } from '../lib/types.js';
import { classifyByKnownCodes } from '../lib/errors.js';
import { fetchWithRetry } from '../lib/http.js';
import { getAccountTokens } from '../lib/tokens.js';

const GRAPH_VERSION = 'v21.0';

// Meta documents no numeric cap for attached_media on a Page /feed post; 10 is a conservative
// self-imposed limit matching what the Facebook composer itself allows.
const CAROUSEL_MAX_ITEMS = 10;

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

  validate(_target, media) {
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
        if (!photoRes.ok) throw new Error(`facebook: unpublished photo upload failed: ${photoRes.status} ${await photoRes.text()}`);
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
  if (!res.ok) throw new Error(`facebook: publish failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id: string; post_id?: string };
  const externalId = json.post_id ?? json.id;

  return { state: 'published', externalId, externalUrl: `https://www.facebook.com/${externalId}` };
}
