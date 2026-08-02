// state + cookie do fluxo OAuth iniciado pelo navegador (endpoint /api/connect → callback).
//
// O `state` do OAuth carrega um nonce; o mesmo nonce é gravado num cookie HttpOnly na hora de
// iniciar a conexão. No callback, o Worker compara cookie × state e rejeita se diferente — é a
// proteção CSRF que o fluxo antigo (CLI) não tinha. O CLI continua mandando `{displayName}` no
// state (sem nonce/cookie); o callback trata os dois formatos (ver worker.ts).
//
// Buffer vem do nodejs_compat (wrangler.toml) no Worker e é nativo no Node.

export const OAUTH_STATE_COOKIE = 'oauth_state';

export interface OAuthStatePayload {
  n?: string; // nonce (fluxo pelo navegador)
  o?: string; // dono (owner_id) de quem iniciou a conexão — o callback não tem sessão pra consultar
  displayName?: string; // legado do CLI
}

export function encodeState(payload: OAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeState(state: string | null): OAuthStatePayload {
  if (!state) return {};
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as OAuthStatePayload;
  } catch {
    return {};
  }
}

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// SameSite=Lax deixa o cookie seguir na navegação GET top-level de volta do consentimento
// (same-origin). Sem `Secure` de propósito, pra funcionar em http://localhost no dev.
export function setStateCookie(nonce: string): string {
  return `${OAUTH_STATE_COOKIE}=${nonce}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`;
}

export function clearStateCookie(): string {
  return `${OAUTH_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
