import type { PlatformAdapter } from '../lib/types.js';
import { classifyByKnownCodes } from '../lib/errors.js';

// Phase 3 — /media register -> poll -> /pins with media_id + cover_image_url, per architecture
// doc §3. No native scheduling: "scheduling" here IS the poller firing at scheduled_for, same as
// linkedin/instagram/tiktok. Needs Standard access (video-demo review) before this works for real.
export const pinterestAdapter: PlatformAdapter = {
  platform: 'pinterest',

  needsRefresh(account) {
    if (!account.access_token_expires_at) return true;
    return new Date(account.access_token_expires_at).getTime() - Date.now() < 60 * 60_000;
  },

  async ensureFreshToken() {
    throw new Error('pinterest.ensureFreshToken not implemented yet — Phase 3');
  },

  validate() {
    throw new Error('pinterest.validate not implemented yet — Phase 3');
  },

  async publish() {
    throw new Error('pinterest.publish not implemented yet — Phase 3');
  },

  async checkStatus() {
    throw new Error('pinterest.checkStatus not implemented yet — Phase 3');
  },

  classifyError(err) {
    return classifyByKnownCodes(err, {
      invalid_token: 'auth',
      rate_limit_exceeded: 'quota',
    });
  },
};
