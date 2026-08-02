import type { Env } from './env.js';

/**
 * Push a one-line alert to ALERT_WEBHOOK_URL, if one is configured.
 *
 * Cron Triggers have no equivalent of the "workflow failed" email GitHub Actions would have sent,
 * so without this a post that fails at 3am is invisible until you happen to run `npm run queue`.
 *
 * Never throws and never blocks the poller: an alert is strictly less important than the publish
 * work it reports on, so a dead webhook must not turn one failed target into a failed run.
 */
export async function notify(env: Env, message: string): Promise<void> {
  const url = env.ALERT_WEBHOOK_URL;
  if (!url) return; // alerting is opt-in — no secret set means log-only, same as before

  try {
    // Discord expects JSON with a `content` field; ntfy.sh (and most simple webhook receivers)
    // take the raw body as the notification text. Sniffing the host covers both without asking
    // you to configure which flavour you picked.
    const isDiscord = url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks');
    const init: RequestInit = isDiscord
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: message }) }
      : { method: 'POST', body: message };

    // Deliberately not fetchWithRetry: retries would multiply the delay in front of the remaining
    // targets in this batch, and a missed alert is recoverable (the row is still in the DB).
    const res = await fetch(url, init);
    if (!res.ok) console.error(`[notify] webhook returned ${res.status}`);
  } catch (err) {
    console.error('[notify] webhook failed:', err);
  }
}
