import type { ErrorClass } from './types.js';

/**
 * Error thrown by adapters when a platform API returns a non-OK response.
 *
 * Adapters used to throw plain `new Error('linkedin: post failed: 401 {...}')`, which made every
 * classifyError() table below dead code: extractCode() looks for a `code`/`error` property, a
 * plain Error has neither, so everything fell through to the 'retryable' fallback. In practice
 * that meant a revoked token was retried 5 times and then marked failed, and the account was
 * never flipped to needs_reauth — the one signal worker.ts has for Meta Page tokens, which never
 * trip needsRefresh() on their own.
 */
export class ApiError extends Error {
  readonly code: string | undefined;
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string, code: string | undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

/**
 * Builds an ApiError from a failed Response, consuming its body once.
 *
 * Usage: `throw await apiError('linkedin: post failed', res)`. The response body is read here, so
 * callers must not have read it already.
 */
export async function apiError(prefix: string, res: Response): Promise<ApiError> {
  const body = await res.text().catch(() => '');
  const code = extractCodeFromBody(body);
  const detail = code ? `${res.status} ${code} ${body}` : `${res.status} ${body}`;
  return new ApiError(`${prefix}: ${detail}`, res.status, body, code);
}

/**
 * Digs the platform's own error identifier out of a JSON error body. Each API nests it somewhere
 * different, and several return a number where the classification tables use a string:
 *   Meta:      {"error": {"type": "OAuthException", "code": 190}}
 *   LinkedIn:  {"code": "REVOKED_ACCESS_TOKEN"} / {"serviceErrorCode": 65601}
 *   TikTok:    {"error": {"code": "access_token_invalid"}}
 *   Pinterest: {"code": 2, "message": "..."}
 *   Google:    {"error": {"errors": [{"reason": "quotaExceeded"}]}}
 */
function extractCodeFromBody(body: string): string | undefined {
  if (!body) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;

  const root = parsed as Record<string, unknown>;
  const error = (typeof root.error === 'object' && root.error !== null ? root.error : {}) as Record<string, unknown>;

  // Google nests the useful reason one level deeper than everyone else.
  const googleReason = Array.isArray(error.errors)
    ? (error.errors[0] as Record<string, unknown> | undefined)?.reason
    : undefined;

  // googleReason outranks error.code because Google puts the plain HTTP status in error.code (403)
  // and the actionable identifier in errors[0].reason ("quotaExceeded"). Meta is the reverse — its
  // error.code (190) is meaningful — but Meta never sends an errors array, so the order is safe.
  return (
    firstString(error.type, googleReason, error.code, root.code, root.serviceErrorCode, root.error_code, root.error) ??
    undefined
  );
}

function firstString(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
    if (typeof candidate === 'number') return String(candidate);
  }
  return undefined;
}

/** Small static lookup per adapter — a generalized rules engine would be overkill at this volume. */
export function classifyByKnownCodes(
  err: unknown,
  table: Record<string, ErrorClass>,
  fallback?: ErrorClass
): ErrorClass {
  const code = extractCode(err);
  if (code && table[code]) return table[code];
  return fallback ?? classifyByStatus(err);
}

/**
 * When the platform didn't send a code we recognize, HTTP status is still a better signal than a
 * blanket 'retryable': a 400 retried 5 times is 5 guaranteed failures and a wasted day of backoff.
 */
function classifyByStatus(err: unknown): ErrorClass {
  const status = err instanceof ApiError ? err.status : undefined;
  if (status === undefined) return 'retryable';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota';
  if (status >= 400 && status < 500) return 'permanent';
  return 'retryable';
}

function extractCode(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.code === 'string') return anyErr.code;
    if (typeof anyErr.error === 'string') return anyErr.error;
  }
  return undefined;
}

// Parse best-effort de um corpo já lido: um corpo malformado/não-JSON só significa "sem código pra
// anexar" (cai no fallback de classifyByKnownCodes), não um erro novo pra lançar. Mantido porque os
// adapters daqui leem o corpo e classificam com classifyByKnownCodes + este helper (em vez do
// apiError() da branch, que faz as duas coisas de uma vez).
export function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
