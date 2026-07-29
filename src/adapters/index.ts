import type { Platform, PlatformAdapter } from '../lib/types.js';
import { youtubeAdapter } from './youtube.js';
import { linkedinAdapter } from './linkedin.js';
import { instagramAdapter } from './instagram.js';
import { facebookAdapter } from './facebook.js';
import { pinterestAdapter } from './pinterest.js';
import { tiktokAdapter } from './tiktok.js';

export const adapters: Record<Platform, PlatformAdapter> = {
  youtube: youtubeAdapter,
  linkedin: linkedinAdapter,
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  pinterest: pinterestAdapter,
  tiktok: tiktokAdapter,
};
