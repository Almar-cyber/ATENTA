export type Platform = 'youtube' | 'linkedin' | 'instagram' | 'facebook' | 'pinterest' | 'tiktok';

export type PostStatus =
  | 'draft'
  | 'queued'
  | 'publishing'
  | 'processing'
  | 'published'
  | 'failed'
  | 'canceled'
  | 'ambiguous';

export interface Account {
  /** A conta consegue trazer métrica? false = foi conectada sem os escopos de insights. */
  metrics_ready?: boolean;
  /** Quais permissões faltam, pra mensagem poder nomeá-las. */
  missing_scopes?: string[];
  id: string;
  platform: Platform;
  display_name: string;
  status: 'active' | 'needs_reauth' | 'disabled';
  extra: Record<string, unknown>;
}

export interface Media {
  id: string;
  public_url: string | null;
  mime_type: string;
  storage_key: string;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface Target {
  id: string;
  platform: Platform;
  account_id: string;
  account_name: string;
  status: PostStatus;
  caption_override: string | null;
  options: Record<string, unknown>;
  external_url: string | null;
  external_post_id: string | null;
  attempt_count: number;
  last_error: string | null;
  published_at: string | null;
  updated_at: string;
  media: Media[];
}

export interface Post {
  id: string;
  title: string | null;
  body: string | null;
  scheduled_for: string;
  created_at: string;
  targets: Target[];
}

// Uma imagem colocada na grade sem virar post: serve só pra ver como o feed vai ficar. Ocupa uma
// posição no mesmo eixo de tempo dos posts (`sort_at`), mas não é publicada por ninguém.
export interface GridPreview {
  id: string;
  platform: Platform;
  media_asset_id: string;
  sort_at: string;
  public_url: string | null;
  mime_type: string;
  width: number | null;
  height: number | null;
}

// A media item queued in the composer: either a File not yet uploaded, or an already-uploaded
// asset (reused when duplicating a post) identified by assetId.
export interface QueuedMedia {
  key: string;
  file?: File;
  assetId?: string;
  name: string;
  mime_type: string;
  public_url?: string | null;
  duration_seconds?: number;
  width?: number;
  height?: number;
}
