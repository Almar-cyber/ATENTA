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
  const { platform, account: accountName, scheduled_for: scheduledFor, caption, title, options: optionsJson } = args;

  if (!platform || !accountName || !scheduledFor) {
    console.error(
      'Usage: npm run enqueue -- --platform=youtube --account="<display_name>" --scheduled_for=2026-08-01T12:00:00Z --caption="..." [--title="..."] [--options=\'{"as_story":true}\']\n' +
        '\nPer-platform options (post_targets.options, passed straight to the adapter):\n' +
        '  instagram: {"as_story": true}                — post as a Story instead of feed/Reel\n' +
        '  youtube:   {"categoryId": "22", "title": "..."}\n' +
        '  pinterest: {"board_id": "..."}                — overrides the account\'s default board\n' +
        '  tiktok:    {"privacy_level": "PUBLIC_TO_EVERYONE", "disable_duet": true, ...}'
    );
    process.exit(1);
    return;
  }

  let options: Record<string, unknown> = {};
  if (optionsJson) {
    try {
      options = JSON.parse(optionsJson);
    } catch {
      console.error(`--options is not valid JSON: ${optionsJson}`);
      process.exit(1);
      return;
    }
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
  await d1Query(
    'insert into post_targets (id, scheduled_post_id, account_id, platform, status, options) values (?, ?, ?, ?, ?, ?)',
    [targetId, postId, accountId, platform, 'queued', JSON.stringify(options)]
  );

  console.log(`Enqueued post ${postId} for ${platform}/${accountName} at ${scheduledFor}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
