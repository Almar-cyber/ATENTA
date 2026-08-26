import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import {
  getAccountStatus,
  getTarget,
  insertAccount,
  insertPost,
  installFakeAdapter,
  resetDb,
} from './helpers.js';

/** Drives the real cron entrypoint, so the tests exercise the same path the Cron Trigger does. */
async function runPoller(): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled({} as ScheduledEvent, env, ctx);
  await waitOnExecutionContext(ctx);
}

const restores: Array<() => void> = [];

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  while (restores.length) restores.pop()!();
});

function fake(...args: Parameters<typeof installFakeAdapter>) {
  const { spy, restore } = installFakeAdapter(...args);
  restores.push(restore);
  return spy;
}

describe('caption resolution', () => {
  it('passes scheduled_posts.body to the adapter as the caption', async () => {
    // Regression: enqueue.ts writes --caption to scheduled_posts.body while adapters read
    // post_targets.caption_override, so every post used to publish with empty text.
    const spy = fake('facebook');
    const accountId = await insertAccount({ platform: 'facebook' });
    await insertPost({ accountId, body: 'Minha legenda de teste' });

    await runPoller();

    expect(spy.publishCalls).toHaveLength(1);
    expect(spy.publishCalls[0].target.caption_override).toBe('Minha legenda de teste');
  });

  it('lets a target-level caption_override win over the post body', async () => {
    const spy = fake('facebook');
    const accountId = await insertAccount({ platform: 'facebook' });
    await insertPost({ accountId, body: 'legenda do post', captionOverride: 'legenda do target' });

    await runPoller();

    expect(spy.publishCalls[0].target.caption_override).toBe('legenda do target');
  });

  it('passes scheduled_posts.title through as the target title', async () => {
    const spy = fake('youtube');
    const accountId = await insertAccount({ platform: 'youtube' });
    await insertPost({ accountId, platform: 'youtube', body: 'descrição', title: 'Meu Título' });

    await runPoller();

    expect(spy.publishCalls[0].target.title).toBe('Meu Título');
  });

  it('leaves the caption null when neither body nor override is set', async () => {
    // An empty caption is legitimate on Instagram, TikTok and Pinterest — resolution must not
    // invent one, and must not reject the post.
    const spy = fake('instagram');
    const accountId = await insertAccount({ platform: 'instagram' });
    await insertPost({ accountId, platform: 'instagram' });

    await runPoller();

    expect(spy.publishCalls).toHaveLength(1);
    expect(spy.publishCalls[0].target.caption_override).toBeNull();
  });
});

describe('publish outcomes', () => {
  it('records external id and url on success', async () => {
    fake('facebook', {
      onPublish: () => ({ state: 'published', externalId: 'post-123', externalUrl: 'https://fb.test/post-123' }),
    });
    const accountId = await insertAccount({ platform: 'facebook' });
    const targetId = await insertPost({ accountId, body: 'oi' });

    await runPoller();

    const row = await getTarget(targetId);
    expect(row.status).toBe('published');
    expect(row.external_post_id).toBe('post-123');
    expect(row.external_url).toBe('https://fb.test/post-123');
    expect(row.published_at).not.toBeNull();
  });

  it('stores adapter_state when the platform reports processing', async () => {
    // checkStatus must stay 'processing' too: the recheck step runs later in the same poller pass,
    // so a fake that reports 'published' there would publish the target before we can assert.
    fake('instagram', {
      onPublish: () => ({ state: 'processing', adapterState: { creation_id: 'c1' } }),
      onCheckStatus: () => ({ state: 'processing', adapterState: { creation_id: 'c1' } }),
    });
    const accountId = await insertAccount({ platform: 'instagram' });
    const targetId = await insertPost({ accountId, platform: 'instagram', body: 'oi' });

    await runPoller();

    const row = await getTarget(targetId);
    expect(row.status).toBe('processing');
    expect(JSON.parse(row.adapter_state)).toEqual({ creation_id: 'c1' });
  });

  // O erro pertence à tentativa que falhou. Quem publica na retentativa seguinte não tem erro —
  // e sem limpar, o post saía de verdade e seguia exibindo faixa vermelha pra sempre. Aconteceu
  // com um vídeo de 126 MB no YouTube: publicou e continuou mostrando "Network connection lost".
  it('limpa o erro anterior ao publicar na retentativa', async () => {
    let tentativa = 0;
    fake('facebook', {
      onPublish: () => {
        tentativa++;
        if (tentativa === 1) throw new Error('Network connection lost.');
        return { state: 'published', externalId: 'post-9', externalUrl: 'https://fb.test/post-9' };
      },
    });
    const accountId = await insertAccount({ platform: 'facebook' });
    const targetId = await insertPost({ accountId, body: 'oi' });

    await runPoller();
    const aposFalha = await getTarget(targetId);
    expect(aposFalha.last_error).toContain('Network connection lost');

    // O backoff empurra a próxima tentativa pra frente; antecipa pra ela caber nesta varredura.
    await env.DB.prepare(`update post_targets set next_attempt_at = null where id = ?`).bind(targetId).run();
    await runPoller();

    const publicado = await getTarget(targetId);
    expect(publicado.status).toBe('published');
    expect(publicado.last_error).toBeNull();
  });

  it('limpa o erro anterior ao entrar em processing', async () => {
    let tentativa = 0;
    fake('instagram', {
      onPublish: () => {
        tentativa++;
        if (tentativa === 1) throw new Error('Network connection lost.');
        return { state: 'processing', adapterState: { creation_id: 'c1' } };
      },
      onCheckStatus: () => ({ state: 'processing', adapterState: { creation_id: 'c1' } }),
    });
    const accountId = await insertAccount({ platform: 'instagram' });
    const targetId = await insertPost({ accountId, platform: 'instagram', body: 'oi' });

    await runPoller();
    expect((await getTarget(targetId)).last_error).toContain('Network connection lost');

    await env.DB.prepare(`update post_targets set next_attempt_at = null where id = ?`).bind(targetId).run();
    await runPoller();

    const row = await getTarget(targetId);
    expect(row.status).toBe('processing');
    expect(row.last_error).toBeNull();
  });
});

describe('retry backoff', () => {
  it('increments attempt_count and sets next_attempt_at on a retryable failure', async () => {
    // Regression: this UPDATE used to target post_targets.scheduled_for, a column that has never
    // existed, so it threw inside the failure handler and the retry path never ran.
    fake('facebook', {
      onPublish: () => { throw new Error('boom'); },
      classify: 'retryable',
    });
    const accountId = await insertAccount({ platform: 'facebook' });
    const targetId = await insertPost({ accountId, body: 'oi' });

    await runPoller();

    const row = await getTarget(targetId);
    expect(row.status).toBe('queued');
    expect(row.attempt_count).toBe(1);
    expect(row.last_error).toContain('boom');
    expect(row.next_attempt_at).not.toBeNull();
    const delayMs = new Date(row.next_attempt_at!).getTime() - Date.now();
    expect(delayMs).toBeGreaterThan(10 * 60_000);
    expect(delayMs).toBeLessThan(20 * 60_000);
  });

  it('backs off a full day on a quota failure', async () => {
    fake('facebook', { onPublish: () => { throw new Error('slow down'); }, classify: 'quota' });
    const accountId = await insertAccount({ platform: 'facebook' });
    const targetId = await insertPost({ accountId, body: 'oi' });

    await runPoller();

    const row = await getTarget(targetId);
    const delayHours = (new Date(row.next_attempt_at!).getTime() - Date.now()) / 3_600_000;
    expect(delayHours).toBeGreaterThan(23);
    expect(delayHours).toBeLessThan(25);
  });

  it('does not pick up a target whose next_attempt_at is still in the future', async () => {
    const spy = fake('facebook');
    const accountId = await insertAccount({ platform: 'facebook' });
    await insertPost({
      accountId,
      body: 'oi',
      nextAttemptAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });

    await runPoller();

    expect(spy.publishCalls).toHaveLength(0);
  });

  it('picks the target back up once next_attempt_at has passed', async () => {
    const spy = fake('facebook');
    const accountId = await insertAccount({ platform: 'facebook' });
    await insertPost({
      accountId,
      body: 'oi',
      nextAttemptAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await runPoller();

    expect(spy.publishCalls).toHaveLength(1);
  });

  it('gives up and fails the target on the fifth attempt', async () => {
    fake('facebook', { onPublish: () => { throw new Error('still broken'); }, classify: 'retryable' });
    const accountId = await insertAccount({ platform: 'facebook' });
    const targetId = await insertPost({ accountId, body: 'oi', attemptCount: 4 });

    await runPoller();

    const row = await getTarget(targetId);
    expect(row.status).toBe('failed');
    expect(row.attempt_count).toBe(5);
  });

  it('never delays the schedule shared by the post siblings', async () => {
    // next_attempt_at lives on the target precisely so a retry can't move scheduled_posts.
    fake('facebook', { onPublish: () => { throw new Error('boom'); }, classify: 'retryable' });
    const accountId = await insertAccount({ platform: 'facebook' });
    await insertPost({ accountId, body: 'oi', scheduledFor: '2020-01-01T00:00:00Z' });

    await runPoller();

    const post = await env.DB.prepare(`select scheduled_for from scheduled_posts`).first<{ scheduled_for: string }>();
    expect(post?.scheduled_for).toBe('2020-01-01T00:00:00Z');
  });
});

describe('failure classification', () => {
  it('flips the account to needs_reauth on an auth failure and requeues immediately', async () => {
    fake('facebook', { onPublish: () => { throw new Error('token dead'); }, classify: 'auth' });
    const accountId = await insertAccount({ platform: 'facebook' });
    const targetId = await insertPost({ accountId, body: 'oi' });

    await runPoller();

    expect(await getAccountStatus(accountId)).toBe('needs_reauth');
    const row = await getTarget(targetId);
    expect(row.status).toBe('queued');
    expect(row.next_attempt_at).toBeNull();
    // An auth failure isn't the target's fault, so it must not consume an attempt.
    expect(row.attempt_count).toBe(0);
  });

  it('parks an ambiguous failure without retrying it', async () => {
    fake('linkedin', { onPublish: () => { throw new TypeError('connection reset'); }, classify: 'ambiguous' });
    const accountId = await insertAccount({ platform: 'linkedin' });
    const targetId = await insertPost({ accountId, platform: 'linkedin', body: 'oi' });

    await runPoller();

    const row = await getTarget(targetId);
    expect(row.status).toBe('ambiguous');
    expect(row.attempt_count).toBe(0);
  });

  it('fails a permanent error immediately', async () => {
    fake('facebook', { onPublish: () => { throw new Error('nope'); }, classify: 'permanent' });
    const accountId = await insertAccount({ platform: 'facebook' });
    const targetId = await insertPost({ accountId, body: 'oi' });

    await runPoller();

    const row = await getTarget(targetId);
    expect(row.status).toBe('failed');
    expect(row.attempt_count).toBe(0);
  });

  it('treats a validate() rejection as permanent, without burning attempts', async () => {
    const spy = fake('facebook', {
      onValidate: () => { throw new Error('media needs a public_url'); },
    });
    const accountId = await insertAccount({ platform: 'facebook' });
    const targetId = await insertPost({ accountId, body: 'oi' });

    await runPoller();

    const row = await getTarget(targetId);
    expect(row.status).toBe('failed');
    expect(row.attempt_count).toBe(0);
    expect(row.last_error).toContain('public_url');
    expect(spy.publishCalls).toHaveLength(0);
  });

  it('gives validate() the account, so account-level fallbacks are visible', async () => {
    // Regression: Pinterest's validate() rejected every post using the default board because it
    // could only see target.options, not accounts.extra.default_board_id.
    const spy = fake('pinterest');
    const accountId = await insertAccount({ platform: 'pinterest', extra: JSON.stringify({ default_board_id: 'b1' }) });
    await insertPost({ accountId, platform: 'pinterest', body: 'oi' });

    await runPoller();

    expect(spy.validateCalls).toHaveLength(1);
    expect(spy.validateCalls[0].account.extra).toEqual({ default_board_id: 'b1' });
  });
});

describe('poller resilience', () => {
  it('keeps working through the batch after one target blows up', async () => {
    // Regression for the throw that used to sit outside the try/catch: one bad target aborted
    // runPoller and stranded every already-claimed target in 'publishing'. (The specific trigger
    // back then was a dangling account_id, which D1 makes unreachable — it enforces the foreign
    // key and won't let the account be deleted — so this drives the same loop with a throwing
    // publish instead.)
    let calls = 0;
    fake('facebook', {
      onPublish: () => {
        calls += 1;
        if (calls === 1) throw new Error('primeiro alvo explodiu');
        return { state: 'published', externalId: 'ok-2' };
      },
      classify: 'permanent',
    });
    const accountId = await insertAccount({ platform: 'facebook' });
    const first = await insertPost({ accountId, body: 'um', scheduledFor: '2019-01-01T00:00:00Z' });
    const second = await insertPost({ accountId, body: 'dois', scheduledFor: '2020-01-01T00:00:00Z' });

    await runPoller();

    expect(calls).toBe(2);
    expect((await getTarget(first)).status).toBe('failed');
    expect((await getTarget(second)).status).toBe('published');
  });

  it('skips targets whose account is not active', async () => {
    const spy = fake('facebook');
    const accountId = await insertAccount({ platform: 'facebook', status: 'needs_reauth' });
    await insertPost({ accountId, body: 'oi' });

    await runPoller();

    expect(spy.publishCalls).toHaveLength(0);
  });

  it('ignores posts that are not due yet', async () => {
    const spy = fake('facebook');
    const accountId = await insertAccount({ platform: 'facebook' });
    await insertPost({ accountId, body: 'oi', scheduledFor: '2099-01-01T00:00:00Z' });

    await runPoller();

    expect(spy.publishCalls).toHaveLength(0);
  });

  it('does not re-claim a target already being published', async () => {
    const spy = fake('facebook');
    const accountId = await insertAccount({ platform: 'facebook' });
    await insertPost({ accountId, body: 'oi', status: 'publishing' });

    await runPoller();

    expect(spy.publishCalls).toHaveLength(0);
  });
});

describe('processing recheck', () => {
  it('publishes a processing target once the platform finishes', async () => {
    const spy = fake('instagram', { onCheckStatus: () => ({ state: 'published', externalId: 'ig-1' }) });
    const accountId = await insertAccount({ platform: 'instagram' });
    const targetId = await insertPost({
      accountId,
      platform: 'instagram',
      status: 'processing',
      body: 'oi',
      adapterState: { creation_id: 'c1' },
    });

    await runPoller();

    expect(spy.checkStatusCalls).toHaveLength(1);
    expect((await getTarget(targetId)).status).toBe('published');
  });

  it('resolves the caption for the recheck path too', async () => {
    // pinterest.checkStatus() builds the video Pin from the caption, so the recheck query needs
    // the same scheduled_posts join as the publish query.
    const spy = fake('pinterest', { onCheckStatus: () => ({ state: 'processing' }) });
    const accountId = await insertAccount({ platform: 'pinterest' });
    await insertPost({ accountId, platform: 'pinterest', status: 'processing', body: 'descrição do pin' });

    await runPoller();

    expect(spy.checkStatusCalls[0].caption_override).toBe('descrição do pin');
  });
});

describe('sweeps', () => {
  it('requeues a target stuck in publishing past the stale window', async () => {
    fake('facebook');
    const accountId = await insertAccount({ platform: 'facebook' });
    const targetId = await insertPost({
      accountId,
      body: 'oi',
      status: 'publishing',
      updatedAt: new Date(Date.now() - 45 * 60_000).toISOString(),
    });

    await runPoller();

    expect((await getTarget(targetId)).status).toBe('queued');
  });

  it('fails a target that never came back from processing', async () => {
    fake('instagram', { onCheckStatus: () => ({ state: 'processing' }) });
    const accountId = await insertAccount({ platform: 'instagram' });
    const targetId = await insertPost({
      accountId,
      platform: 'instagram',
      body: 'oi',
      status: 'processing',
      updatedAt: new Date(Date.now() - 7 * 3_600_000).toISOString(),
    });

    await runPoller();

    const row = await getTarget(targetId);
    expect(row.status).toBe('failed');
    expect(row.last_error).toContain('timed out');
  });
});

describe('token health scan', () => {
  it('marks an account needs_reauth when the refresh throws', async () => {
    fake('linkedin', {
      needsRefresh: true,
      onEnsureFreshToken: () => { throw new Error('no refresh possible'); },
    });
    const accountId = await insertAccount({ platform: 'linkedin' });

    await runPoller();

    expect(await getAccountStatus(accountId)).toBe('needs_reauth');
  });

  it('leaves a healthy account alone', async () => {
    fake('linkedin', { needsRefresh: false });
    const accountId = await insertAccount({ platform: 'linkedin' });

    await runPoller();

    expect(await getAccountStatus(accountId)).toBe('active');
  });
});

describe('failure alerting', () => {
  it('pushes an alert when a target fails for good', async () => {
    fake('facebook', { onPublish: () => { throw new Error('nope'); }, classify: 'permanent' });
    const accountId = await insertAccount({ platform: 'facebook' });
    await insertPost({ accountId, body: 'oi' });

    const sent: string[] = [];
    (env as Record<string, unknown>).ALERT_WEBHOOK_URL = 'https://ntfy.sh/teste';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent.push(String(init?.body));
      return new Response('ok');
    }) as typeof fetch;

    try {
      await runPoller();
    } finally {
      globalThis.fetch = originalFetch;
      delete (env as Record<string, unknown>).ALERT_WEBHOOK_URL;
    }

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('facebook');
    expect(sent[0]).toContain('nope');
  });

  it('stays silent on a retryable failure that still has attempts left', async () => {
    // A single transient 503 that succeeds next run is noise, not news.
    fake('facebook', { onPublish: () => { throw new Error('503'); }, classify: 'retryable' });
    const accountId = await insertAccount({ platform: 'facebook' });
    await insertPost({ accountId, body: 'oi' });

    const sent: string[] = [];
    (env as Record<string, unknown>).ALERT_WEBHOOK_URL = 'https://ntfy.sh/teste';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent.push(String(init?.body));
      return new Response('ok');
    }) as typeof fetch;

    try {
      await runPoller();
    } finally {
      globalThis.fetch = originalFetch;
      delete (env as Record<string, unknown>).ALERT_WEBHOOK_URL;
    }

    expect(sent).toHaveLength(0);
  });
});

describe('end-to-end auth classification', () => {
  it('drives a real ApiError from the facebook adapter through to needs_reauth', async () => {
    // No fake adapter: this exercises the genuine apiError -> ApiError.code -> classifyError ->
    // handleFailure('auth') chain, the one that used to be dead code because adapters threw plain
    // Errors carrying no code at all.
    const accountId = await insertAccount({ platform: 'facebook' });
    const targetId = await insertPost({ accountId, body: 'oi' });

    // getAccountTokens() short-circuits on a null ciphertext, so give it a real encrypted payload.
    const { encryptJSON } = await import('../src/lib/crypto.js');
    const { ciphertext, iv } = await encryptJSON({ access_token: 'stale-token' }, env.TOKEN_ENCRYPTION_KEY);
    await env.DB.prepare(`update accounts set token_ciphertext = ?, token_iv = ? where id = ?`)
      .bind(ciphertext, iv, accountId)
      .run();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid OAuth token', type: 'OAuthException', code: 190 } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    try {
      await runPoller();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(await getAccountStatus(accountId)).toBe('needs_reauth');
    const row = await getTarget(targetId);
    expect(row.status).toBe('queued');
    expect(row.attempt_count).toBe(0);
  });
});

// A cadência de recheck de quem está em 'processing'. Sem ela o poller reconsulta todo destino em
// processing a cada tique: no cron de 1 em 1 minuto, um container travado vira 360 chamadas à API
// da plataforma antes de o sweep de 6h desistir dele.
//
// A idade do processamento é lida do updated_at, que é congelado de propósito na entrada e nunca
// bumpado por um recheck (ver applyPublishResult). Não existe uma segunda coluna pra isso, e é por
// isso que estes testes mexem no updated_at pra simular um post travado.
describe('cadência de recheck do processing', () => {
  async function emProcessing(updatedAt: string, nextCheckAfter: string | null): Promise<string> {
    fake('instagram', {
      onPublish: () => ({ state: 'processing', adapterState: { creation_id: 'c1' } }),
      onCheckStatus: () => ({ state: 'processing', adapterState: { creation_id: 'c1' } }),
    });
    const accountId = await insertAccount({ platform: 'instagram' });
    const targetId = await insertPost({ accountId, platform: 'instagram', body: 'oi' });
    await runPoller();
    await env.DB.prepare(`update post_targets set updated_at = ?, next_check_after = ? where id = ?`)
      .bind(updatedAt, nextCheckAfter, targetId)
      .run();
    return targetId;
  }

  const minutosAtras = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
  const minutosAFrente = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

  it('processamento recente é rechecado no próximo tique, sem espera', async () => {
    const targetId = await emProcessing(minutosAtras(1), minutosAtras(1));
    await runPoller();

    // Zero de espera, e não "agora + 1min": o tique do cron já é o piso, e adiar um minuto custaria
    // ao post um tique inteiro aparecendo como não publicado.
    const { next_check_after } = await getTarget(targetId);
    expect(next_check_after).not.toBeNull();
    expect(new Date(next_check_after!).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('processamento parado há mais de 30min afasta o próximo recheck', async () => {
    const targetId = await emProcessing(minutosAtras(40), minutosAtras(1));
    await runPoller();

    const { next_check_after } = await getTarget(targetId);
    const esperaMin = (new Date(next_check_after!).getTime() - Date.now()) / 60_000;
    expect(esperaMin).toBeGreaterThan(14);
    expect(esperaMin).toBeLessThan(16);
  });

  it('não reconsulta a plataforma enquanto o next_check_after está no futuro', async () => {
    // A etapa de recheck roda na MESMA passada da publicação, então o fake precisa continuar em
    // processing na primeira volta; senão o post já sai publicado antes de haver o que testar.
    let jaPublica = false;
    const spy = fake('instagram', {
      onPublish: () => ({ state: 'processing', adapterState: { creation_id: 'c1' } }),
      onCheckStatus: () =>
        jaPublica ? { state: 'published', externalId: 'ext-1' } : { state: 'processing', adapterState: { creation_id: 'c1' } },
    });
    const accountId = await insertAccount({ platform: 'instagram' });
    const targetId = await insertPost({ accountId, platform: 'instagram', body: 'oi' });
    await runPoller();
    await env.DB.prepare(`update post_targets set next_check_after = ? where id = ?`)
      .bind(minutosAFrente(10), targetId)
      .run();

    // A partir daqui o fake publicaria na primeira consulta. Se o poller respeitar o relógio, ele
    // nem chega a perguntar, e é isso que o teste cobra.
    jaPublica = true;
    const antes = spy.checkStatusCalls.length;
    await runPoller();

    expect(spy.checkStatusCalls.length).toBe(antes);
    expect((await getTarget(targetId)).status).toBe('processing');
  });

  it('reclamar o destino limpa o relógio herdado da fase anterior', async () => {
    fake('instagram', { onPublish: () => ({ state: 'published', externalId: 'ext-1' }) });
    const accountId = await insertAccount({ platform: 'instagram' });
    const targetId = await insertPost({ accountId, platform: 'instagram', body: 'oi' });
    await env.DB.prepare(`update post_targets set next_check_after = ? where id = ?`)
      .bind(minutosAFrente(10), targetId)
      .run();

    await runPoller();

    // Sem isso, uma fase de processamento nova nasceria já devendo a espera da fase anterior.
    expect((await getTarget(targetId)).next_check_after).toBeNull();
  });
});
