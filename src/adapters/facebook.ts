import type { PlatformAdapter } from '../lib/types.js';
import { classifyByKnownCodes } from '../lib/errors.js';
import { fetchWithRetry } from '../lib/http.js';
import { getAccountTokens } from '../lib/tokens.js';

const GRAPH_VERSION = 'v21.0';

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
    if (media.length > 1) throw new Error('facebook: only a single image or video is supported in Phase 2');
    if (media.length === 1 && !media[0].public_url) {
      throw new Error('facebook: media needs a public_url (custom R2 domain) — see README Pendências');
    }
  },

  async publish(target, media, account, env) {
    const tokens = await getAccountTokens<MetaTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) throw new Error('facebook: missing access_token');
    if (!account.external_account_id) throw new Error('facebook: missing page id (external_account_id)');

    const pageId = account.external_account_id;
    const message = target.caption_override ?? '';
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

    const res = await fetchWithRetry(`https://graph.facebook.com/${GRAPH_VERSION}/${endpoint}`, { method: 'POST', body });
    if (!res.ok) throw new Error(`facebook: publish failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { id: string; post_id?: string };
    const externalId = json.post_id ?? json.id;

    return { state: 'published', externalId, externalUrl: `https://www.facebook.com/${externalId}` };
  },

  async checkStatus() {
    throw new Error('facebook: checkStatus is unused — publish() completes synchronously end-to-end');
  },

  classifyError(err) {
    return classifyByKnownCodes(err, { OAuthException: 'auth', '190': 'auth' });
  },
};
