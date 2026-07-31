// Meta (Instagram + Facebook) dev console requires a registered HTTPS redirect_uri, same story
// as LinkedIn — the Worker handles the actual token exchange (see worker.ts
// handleMetaCallback). This script only prints the consent URL; `state` carries the
// display_name through the redirect.
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
      'Usage: npm run meta-auth-url -- --account="Minha Marca" --redirect-base=https://social-scheduler.<subdomain>.workers.dev'
    );
    process.exit(1);
    return;
  }

  const clientId = requireEnv('META_APP_ID');
  const redirectUri = `${redirectBase.replace(/\/$/, '')}/oauth/callback/meta`;
  const state = Buffer.from(JSON.stringify({ displayName })).toString('base64url');

  const url = buildAuthUrl('meta', { clientId, redirectUri, state });

  console.log('Abra esta URL no navegador, logado com a conta que administra a Page:\n');
  console.log(url);
  console.log(`\n(redirect_uri usado: ${redirectUri} — precisa estar registrado igualzinho no app do Meta for Developers)`);
  console.log(
    '\nAssume que você concede acesso a UMA Page só. Se aparecer mais de uma no seletor de contas do Meta, desmarque as que não são desta ferramenta.'
  );
}

main();
