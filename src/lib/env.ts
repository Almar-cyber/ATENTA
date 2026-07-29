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
}
