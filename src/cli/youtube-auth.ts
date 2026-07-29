// Local loopback OAuth flow (architecture doc §4: YouTube is the one platform that doesn't go
// through the Worker's /oauth/callback — Google's installed-app flow supports a localhost
// redirect directly). Run this once per YouTube channel; re-run to refresh if Google ever stops
// honoring the stored refresh_token (e.g. after 6 months of inactivity, or past the 50-token cap).
import http from 'node:http';
import { encryptJSON } from '../lib/crypto.js';
import { d1Query, requireEnv } from './d1-client.js';

const REDIRECT_PORT = 8783;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');

      if (error) {
        res.end(`Erro: ${error}. Pode fechar esta aba.`);
        server.close();
        reject(new Error(`google oauth error: ${error}`));
        return;
      }
      if (!code) {
        res.end('Aguardando ?code= ...');
        return;
      }
      res.end('Autenticado! Pode fechar esta aba e voltar pro terminal.');
      server.close();
      resolve(code);
    });
    server.listen(REDIRECT_PORT, '127.0.0.1');
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const displayName = args.account;
  if (!displayName) {
    console.error('Usage: npm run youtube-auth -- --account="Meu Canal"');
    process.exit(1);
    return;
  }

  const clientId = requireEnv('YOUTUBE_CLIENT_ID');
  const clientSecret = requireEnv('YOUTUBE_CLIENT_SECRET');
  const encryptionKey = requireEnv('TOKEN_ENCRYPTION_KEY');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.upload');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent'); // guarantees a refresh_token comes back

  console.log('Abra esta URL no navegador, com a conta Google dona do canal:\n');
  console.log(authUrl.toString());
  console.log(`\nEsperando o redirect em ${REDIRECT_URI} ...`);

  const code = await waitForCode();

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!tokenRes.ok) throw new Error(`token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  const tokenJson = (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in: number };

  if (!tokenJson.refresh_token) {
    throw new Error(
      'Google não retornou refresh_token — normalmente acontece quando essa conta já autorizou este app antes. ' +
        'Revogue o acesso em https://myaccount.google.com/permissions e rode de novo.'
    );
  }

  const { ciphertext, iv } = await encryptJSON(
    { access_token: tokenJson.access_token, refresh_token: tokenJson.refresh_token },
    encryptionKey
  );
  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const existing = await d1Query<{ id: string }>(
    `select id from accounts where platform = 'youtube' and display_name = ?`,
    [displayName]
  );

  if (existing.length > 0) {
    await d1Query(
      `update accounts set token_ciphertext = ?, token_iv = ?, access_token_expires_at = ?, status = 'active', updated_at = ? where id = ?`,
      [ciphertext, iv, expiresAt, nowIso, existing[0].id]
    );
  } else {
    const id = crypto.randomUUID();
    await d1Query(
      `insert into accounts (id, platform, display_name, status, token_ciphertext, token_iv, access_token_expires_at) values (?, 'youtube', ?, 'active', ?, ?, ?)`,
      [id, displayName, ciphertext, iv, expiresAt]
    );
  }

  console.log(`\nConta "${displayName}" autenticada e salva no D1.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
