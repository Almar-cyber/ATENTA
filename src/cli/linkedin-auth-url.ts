// LinkedIn's dev console requires a registered HTTPS redirect_uri — unlike YouTube there's no
// loopback exception, so the callback is handled by the deployed Worker (see worker.ts
// handleOAuthCallback), not locally. This script only prints the URL to open; `state` carries
// the display_name through the redirect since the Worker itself has no other way to know which
// account you're authenticating.
import { requireEnv } from './d1-client.js';
import { buildAuthUrl } from '../lib/oauth-urls.js';

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

  const url = buildAuthUrl('linkedin', { clientId, redirectUri, state });

  console.log('Abra esta URL no navegador, logado com o perfil que vai postar:\n');
  console.log(url);
  console.log(`\n(redirect_uri usado: ${redirectUri} — precisa estar registrado igualzinho no app do LinkedIn Developer Portal)`);
}

main();
