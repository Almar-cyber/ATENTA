import type { ErrorClass } from './types.js';

/** Small static lookup per adapter — a generalized rules engine would be overkill at this volume. */
export function classifyByKnownCodes(
  err: unknown,
  table: Record<string, ErrorClass>,
  fallback: ErrorClass = 'retryable'
): ErrorClass {
  const code = extractCode(err);
  return (code && table[code]) || fallback;
}

function extractCode(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.code === 'string') return anyErr.code;
    if (typeof anyErr.error === 'string') return anyErr.error;
  }
  return undefined;
}
