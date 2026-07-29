import type { Env } from './env.js';

// Single-user gate for the dashboard + /api/* — Basic Auth against one shared secret. No accounts
// table, sessions, or password hashing: this Worker has exactly one operator, and browsers cache
// Basic Auth credentials for the tab's lifetime once entered, so a login page would add UI for no
// gain. Username is ignored — only the password half is checked.
//
// The gate is OPT-IN: with no DASHBOARD_PASSWORD secret set, the dashboard and the whole /api/*
// surface are open to anyone who requests the URL. That's a deliberate choice by the owner of this
// personal tool, not an oversight — but note what it exposes, since it's more than "read my queue":
// POST /api/posts can schedule a publish to any connected account, and POST /api/media writes to
// the R2 bucket. Tokens stay encrypted and no endpoint returns them. Re-enable any time with
// `wrangler secret put DASHBOARD_PASSWORD`; no redeploy needed.
export function checkDashboardAuth(request: Request, env: Env): Response | null {
  if (!env.DASHBOARD_PASSWORD) return null;

  const header = request.headers.get('Authorization');
  const creds = header?.startsWith('Basic ') ? decodeBasicAuth(header.slice(6)) : null;

  // NFC-normalize both sides: "ç" can arrive either as one codepoint or as "c" + combining
  // cedilla depending on where the password was typed (macOS is a common source of the latter),
  // and those are different strings byte-for-byte despite looking identical.
  if (creds && timingSafeEqual(creds.pass.normalize('NFC'), (env.DASHBOARD_PASSWORD ?? '').normalize('NFC'))) {
    return null;
  }

  return new Response('Autenticação necessária', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="social-scheduler"' },
  });
}

function decodeBasicAuth(b64: string): { user: string; pass: string } | null {
  try {
    // atob() yields one char per BYTE, so a password with any non-ASCII character (á, ç, ã — very
    // easy to pick here) came out mojibake'd and could never match. Browsers base64 the UTF-8
    // bytes of "user:pass", so the bytes have to be decoded as UTF-8 before comparing.
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const decoded = new TextDecoder('utf-8').decode(bytes);
    const idx = decoded.indexOf(':');
    if (idx === -1) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
