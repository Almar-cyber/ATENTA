// Local CLI to enqueue a scheduled post. Talks to D1 over Cloudflare's REST API (not the Worker
// binding, which only exists inside the deployed Worker) — keeps this a plain local script with
// no deployed admin route, per the "no custom admin UI" principle.

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set (see .env.example)`);
  return v;
}

interface D1QueryResponse<T> {
  success: boolean;
  errors: unknown[];
  result: Array<{ results: T[] }>;
}

async function d1Query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  const accountId = requireEnv('CF_ACCOUNT_ID');
  const databaseId = requireEnv('CF_D1_DATABASE_ID');
  const token = requireEnv('CF_API_TOKEN');

  const res = await fetch(`${CF_API_BASE}/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const json = (await res.json()) as D1QueryResponse<T>;
  if (!json.success) throw new Error(`D1 query failed: ${JSON.stringify(json.errors)}`);
  return json.result[0]?.results ?? [];
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { platform, account: accountName, scheduled_for: scheduledFor, caption, title } = args;

  if (!platform || !accountName || !scheduledFor) {
    console.error(
      'Usage: npm run enqueue -- --platform=youtube --account="<display_name>" --scheduled_for=2026-08-01T12:00:00Z --caption="..." [--title="..."]'
    );
    process.exit(1);
    return;
  }

  const accounts = await d1Query<{ id: string }>('select id from accounts where platform = ? and display_name = ?', [
    platform,
    accountName,
  ]);
  if (accounts.length === 0) {
    console.error(`Account not found: platform=${platform} display_name=${accountName}`);
    process.exit(1);
    return;
  }
  const accountId = accounts[0].id;

  const postId = crypto.randomUUID();
  await d1Query('insert into scheduled_posts (id, title, body, scheduled_for) values (?, ?, ?, ?)', [
    postId,
    title ?? null,
    caption ?? null,
    scheduledFor,
  ]);

  const targetId = crypto.randomUUID();
  await d1Query('insert into post_targets (id, scheduled_post_id, account_id, platform, status) values (?, ?, ?, ?, ?)', [
    targetId,
    postId,
    accountId,
    platform,
    'queued',
  ]);

  console.log(`Enqueued post ${postId} for ${platform}/${accountName} at ${scheduledFor}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
