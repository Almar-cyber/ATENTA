import type { Env } from './env.js';

// Single-user gate for the dashboard + /api/* — Basic Auth against one shared secret. No accounts
// table, sessions, or password hashing: this Worker has exactly one operator, and browsers cache
// Basic Auth credentials for the tab's lifetime once entered, so a login page would add UI for no
// gain. Username is ignored — only the password half is checked.
export function checkDashboardAuth(request: Request, env: Env): Response | null {
  const header = request.headers.get('Authorization');
  const creds = header?.startsWith('Basic ') ? decodeBasicAuth(header.slice(6)) : null;

  if (creds && timingSafeEqual(creds.pass, env.DASHBOARD_PASSWORD)) return null;

  return new Response('Autenticação necessária', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="social-scheduler"' },
  });
}

function decodeBasicAuth(b64: string): { user: string; pass: string } | null {
  try {
    const decoded = atob(b64);
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
