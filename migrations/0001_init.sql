-- Core schema for the personal social media scheduler — Cloudflare D1 (SQLite) dialect.
-- IDs are generated in Worker code via crypto.randomUUID() and passed in explicitly (D1 has no
-- gen_random_uuid()). JSON columns are stored as TEXT and parsed/stringified at the app boundary
-- (see src/lib/db.ts) since D1/SQLite has no native jsonb type. Timestamps are ISO8601 TEXT (UTC),
-- sortable lexicographically, set explicitly by app code on writes.

-- accounts + credentials merged into one table: single-user tool, only consumer is our own
-- Worker — no security boundary or 1:many relationship to justify a join here.
create table accounts (
  id text primary key,
  platform text not null unique
    check (platform in ('youtube','linkedin','instagram','facebook','pinterest','tiktok')),
  display_name text not null,
  external_account_id text,                 -- channel id / person urn / ig business id / page id / open_id
  status text not null default 'active'
    check (status in ('active','needs_reauth','disabled')),

  -- token JSON ({access_token, refresh_token, ...}) is AES-GCM encrypted in the Worker
  -- (src/lib/crypto.ts) before being stored here — there's no Postgres-Vault equivalent in D1,
  -- so the Worker owns encrypt/decrypt directly using a key held only in a Wrangler secret.
  token_ciphertext text,
  token_iv text,
  access_token_expires_at text,
  refresh_token_expires_at text,
  scope text,
  extra text not null default '{}',         -- FB page id, Pinterest default board, IG business id, etc.

  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table media_assets (
  id text primary key,
  storage_key text not null,                -- R2 object key
  public_url text,                          -- served from a custom R2 domain, NOT the default r2.dev
  mime_type text not null,
  size_bytes integer not null,
  duration_seconds real,
  width integer,
  height integer,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table scheduled_posts (
  id text primary key,
  title text,
  body text,                                -- canonical caption; targets may override
  scheduled_for text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table post_targets (
  id text primary key,
  scheduled_post_id text not null references scheduled_posts(id) on delete cascade,
  account_id text not null references accounts(id),
  platform text not null
    check (platform in ('youtube','linkedin','instagram','facebook','pinterest','tiktok')),
  status text not null default 'queued'
    check (status in ('draft','queued','publishing','processing','published','failed','canceled','ambiguous')),
  -- 'ambiguous': timeout/connection-reset AFTER the publish request was sent — we genuinely don't
  -- know if the platform received it. No auto-retry; surfaces for manual check (see worker.ts).

  caption_override text,
  options text not null default '{}',       -- privacyStatus, categoryId, board_id, privacy_level, disable_duet, publishAt, ...
  adapter_state text not null default '{}', -- resumable upload URI + byte offset (YouTube), upload ETags
                                             -- (LinkedIn), signed FILE_UPLOAD url + chunk progress (TikTok),
                                             -- container id (Instagram) — survives across cron runs.

  external_post_id text,                    -- URN / video id / pin id / publish_id returned by the platform
  external_url text,
  attempt_count integer not null default 0,
  last_error text,
  published_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table post_target_media (
  post_target_id text not null references post_targets(id) on delete cascade,
  media_asset_id text not null references media_assets(id),
  position integer not null default 0,      -- ordering for carousels
  role text not null default 'primary',     -- primary | thumbnail | cover
  primary key (post_target_id, media_asset_id, role)
);

-- scheduled_for lives on scheduled_posts (one schedule shared by all of a post's targets), not
-- on post_targets — the due-posts query joins to it rather than duplicating the column.
create index idx_scheduled_posts_scheduled_for on scheduled_posts (scheduled_for);
create index idx_post_targets_status on post_targets (status);
create index idx_post_targets_status_updated on post_targets (status, updated_at);
