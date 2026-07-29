import type { Env } from './env.js';

export type Platform = 'youtube' | 'linkedin' | 'instagram' | 'facebook' | 'pinterest' | 'tiktok';

export type ErrorClass = 'retryable' | 'auth' | 'quota' | 'permanent' | 'ambiguous';

export type AccountStatus = 'active' | 'needs_reauth' | 'disabled';

export type PostTargetStatus =
  | 'draft'
  | 'queued'
  | 'publishing'
  | 'processing'
  | 'published'
  | 'failed'
  | 'canceled'
  | 'ambiguous';

export interface Account {
  id: string;
  platform: Platform;
  display_name: string;
  external_account_id: string | null;
  status: AccountStatus;
  token_ciphertext: string | null;
  token_iv: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  scope: string | null;
  extra: Record<string, unknown>;
}

export interface MediaAsset {
  id: string;
  storage_key: string;
  public_url: string | null;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
}

export interface PostTarget {
  id: string;
  scheduled_post_id: string;
  account_id: string;
  platform: Platform;
  status: PostTargetStatus;
  caption_override: string | null;
  options: Record<string, unknown>;
  adapter_state: Record<string, unknown>;
  external_post_id: string | null;
  external_url: string | null;
  attempt_count: number;
  last_error: string | null;
  published_at: string | null;
  updated_at: string;
}

export type PublishResult =
  | { state: 'published'; externalId: string; externalUrl?: string }
  | { state: 'processing'; adapterState?: Record<string, unknown> }
  | { state: 'failed'; class: ErrorClass; code: string; message: string };

export interface PlatformAdapter {
  platform: Platform;
  /** Plain timestamp check — no network call. */
  needsRefresh(account: Account): boolean;
  ensureFreshToken(account: Account, env: Env): Promise<Account>;
  /** Throws before spending an API call. */
  validate(target: PostTarget, media: MediaAsset[]): void;
  publish(target: PostTarget, media: MediaAsset[], account: Account, env: Env): Promise<PublishResult>;
  /** For async platforms; reads/writes adapter_state. */
  checkStatus(target: PostTarget, account: Account, env: Env): Promise<PublishResult>;
  classifyError(err: unknown): ErrorClass;
}
