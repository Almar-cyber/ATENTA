import type { PlatformAdapter } from '../lib/types.js';
import { classifyByKnownCodes } from '../lib/errors.js';

// Phase 2 — container create -> poll status_code -> /media_publish, per architecture doc §3.
// Persist the container id in adapter_state and reuse it on retry instead of recreating (§1/§3).
// Shares Meta OAuth/refresh with facebook.ts.
export const instagramAdapter: PlatformAdapter = {
  platform: 'instagram',

  needsRefresh(account) {
    if (!account.access_token_expires_at) return true;
    return new Date(account.access_token_expires_at).getTime() - Date.now() < 7 * 24 * 3_600_000;
  },

  async ensureFreshToken() {
    throw new Error('instagram.ensureFreshToken not implemented yet — Phase 2');
  },

  validate() {
    throw new Error('instagram.validate not implemented yet — Phase 2');
  },

  async publish() {
    throw new Error('instagram.publish not implemented yet — Phase 2');
  },

  async checkStatus() {
    throw new Error('instagram.checkStatus not implemented yet — Phase 2');
  },

  classifyError(err) {
    return classifyByKnownCodes(err, {
      OAuthException: 'auth',
      190: 'auth',
    });
  },
};
