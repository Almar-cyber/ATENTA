import { d1Query } from './d1-client.js';

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
