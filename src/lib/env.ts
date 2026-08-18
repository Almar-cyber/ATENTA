// D1Database / R2Bucket / ScheduledEvent / ExecutionContext types come from
// @cloudflare/workers-types (see tsconfig.json "types"), no import needed.
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;

  // Wrangler secrets (`wrangler secret put NAME`) — never committed, never in .env.
  TOKEN_ENCRYPTION_KEY: string;

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

  /** Shared secret gating /admin — the posting UI writes to D1 and spends platform quota. */
  ADMIN_TOKEN: string;

  /** Pins the OAuth redirect_uri when the Worker answers on more than one hostname — it must match
   *  what each platform's console has registered. Defaults to the host the browser is on. */
  OAUTH_REDIRECT_BASE?: string;

  /** Public base URL of the R2 custom domain, e.g. https://scheduler-media.omangue.co. Optional:
   *  only Instagram, Facebook and Pinterest fetch media by URL. Set as a wrangler var, not a secret. */
  MEDIA_PUBLIC_BASE?: string;
}
