export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
}

// `init` may be a factory instead of a plain object. This matters for a streamed body (e.g. an
// R2 range read): a ReadableStream can only be consumed once, so retrying with the *same* init
// object would hand fetch() an already-disturbed stream. Passing a factory lets each attempt get
// a fresh body (a new R2 read) instead. Existing callers passing a plain object are unaffected.
export async function fetchWithRetry(
  input: string,
  init: RequestInit | (() => RequestInit | Promise<RequestInit>) = {},
  opts: RetryOptions = {}
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, typeof init === 'function' ? await init() : init);
      if (res.status >= 500 && attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wraps an R2 object body so it can be handed to fetch() as a request body without buffering the
// whole thing into memory first. Plain `r2Body` as a fetch body works but falls back to chunked
// transfer-encoding (per Workers' Request docs); FixedLengthStream declares the length up front
// so the outbound request gets a real Content-Length instead — several of these platforms'
// upload endpoints expect an exact declared length rather than chunked encoding.
export function toFixedLengthBody(r2Body: ReadableStream, length: number): ReadableStream {
  const { readable, writable } = new FixedLengthStream(length);
  // Any read/write failure here aborts both sides of the transform, which surfaces to the
  // consuming fetch() as a body-stream error — that's the real failure signal, so the specific
  // rejection from this background pipe is deliberately not re-thrown (would be an unhandled
  // rejection with nothing left to catch it).
  r2Body.pipeTo(writable).catch(() => {});
  return readable;
}
