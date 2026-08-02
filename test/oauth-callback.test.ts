import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/worker.js';

const ORIGIN = 'https://social-scheduler.test';

async function callback(path: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('OAuth callback error surfacing', () => {
  it('repeats the provider error back instead of hiding it behind "missing ?code="', async () => {
    // Regression: the handler only looked for ?code= and answered "missing ?code=", discarding the
    // error_description the provider had just sent — which is the entire explanation of why
    // authorization failed.
    const res = await callback(
      '/oauth/callback/tiktok?error=access_denied&error_description=user+is+not+a+target+user'
    );

    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('access_denied');
    expect(body).toContain('user is not a target user');
    expect(body).toContain('tiktok');
  });

  it("surfaces TikTok's non-standard error_code and log_id too", async () => {
    const res = await callback('/oauth/callback/tiktok?error_code=10007&log_id=2024abc');

    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('10007');
    expect(body).toContain('2024abc');
  });

  it('surfaces a Meta-style error_reason', async () => {
    const res = await callback('/oauth/callback/meta?error=access_denied&error_reason=user_denied');

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('user_denied');
  });

  it('works the same for every platform on the route', async () => {
    for (const platform of ['linkedin', 'meta', 'pinterest', 'tiktok']) {
      const res = await callback(`/oauth/callback/${platform}?error=access_denied`);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain(platform);
    }
  });

  it('dumps the received parameters when there is no code and no known error field', async () => {
    const res = await callback('/oauth/callback/pinterest?something_unexpected=42');

    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('something_unexpected=42');
  });

  it('reports an empty query rather than pretending nothing arrived', async () => {
    const res = await callback('/oauth/callback/linkedin');

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('(nenhum)');
  });

  it('never echoes the authorization code', async () => {
    // The code is a short-lived credential; it must not land in an error page or the logs. This
    // path is reachable because state is validated after code.
    const res = await callback('/oauth/callback/tiktok?code=super-secret-code');

    const body = await res.text();
    expect(body).not.toContain('super-secret-code');
  });

  it('ignores an empty error param and falls through to the code check', async () => {
    const res = await callback('/oauth/callback/tiktok?error=&code=abc');

    // Not treated as a provider error: it proceeds and fails later on the missing state.
    expect(await res.text()).not.toContain('recusou a autorização');
  });

  it('delega rota desconhecida ao SPA (static assets), não 404', async () => {
    // Com o dashboard, rotas que não são /api, /oauth nem /privacy caem no binding de assets, que
    // serve o index.html e deixa o React rotear no cliente — deixaram de ser 404 do Worker.
    const res = await callback('/nope');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });
});
