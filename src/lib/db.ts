import type { Account, MediaAsset, Platform, PostTarget } from './types.js';

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Checkpoint an in-flight adapter_state mid-publish, so an upload that spans several cron runs can
 * pick up where it left off instead of starting over. Bumping updated_at is part of the point: it
 * keeps the stale-'publishing' sweep from yanking a target that is actively uploading.
 */
export async function saveAdapterState(
  db: D1Database,
  postTargetId: string,
  state: Record<string, unknown>
): Promise<void> {
  await db
    .prepare('update post_targets set adapter_state = ?, updated_at = ? where id = ?')
    .bind(JSON.stringify(state), nowIso(), postTargetId)
    .run();
}

interface AccountRow {
  id: string;
  platform: string;
  display_name: string;
  external_account_id: string | null;
  status: string;
  token_ciphertext: string | null;
  token_iv: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  scope: string | null;
  extra: string;
}

export function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    platform: row.platform as Platform,
    display_name: row.display_name,
    external_account_id: row.external_account_id,
    status: row.status as Account['status'],
    token_ciphertext: row.token_ciphertext,
    token_iv: row.token_iv,
    access_token_expires_at: row.access_token_expires_at,
    refresh_token_expires_at: row.refresh_token_expires_at,
    scope: row.scope,
    extra: JSON.parse(row.extra || '{}'),
  };
}

interface PostTargetRow {
  id: string;
  scheduled_post_id: string;
  account_id: string;
  platform: string;
  status: string;
  caption_override: string | null;
  options: string;
  adapter_state: string;
  external_post_id: string | null;
  external_url: string | null;
  attempt_count: number;
  last_error: string | null;
  processing_since: string | null;
  published_at: string | null;
  updated_at: string;
}

export function rowToPostTarget(row: PostTargetRow): PostTarget {
  return {
    id: row.id,
    scheduled_post_id: row.scheduled_post_id,
    account_id: row.account_id,
    platform: row.platform as Platform,
    status: row.status as PostTarget['status'],
    caption_override: row.caption_override,
    options: JSON.parse(row.options || '{}'),
    adapter_state: JSON.parse(row.adapter_state || '{}'),
    external_post_id: row.external_post_id,
    external_url: row.external_url,
    attempt_count: row.attempt_count,
    last_error: row.last_error,
    processing_since: row.processing_since,
    published_at: row.published_at,
    updated_at: row.updated_at,
  };
}

interface MediaAssetRow {
  id: string;
  storage_key: string;
  public_url: string | null;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
}

export function rowToMediaAsset(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    storage_key: row.storage_key,
    public_url: row.public_url,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    duration_seconds: row.duration_seconds,
    width: row.width,
    height: row.height,
  };
}
