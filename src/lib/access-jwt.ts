// Validação do JWT do Cloudflare Access.
//
// POR QUE ISSO EXISTE: o Access injeta o e-mail autenticado num header, mas header é texto — quem
// alcançar o Worker POR FORA do Access (a URL *.workers.dev, por exemplo) pode simplesmente
// mandá-lo na mão e se passar por qualquer dono. Confiar no header só seria seguro se o Worker
// fosse inalcançável sem passar pelo Access, o que não é o caso aqui.
//
// O que é confiável é o `Cf-Access-Jwt-Assertion`: um JWT assinado pela chave privada da sua
// equipe no Access. Aqui verificamos a assinatura contra o JWKS público dela (RS256), mais
// expiração e audience. Sem JWT válido, o e-mail do header é ignorado.

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  use?: string;
  n: string;
  e: string;
}

export interface AccessClaims {
  email?: string;
  aud?: string | string[];
  exp?: number;
  iss?: string;
}

// O JWKS muda raramente (rotação de chave); buscar a cada request seria um round-trip a mais em
// tudo. Cache em memória do isolate, com TTL curto pra rotação ser absorvida sozinha.
const JWKS_TTL_MS = 60 * 60 * 1000; // 1h
let jwksCache: { url: string; keys: Jwk[]; fetchedAt: number } | null = null;

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKeys(teamDomain: string): Promise<Jwk[]> {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (jwksCache && jwksCache.url === url && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`access: JWKS ${res.status}`);
  const json = (await res.json()) as { keys?: Jwk[] };
  const keys = json.keys ?? [];
  jwksCache = { url, keys, fetchedAt: Date.now() };
  return keys;
}

/**
 * Verifica o JWT do Access e devolve as claims, ou `null` se não for válido (assinatura errada,
 * expirado, audience de outra aplicação, chave desconhecida). NUNCA lança — a chamada fica no
 * caminho de toda requisição e um erro de rede não pode virar 500.
 */
export async function verifyAccessJwt(token: string, teamDomain: string, expectedAud?: string): Promise<AccessClaims | null> {
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    if (!headerB64 || !payloadB64 || !sigB64) return null;

    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64))) as { kid?: string; alg?: string };
    // Só RS256: aceitar `alg` do próprio token abriria o clássico "alg: none"/downgrade.
    if (header.alg !== 'RS256' || !header.kid) return null;

    const jwk = (await getKeys(teamDomain)).find((k) => k.kid === header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
    if (!ok) return null;

    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64))) as AccessClaims;

    // Expiração: um JWT vencido é tão inútil quanto um forjado.
    if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null;

    // Audience: amarra o token A ESTA aplicação. Sem isso, um JWT válido emitido para outra
    // aplicação da mesma equipe entraria aqui.
    if (expectedAud) {
      const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
      if (!aud.includes(expectedAud)) return null;
    }

    return claims;
  } catch {
    return null;
  }
}
