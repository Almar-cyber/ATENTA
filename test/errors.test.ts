import { describe, expect, it } from 'vitest';
import { ApiError, apiError, classifyByKnownCodes } from '../src/lib/errors.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('apiError code extraction', () => {
  it('reads Meta-style error.type', async () => {
    const err = await apiError('facebook: publish failed', jsonResponse({ error: { type: 'OAuthException', code: 190 } }, 401));
    expect(err.code).toBe('OAuthException');
    expect(err.status).toBe(401);
    expect(err.message).toContain('facebook: publish failed');
  });

  it('reads TikTok-style error.code', async () => {
    const err = await apiError('tiktok: init failed', jsonResponse({ error: { code: 'access_token_invalid' } }, 401));
    expect(err.code).toBe('access_token_invalid');
  });

  it('reads Google-style error.errors[0].reason', async () => {
    const err = await apiError(
      'youtube: upload failed',
      jsonResponse({ error: { errors: [{ reason: 'quotaExceeded' }], code: 403 } }, 403)
    );
    expect(err.code).toBe('quotaExceeded');
  });

  it('reads a top-level LinkedIn-style code', async () => {
    const err = await apiError('linkedin: post failed', jsonResponse({ code: 'REVOKED_ACCESS_TOKEN' }, 401));
    expect(err.code).toBe('REVOKED_ACCESS_TOKEN');
  });

  it('stringifies a numeric code so the lookup tables can match it', async () => {
    const err = await apiError('pinterest: pin create failed', jsonResponse({ code: 2 }, 401));
    expect(err.code).toBe('2');
  });

  it('survives a non-JSON body', async () => {
    const err = await apiError('linkedin: post failed', new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    expect(err.code).toBeUndefined();
    expect(err.status).toBe(502);
    expect(err.body).toContain('502 Bad Gateway');
  });

  it('survives an empty body', async () => {
    const err = await apiError('tiktok: chunk upload failed', new Response(null, { status: 500 }));
    expect(err.code).toBeUndefined();
    expect(err.status).toBe(500);
  });
});

describe('classifyByKnownCodes', () => {
  const table = { OAuthException: 'auth', rate_limit_exceeded: 'quota' } as const;

  it('matches a known platform code', async () => {
    const err = await apiError('facebook', jsonResponse({ error: { type: 'OAuthException' } }, 400));
    expect(classifyByKnownCodes(err, table)).toBe('auth');
  });

  it('prefers the code over the status', async () => {
    // A 400 that carries a known auth code must not be classified 'permanent' by status.
    const err = await apiError('facebook', jsonResponse({ error: { type: 'OAuthException' } }, 400));
    expect(classifyByKnownCodes(err, table)).toBe('auth');
  });

  it('falls back to auth on 401', async () => {
    const err = await apiError('x', jsonResponse({ error: { type: 'Unknown' } }, 401));
    expect(classifyByKnownCodes(err, table)).toBe('auth');
  });

  it('falls back to auth on 403', async () => {
    const err = await apiError('x', new Response('forbidden', { status: 403 }));
    expect(classifyByKnownCodes(err, table)).toBe('auth');
  });

  it('falls back to quota on 429', async () => {
    const err = await apiError('x', new Response('slow down', { status: 429 }));
    expect(classifyByKnownCodes(err, table)).toBe('quota');
  });

  it('falls back to permanent on a generic 4xx', async () => {
    // The point of this branch: a 400 is deterministic, so retrying it 5 times over 75 minutes
    // only delays the inevitable.
    const err = await apiError('x', new Response('bad request', { status: 400 }));
    expect(classifyByKnownCodes(err, table)).toBe('permanent');
  });

  it('falls back to retryable on 5xx', async () => {
    const err = await apiError('x', new Response('server error', { status: 503 }));
    expect(classifyByKnownCodes(err, table)).toBe('retryable');
  });

  it('treats a non-ApiError as retryable', async () => {
    expect(classifyByKnownCodes(new Error('something odd'), table)).toBe('retryable');
  });

  it('honours an explicit fallback over the status heuristic', () => {
    const err = new ApiError('x', 400, '', undefined);
    expect(classifyByKnownCodes(err, table, 'ambiguous')).toBe('ambiguous');
  });
});
