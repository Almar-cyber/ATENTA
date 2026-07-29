import type { PlatformAdapter } from '../lib/types.js';
import { classifyByKnownCodes } from '../lib/errors.js';

// Phase 1 — resumable upload flow, publishAt rules, and the quota table live in the
// architecture doc §3/§5/§6. Loopback OAuth (not the Worker callback) per §4.
export const youtubeAdapter: PlatformAdapter = {
  platform: 'youtube',

  needsRefresh(account) {
    if (!account.access_token_expires_at) return true;
    return new Date(account.access_token_expires_at).getTime() - Date.now() < 5 * 60_000;
  },

  async ensureFreshToken() {
    throw new Error('youtube.ensureFreshToken not implemented yet — Phase 1');
  },

  validate() {
    throw new Error('youtube.validate not implemented yet — Phase 1');
  },

  async publish() {
    throw new Error('youtube.publish not implemented yet — Phase 1');
  },

  async checkStatus() {
    throw new Error('youtube.checkStatus not implemented yet — Phase 1');
  },

  classifyError(err) {
    return classifyByKnownCodes(err, {
      quotaExceeded: 'quota',
      invalid_grant: 'auth',
      invalidPublishAt: 'permanent',
    });
  },
};
