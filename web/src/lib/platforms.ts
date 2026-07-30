import type { Platform, PostStatus } from './types';

export const PLATFORMS: Platform[] = ['youtube', 'linkedin', 'instagram', 'facebook', 'pinterest', 'tiktok'];

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  pinterest: 'Pinterest',
  tiktok: 'TikTok',
};

export const PLATFORM_COLORS: Record<Platform, string> = {
  youtube: '#FF0000',
  linkedin: '#0A66C2',
  instagram: '#E1306C',
  facebook: '#1877F2',
  pinterest: '#E60023',
  tiktok: '#111827',
};

export const PLATFORM_CAPTION_LIMITS: Partial<Record<Platform, number>> = {
  facebook: 5000,
  instagram: 2200,
  linkedin: 3000,
  pinterest: 500,
  tiktok: 2200,
  youtube: 5000,
};

// Max media items per post, mirroring each adapter's validate() on the Worker.
export const PLATFORM_MEDIA_MAX: Record<Platform, number> = {
  instagram: 10,
  facebook: 10,
  linkedin: 20,
  pinterest: 5,
  youtube: 1,
  tiktok: 1,
};

// Platforms that require media, and whether that media must be video.
export const PLATFORM_REQUIRES_MEDIA: Partial<Record<Platform, 'vídeo' | 'mídia'>> = {
  youtube: 'vídeo',
  tiktok: 'vídeo',
  instagram: 'mídia',
  pinterest: 'mídia',
};

// Only Instagram allows video mixed with images in a carousel; the rest are image-only.
export const PLATFORM_MULTI_IMAGE_ONLY: Partial<Record<Platform, boolean>> = {
  facebook: true,
  linkedin: true,
  pinterest: true,
};

export type PreviewShape = 'square' | 'story' | 'wide' | 'tall';
export const PLATFORM_PREVIEW_SHAPE: Record<Platform, PreviewShape> = {
  instagram: 'square',
  facebook: 'square',
  linkedin: 'square',
  pinterest: 'tall',
  youtube: 'wide',
  tiktok: 'story',
};

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'];

export const STATUS_META: Record<PostStatus, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200' },
  queued: { label: 'Na fila', className: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  publishing: { label: 'Publicando', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  processing: { label: 'Processando', className: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' },
  published: { label: 'Publicado', className: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300' },
  failed: { label: 'Falhou', className: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  canceled: { label: 'Cancelado', className: 'bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400' },
  ambiguous: { label: 'Indefinido', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300' },
};

export function isVideoMime(mime: string | undefined | null): boolean {
  return !!mime && mime.indexOf('video/') === 0;
}
