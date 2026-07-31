// TikTok's dev console requires a registered HTTPS redirect_uri — same story as
// LinkedIn/Meta/Pinterest. The Worker does the token exchange (see worker.ts
// handleTiktokCallback); this just prints the consent URL. `state` carries the display_name.
//
// Requires the Content Posting API scope to have been granted for this app (review with a demo
// video + privacy policy — see README). Until then, posts are forced SELF_ONLY to sandbox test
// accounts regardless of what this script or the adapter request.
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
      'Usage: npm run tiktok-auth-url -- --account="Minha Conta" --redirect-base=https://social-scheduler.<subdomain>.workers.dev'
    );
    process.exit(1);
    return;
  }

  const clientKey = requireEnv('TIKTOK_CLIENT_KEY');
  const redirectUri = `${redirectBase.replace(/\/$/, '')}/oauth/callback/tiktok`;
  const state = Buffer.from(JSON.stringify({ displayName })).toString('base64url');

  const url = buildAuthUrl('tiktok', { clientId: clientKey, redirectUri, state });

  console.log('Abra esta URL no navegador, logado com a conta que vai postar:\n');
  console.log(url);
  console.log(`\n(redirect_uri usado: ${redirectUri} — precisa estar registrado igualzinho no app do TikTok Developers)`);
  console.log('\nSem a auditoria da Content Posting API aprovada, posts ficam forçados a SELF_ONLY numa conta de sandbox.');
}

main();
