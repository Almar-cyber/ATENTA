// Pinterest's dev console requires a registered HTTPS redirect_uri — same story as LinkedIn/Meta.
// The Worker does the token exchange (see worker.ts handlePinterestCallback); this just prints
// the consent URL. `state` carries the display_name through the redirect.
import { requireEnv } from './d1-client.js';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const displayName = args.account;
  const redirectBase = args['redirect-base'];
  if (!displayName || !redirectBase) {
    console.error(
      'Usage: npm run pinterest-auth-url -- --account="Meu Perfil" --redirect-base=https://social-scheduler.<subdomain>.workers.dev'
    );
    process.exit(1);
    return;
  }

  const clientId = requireEnv('PINTEREST_CLIENT_ID');
  const redirectUri = `${redirectBase.replace(/\/$/, '')}/oauth/callback/pinterest`;
  const state = Buffer.from(JSON.stringify({ displayName })).toString('base64url');

  const url = new URL('https://www.pinterest.com/oauth/');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'boards:read,pins:read,pins:write');

  console.log('Abra esta URL no navegador, logado com a conta que vai postar:\n');
  console.log(url.toString());
  console.log(`\n(redirect_uri usado: ${redirectUri} — precisa estar registrado igualzinho no app do Pinterest Developers)`);
  console.log('\nLembrete: sem acesso Standard aprovado (revisão com vídeo de demonstração), os Pins só ficam visíveis em modo Sandbox.');
}

main();
