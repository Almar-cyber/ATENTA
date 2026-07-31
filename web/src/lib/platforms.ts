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

// Tamanho recomendado por rede (dica de cliente, como os outros mapas PLATFORM_*). Serve pra
// avisar no preview qual resolução render melhor e se o arquivo atual vai ser cortado.
export interface MediaSpec {
  width: number;
  height: number;
  ratio: string;
}

export const PLATFORM_RECOMMENDED_MEDIA: Record<Platform, MediaSpec> = {
  instagram: { width: 1080, height: 1350, ratio: '4:5' },
  facebook: { width: 1200, height: 1200, ratio: '1:1' },
  linkedin: { width: 1200, height: 1200, ratio: '1:1' },
  pinterest: { width: 1000, height: 1500, ratio: '2:3' },
  youtube: { width: 1920, height: 1080, ratio: '16:9' },
  tiktok: { width: 1080, height: 1920, ratio: '9:16' },
};

export const INSTAGRAM_STORY_RECOMMENDED: MediaSpec = { width: 1080, height: 1920, ratio: '9:16' };

// Vídeo no feed do Instagram **é Reel** — não existe "vídeo de feed" separado na API de publicação
// (o adapter manda `media_type: 'REELS'`, ver src/adapters/instagram.ts). Por isso vídeo pro
// Instagram é previsto em 9:16, não no 4:5 das fotos.
export const INSTAGRAM_REELS_RECOMMENDED: MediaSpec = { width: 1080, height: 1920, ratio: '9:16' };

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'];

export interface VideoLimits {
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  maxSizeBytes?: number;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

// Client-side hints only — the adapter's validate() on the Worker is the authority (design.md
// principle #2). Sourced from each platform's official docs; confidence varies (Pinterest's file
// size isn't documented anywhere, so it's omitted rather than guessed; Meta's own docs disagree
// with themselves across endpoints, so facebook uses the more conservative figure).
export const PLATFORM_VIDEO_LIMITS: Partial<Record<Platform, VideoLimits>> = {
  instagram: { minDurationSeconds: 3, maxDurationSeconds: 900, maxSizeBytes: 300 * MB },
  facebook: { maxDurationSeconds: 1200, maxSizeBytes: 1 * GB },
  linkedin: { minDurationSeconds: 3, maxDurationSeconds: 1800, maxSizeBytes: 500 * MB },
  pinterest: { minDurationSeconds: 4, maxDurationSeconds: 300 },
  // Absolute ceiling only — the real per-creator duration limit is live data from TikTok's
  // creator_info endpoint, checked server-side in tiktok.ts (varies by account, not knowable here).
  tiktok: { maxDurationSeconds: 600, maxSizeBytes: 4 * GB },
  // Hard ceiling only; the 15min soft-warning (verified accounts can exceed it) is a separate
  // check below, not a validate()-enforced limit.
  youtube: { maxDurationSeconds: 43200, maxSizeBytes: 256 * GB },
};

// Instagram Stories have a much tighter window than a feed/Reels video — checked separately
// since the composer's "publicar como Story" toggle changes which limit applies.
export const INSTAGRAM_STORY_VIDEO_LIMITS: VideoLimits = { minDurationSeconds: 3, maxDurationSeconds: 60, maxSizeBytes: 100 * MB };

export const YOUTUBE_LONG_VIDEO_WARN_SECONDS = 900;

export const STATUS_META: Record<PostStatus, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200' },
  queued: { label: 'Na fila', className: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  publishing: { label: 'Publicando', className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300' },
  processing: { label: 'Processando', className: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300' },
  published: { label: 'Publicado', className: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300' },
  failed: { label: 'Falhou', className: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300' },
  canceled: { label: 'Cancelado', className: 'bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400' },
  ambiguous: { label: 'Indefinido', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300' },
};

export function isVideoMime(mime: string | undefined | null): boolean {
  return !!mime && mime.indexOf('video/') === 0;
}

// Faixa de proporção que a API de publicação da Meta aceita para foto de feed/carrossel. Espelha
// MIN/MAX_FEED_ASPECT_RATIO de `src/adapters/instagram.ts` — a autoridade continua sendo o
// `validate()` do adapter; aqui é só pra oferecer o recorte antes do upload.
//
// Cuidado com a confusão fácil: a grade do PERFIL corta tudo em 3:4, mas isso é só o recorte da
// capa. Quem recusa 2:3 é a API na hora de publicar, não a grade.
export const FEED_MIN_ASPECT_RATIO = 4 / 5;
export const FEED_MAX_ASPECT_RATIO = 1.91;

export function isFeedRatioOk(width?: number | null, height?: number | null): boolean {
  if (!width || !height) return true; // sem medida, deixa o servidor decidir
  const ratio = width / height;
  return ratio >= FEED_MIN_ASPECT_RATIO && ratio <= FEED_MAX_ASPECT_RATIO;
}

// ---------------------------------------------------------------------------
// Formato do post dentro da rede
//
// Uma mesma conta publica coisas diferentes, e a diferença é real na API: no Instagram o
// `media_type` do container muda (VIDEO / REELS / STORIES) e cada um tem regra e capa própria.
// Por isso o formato é ESCOLHIDO no compositor, não adivinhado a partir do arquivo.
//
// No YouTube não há escolha na API: ele classifica como Short sozinho (vertical, até 3min). A
// opção aqui só ajusta a pré-visualização e os avisos.
export interface PostFormat {
  id: string;
  label: string;
  hint: string;
  shape: PreviewShape;
  recommended: MediaSpec;
  /** Vídeo obrigatório, imagem proibida, ou tanto faz. */
  media: 'video' | 'image' | 'any';
  /** Aceita mais de um arquivo (carrossel). */
  multiple: boolean;
  /** Aceita imagem de capa própria. */
  coverImage: boolean;
}

export const PLATFORM_FORMATS: Partial<Record<Platform, PostFormat[]>> = {
  instagram: [
    {
      id: 'post',
      label: 'Post',
      hint: 'Feed. Foto, carrossel de até 10, ou vídeo — sem capa própria.',
      shape: 'square',
      recommended: { width: 1080, height: 1350, ratio: '4:5' },
      media: 'any',
      multiple: true,
      coverImage: false,
    },
    {
      id: 'reel',
      label: 'Reel',
      hint: 'Vertical, um vídeo só, entra na aba de Reels. Aceita capa.',
      shape: 'story',
      recommended: { width: 1080, height: 1920, ratio: '9:16' },
      media: 'video',
      multiple: false,
      coverImage: true,
    },
    {
      id: 'story',
      label: 'Story',
      hint: 'Some em 24h. Um arquivo, até 60s, e a legenda não aparece.',
      shape: 'story',
      recommended: { width: 1080, height: 1920, ratio: '9:16' },
      media: 'any',
      multiple: false,
      coverImage: false,
    },
  ],
  youtube: [
    {
      id: 'video',
      label: 'Vídeo',
      hint: 'Horizontal, sem limite de duração.',
      shape: 'wide',
      recommended: { width: 1920, height: 1080, ratio: '16:9' },
      media: 'video',
      multiple: false,
      coverImage: true,
    },
    {
      id: 'short',
      label: 'Short',
      hint: 'Vertical e até 3min. O YouTube classifica sozinho — aqui é só a previsão.',
      shape: 'story',
      recommended: { width: 1080, height: 1920, ratio: '9:16' },
      media: 'video',
      multiple: false,
      coverImage: true,
    },
  ],
};

export function findFormat(platform: Platform, id: string | undefined): PostFormat | undefined {
  return PLATFORM_FORMATS[platform]?.find((f) => f.id === id);
}
