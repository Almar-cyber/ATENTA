// LinkedIn's dev console requires a registered HTTPS redirect_uri — unlike YouTube there's no
// loopback exception, so the callback is handled by the deployed Worker (see worker.ts
// handleOAuthCallback), not locally. This script only prints the URL to open; `state` carries
// the display_name through the redirect since the Worker itself has no other way to know which
// account you're authenticating.
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
      'Usage: npm run linkedin-auth-url -- --account="Meu Perfil" --redirect-base=https://social-scheduler.<subdomain>.workers.dev'
    );
    process.exit(1);
    return;
  }

  const clientId = requireEnv('LINKEDIN_CLIENT_ID');
  const redirectUri = `${redirectBase.replace(/\/$/, '')}/oauth/callback/linkedin`;
  const state = Buffer.from(JSON.stringify({ displayName })).toString('base64url');

  const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'openid profile w_member_social');

  console.log('Abra esta URL no navegador, logado com o perfil que vai postar:\n');
  console.log(url.toString());
  console.log(`\n(redirect_uri usado: ${redirectUri} — precisa estar registrado igualzinho no app do LinkedIn Developer Portal)`);
}

main();
