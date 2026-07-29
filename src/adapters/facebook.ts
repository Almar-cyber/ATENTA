import type { PlatformAdapter } from '../lib/types.js';
import { classifyByKnownCodes } from '../lib/errors.js';

// Phase 2 — /feed, /photos, and native scheduled_publish_time per architecture doc §3.
// Shares Meta OAuth/refresh with instagram.ts.
export const facebookAdapter: PlatformAdapter = {
  platform: 'facebook',

  needsRefresh(account) {
    if (!account.access_token_expires_at) return true;
    return new Date(account.access_token_expires_at).getTime() - Date.now() < 7 * 24 * 3_600_000;
  },

  async ensureFreshToken() {
    throw new Error('facebook.ensureFreshToken not implemented yet — Phase 2');
  },

  validate() {
    throw new Error('facebook.validate not implemented yet — Phase 2');
  },

  async publish() {
    throw new Error('facebook.publish not implemented yet — Phase 2');
  },

  async checkStatus() {
    throw new Error('facebook.checkStatus not implemented yet — Phase 2');
  },

  classifyError(err) {
    return classifyByKnownCodes(err, {
      OAuthException: 'auth',
      190: 'auth',
    });
  },
};
