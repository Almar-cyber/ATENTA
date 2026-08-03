// D1Database / R2Bucket / ScheduledEvent / ExecutionContext types come from
// @cloudflare/workers-types (see tsconfig.json "types"), no import needed.
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;

  // Static-assets binding (wrangler.toml [assets]) serving the built React SPA from ./dist.
  // The Worker owns /api, /oauth and /privacy and delegates everything else to this.
  ASSETS: Fetcher;

  // Plain (non-secret) var — see wrangler.toml [vars]. Base URL of the custom R2 domain used to
  // build media_assets.public_url on upload; empty/undefined leaves public_url null (media still
  // uploads fine, it just isn't usable by platforms that require a fetchable URL — see README).
  MEDIA_PUBLIC_BASE_URL?: string;

  // Quem pode criar conta. Ausente ou qualquer outro valor = fechado: só e-mails na tabela
  // signup_invites (fase de testadores). 'open' libera pra qualquer um — é a virada de chave
  // depois do App Review. O padrão restritivo é de propósito: esquecer de configurar deve travar
  // o cadastro, não escancarar.
  SIGNUP_MODE?: 'open' | string;

  // Wrangler secrets (`wrangler secret put NAME`) — never committed, never in .env.
  TOKEN_ENCRYPTION_KEY: string;

  // Chave que assina os cookies de sessão (src/lib/auth-server.ts). Sem ela o better-auth cai num
  // valor de desenvolvimento conhecido publicamente — qualquer um forjaria uma sessão. Gerar com
  // `openssl rand -base64 32` e gravar com `wrangler secret put AUTH_SECRET`.
  AUTH_SECRET: string;

  // Opcional: webhook (ntfy.sh ou Discord) pra onde o poller empurra alertas de falha/reauth/
  // ambíguo/timeout — os Cron Triggers não têm o e-mail de "workflow falhou" que o GitHub Actions
  // teria. Sem o secret, o alerta é só log (comportamento anterior). Ver src/lib/notify.ts.
  ALERT_WEBHOOK_URL?: string;

  // Gates the dashboard + /api/* (see src/lib/auth.ts) — single shared password, any username.
  // Optional: unset means no gate at all, i.e. the dashboard and API are publicly reachable.
  DASHBOARD_PASSWORD?: string;

  YOUTUBE_CLIENT_ID: string;
  YOUTUBE_CLIENT_SECRET: string;

  LINKEDIN_CLIENT_ID: string;
  LINKEDIN_CLIENT_SECRET: string;

  META_APP_ID: string;
  META_APP_SECRET: string;

  PINTEREST_CLIENT_ID: string;
  PINTEREST_CLIENT_SECRET: string;

  TIKTOK_CLIENT_KEY: string;
  TIKTOK_CLIENT_SECRET: string;
}
