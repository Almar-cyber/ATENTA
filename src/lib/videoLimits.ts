import type { MediaAsset } from './types.js';

// Only checks when duration is known — media uploaded before client-side metadata capture
// shipped (or a post duplicated from one) has a null duration_seconds and stays publishable,
// no regression. min/max are both optional since not every platform documents a floor.
export function checkDuration(prefix: string, asset: MediaAsset, min: number | undefined, max: number | undefined): void {
  if (asset.duration_seconds == null) return;
  if (min != null && asset.duration_seconds < min) {
    throw new Error(`${prefix}: vídeo muito curto (${asset.duration_seconds.toFixed(0)}s, mínimo ${min}s)`);
  }
  if (max != null && asset.duration_seconds > max) {
    throw new Error(`${prefix}: vídeo muito longo (${asset.duration_seconds.toFixed(0)}s, máximo ${max}s)`);
  }
}
