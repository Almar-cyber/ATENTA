// TikTok's dev console requires a registered HTTPS redirect_uri — same story as
// LinkedIn/Meta/Pinterest. The Worker does the token exchange (see worker.ts
// handleTiktokCallback); this just prints the consent URL. `state` carries the display_name.
//
// The Content Posting API audit is approved for this app, so `video.publish` grants real
// direct-post access — posts go out at the privacy level the account actually offers (see
// adapters/tiktok.ts), not the SELF_ONLY sandbox the unaudited flow was stuck with.
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
      'Usage: npm run tiktok-auth-url -- --account="Minha Conta" --redirect-base=https://social-scheduler.<subdomain>.workers.dev'
    );
    process.exit(1);
    return;
  }

  const clientKey = requireEnv('TIKTOK_CLIENT_KEY');
  const redirectUri = `${redirectBase.replace(/\/$/, '')}/oauth/callback/tiktok`;
  const state = Buffer.from(JSON.stringify({ displayName })).toString('base64url');

  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', clientKey);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'user.info.basic,video.publish,video.upload');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);

  console.log('Abra esta URL no navegador, logado com a conta que vai postar:\n');
  console.log(url.toString());
  console.log(`\n(redirect_uri usado: ${redirectUri} — precisa estar registrado igualzinho no app do TikTok Developers)`);
  console.log('\nAceite os dois pedidos de permissão (perfil + publicar vídeo) — sem o escopo video.publish o adapter não posta.');
}

main();
