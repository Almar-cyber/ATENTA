import { env } from 'cloudflare:test';
import migration0001 from '../migrations/0001_init.sql?raw';
// Só 0001 + a coluna next_attempt_at: os testes do poller não dependem de 0002_accounts_multi (a
// troca do unique da tabela accounts) nem de 0003_grid_previews, e reaplicar o rebuild de accounts
// em cada resetDb só adicionaria fragilidade. next_attempt_at é 0004 aqui (era 0002 na branch).
import migration0004 from '../migrations/0004_next_attempt_at.sql?raw';
import { adapters } from '../src/adapters/index.js';
import type { Account, ErrorClass, MediaAsset, PlatformAdapter, Platform, PostTarget, PublishResult } from '../src/lib/types.js';

/**
 * Applies the real migration files, so a schema change that breaks the poller's SQL fails here
 * rather than in production. Statements are split on `;` because D1's prepare() takes one at a
 * time; the migrations contain no semicolons inside string literals, which would break this.
 */
export async function resetDb(): Promise<void> {
  for (const table of ['post_target_media', 'post_targets', 'scheduled_posts', 'media_assets', 'accounts']) {
    await env.DB.prepare(`drop table if exists ${table}`).run();
  }
  for (const index of ['idx_scheduled_posts_scheduled_for', 'idx_post_targets_status', 'idx_post_targets_status_updated', 'idx_post_targets_status_next_attempt']) {
    await env.DB.prepare(`drop index if exists ${index}`).run();
  }
  for (const sql of splitStatements(`${migration0001}\n${migration0004}`)) {
    await env.DB.prepare(sql).run();
  }
}

/**
 * Comments are stripped before splitting, not after: the migrations contain trailing comments with
 * semicolons in the prose ("-- canonical caption; targets may override"), and splitting first cuts
 * those statements in half. Assumes no `--` and no `;` inside a string literal, which holds for
 * these two files.
 */
function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function insertAccount(overrides: Partial<{ id: string; platform: Platform; display_name: string; external_account_id: string; status: string; extra: string }> = {}): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();
  await env.DB.prepare(
    `insert into accounts (id, platform, display_name, external_account_id, status, extra) values (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      overrides.platform ?? 'facebook',
      overrides.display_name ?? 'Conta de Teste',
      overrides.external_account_id ?? 'ext-1',
      overrides.status ?? 'active',
      overrides.extra ?? '{}'
    )
    .run();
  return id;
}

export interface InsertPostOptions {
  accountId: string;
  platform?: Platform;
  body?: string | null;
  title?: string | null;
  captionOverride?: string | null;
  scheduledFor?: string;
  status?: string;
  attemptCount?: number;
  nextAttemptAt?: string | null;
  options?: Record<string, unknown>;
  adapterState?: Record<string, unknown>;
  updatedAt?: string;
}

/** Creates a scheduled_posts + post_targets pair and returns the target id. */
export async function insertPost(opts: InsertPostOptions): Promise<string> {
  const postId = crypto.randomUUID();
  const targetId = crypto.randomUUID();

  await env.DB.prepare(`insert into scheduled_posts (id, title, body, scheduled_for) values (?, ?, ?, ?)`)
    .bind(postId, opts.title ?? null, opts.body ?? null, opts.scheduledFor ?? '2020-01-01T00:00:00Z')
    .run();

  await env.DB.prepare(
    `insert into post_targets (id, scheduled_post_id, account_id, platform, status, caption_override, options, adapter_state, attempt_count, next_attempt_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      targetId,
      postId,
      opts.accountId,
      opts.platform ?? 'facebook',
      opts.status ?? 'queued',
      opts.captionOverride ?? null,
      JSON.stringify(opts.options ?? {}),
      JSON.stringify(opts.adapterState ?? {}),
      opts.attemptCount ?? 0,
      opts.nextAttemptAt ?? null,
      opts.updatedAt ?? new Date().toISOString()
    )
    .run();

  return targetId;
}

export interface TargetRow {
  status: string;
  attempt_count: number;
  next_attempt_at: string | null;
  last_error: string | null;
  external_post_id: string | null;
  external_url: string | null;
  published_at: string | null;
  adapter_state: string;
}

export async function getTarget(id: string): Promise<TargetRow> {
  const row = await env.DB.prepare(`select * from post_targets where id = ?`).bind(id).first<TargetRow>();
  if (!row) throw new Error(`target ${id} not found`);
  return row;
}

export async function getAccountStatus(id: string): Promise<string> {
  const row = await env.DB.prepare(`select status from accounts where id = ?`).bind(id).first<{ status: string }>();
  if (!row) throw new Error(`account ${id} not found`);
  return row.status;
}

export interface FakeAdapterSpy {
  validateCalls: Array<{ target: PostTarget; media: MediaAsset[]; account: Account }>;
  publishCalls: Array<{ target: PostTarget; media: MediaAsset[]; account: Account }>;
  checkStatusCalls: PostTarget[];
}

export interface FakeAdapterOptions {
  onValidate?: (target: PostTarget, media: MediaAsset[], account: Account) => void;
  onPublish?: (target: PostTarget) => PublishResult | Promise<PublishResult>;
  onCheckStatus?: (target: PostTarget) => PublishResult | Promise<PublishResult>;
  classify?: ErrorClass;
  needsRefresh?: boolean;
  onEnsureFreshToken?: () => void;
}

/**
 * Swaps a real adapter out of the registry for the duration of a test. The poller looks adapters
 * up by platform at call time, so mutating the registry object is enough — no DI needed.
 * Returns a spy plus a restore function.
 */
export function installFakeAdapter(
  platform: Platform,
  opts: FakeAdapterOptions = {}
): { spy: FakeAdapterSpy; restore: () => void } {
  const original = adapters[platform];
  const spy: FakeAdapterSpy = { validateCalls: [], publishCalls: [], checkStatusCalls: [] };

  const fake: PlatformAdapter = {
    platform,
    needsRefresh: () => opts.needsRefresh ?? false,
    async ensureFreshToken(account) {
      opts.onEnsureFreshToken?.();
      return account;
    },
    validate(target, media, account) {
      spy.validateCalls.push({ target, media, account });
      opts.onValidate?.(target, media, account);
    },
    async publish(target, media, account) {
      spy.publishCalls.push({ target, media, account });
      if (opts.onPublish) return opts.onPublish(target);
      return { state: 'published', externalId: 'fake-id', externalUrl: 'https://example.test/fake-id' };
    },
    async checkStatus(target) {
      spy.checkStatusCalls.push(target);
      if (opts.onCheckStatus) return opts.onCheckStatus(target);
      return { state: 'published', externalId: 'fake-id' };
    },
    classifyError: () => opts.classify ?? 'retryable',
  };

  adapters[platform] = fake;
  return { spy, restore: () => { adapters[platform] = original; } };
}
