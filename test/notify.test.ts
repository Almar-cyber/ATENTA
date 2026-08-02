import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notify } from '../src/lib/notify.js';

interface Capture {
  url: string;
  init: RequestInit | undefined;
}

/** Replaces global fetch and records what notify() tried to send. */
function captureFetch(respond: () => Response | Promise<Response> = () => new Response('ok')): Capture[] {
  const calls: Capture[] = [];
  vi.stubGlobal('fetch', (async (input: string, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond();
  }) as typeof fetch);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (env as Record<string, unknown>).ALERT_WEBHOOK_URL;
});

describe('notify', () => {
  it('does nothing when no webhook is configured', async () => {
    const calls = captureFetch();
    await notify(env, 'algo falhou');
    expect(calls).toHaveLength(0);
  });

  it('posts the raw message to an ntfy-style webhook', async () => {
    (env as Record<string, unknown>).ALERT_WEBHOOK_URL = 'https://ntfy.sh/meu-topico';
    const calls = captureFetch();

    await notify(env, 'post falhou');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://ntfy.sh/meu-topico');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toBe('post falhou');
  });

  it('wraps the message in JSON for a Discord webhook', async () => {
    (env as Record<string, unknown>).ALERT_WEBHOOK_URL = 'https://discord.com/api/webhooks/1/abc';
    const calls = captureFetch();

    await notify(env, 'post falhou');

    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ content: 'post falhou' });
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('swallows a webhook error rather than failing the poller run', async () => {
    // An alert is strictly less important than the publish work it reports on.
    (env as Record<string, unknown>).ALERT_WEBHOOK_URL = 'https://ntfy.sh/meu-topico';
    vi.stubGlobal('fetch', (async () => { throw new Error('DNS explodiu'); }) as typeof fetch);

    await expect(notify(env, 'post falhou')).resolves.toBeUndefined();
  });

  it('swallows a non-OK webhook response too', async () => {
    (env as Record<string, unknown>).ALERT_WEBHOOK_URL = 'https://ntfy.sh/meu-topico';
    captureFetch(() => new Response('nope', { status: 500 }));

    await expect(notify(env, 'post falhou')).resolves.toBeUndefined();
  });
});
