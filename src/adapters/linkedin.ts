import type { PlatformAdapter } from '../lib/types.js';
import { classifyByKnownCodes } from '../lib/errors.js';

// Phase 1 — /rest/posts + initializeUpload chain per architecture doc §3. No refresh token on
// the self-serve w_member_social tier: ensureFreshToken should flip the account to
// needs_reauth rather than attempt a silent refresh (§4). Default to 'ambiguous' on any
// post-send timeout — there is no read-back permission to verify after the fact (§2).
export const linkedinAdapter: PlatformAdapter = {
  platform: 'linkedin',

  needsRefresh(account) {
    if (!account.access_token_expires_at) return true;
    return new Date(account.access_token_expires_at).getTime() - Date.now() < 24 * 3_600_000;
  },

  async ensureFreshToken() {
    throw new Error('linkedin.ensureFreshToken not implemented yet — Phase 1 (likely flips to needs_reauth, no silent refresh)');
  },

  validate() {
    throw new Error('linkedin.validate not implemented yet — Phase 1');
  },

  async publish() {
    throw new Error('linkedin.publish not implemented yet — Phase 1');
  },

  async checkStatus() {
    throw new Error('linkedin.checkStatus not implemented yet — Phase 1');
  },

  classifyError(err) {
    return classifyByKnownCodes(err, {
      invalid_access_token: 'auth',
      REVOKED_ACCESS_TOKEN: 'auth',
      ACCESS_DENIED: 'permanent',
    });
  },
};
