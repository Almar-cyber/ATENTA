import type { PlatformAdapter } from '../lib/types.js';
import { classifyByKnownCodes } from '../lib/errors.js';

// Phase 4 — creator_info/query (mandatory pre-call) -> FILE_UPLOAD chunks -> publish/status/fetch,
// polled ~15s to stay under the 6 req/min cap, per architecture doc §3/§6. Forced SELF_ONLY until
// the Content Posting API scope audit clears — submit that application as early as possible
// (longest lead time of all six platforms). The enqueue CLI must prompt for privacy_level with no
// hardcoded default when targeting TikTok (the audit's demo video needs to show this).
export const tiktokAdapter: PlatformAdapter = {
  platform: 'tiktok',

  needsRefresh(account) {
    if (!account.access_token_expires_at) return true;
    return new Date(account.access_token_expires_at).getTime() - Date.now() < 60 * 60_000;
  },

  async ensureFreshToken() {
    throw new Error('tiktok.ensureFreshToken not implemented yet — Phase 4');
  },

  validate() {
    throw new Error('tiktok.validate not implemented yet — Phase 4');
  },

  async publish() {
    throw new Error('tiktok.publish not implemented yet — Phase 4');
  },

  async checkStatus() {
    throw new Error('tiktok.checkStatus not implemented yet — Phase 4');
  },

  classifyError(err) {
    return classifyByKnownCodes(err, {
      access_token_invalid: 'auth',
      spam_risk_too_many_posts: 'quota',
      url_ownership_unverified: 'permanent',
      privacy_level_option_mismatch: 'permanent',
    });
  },
};
