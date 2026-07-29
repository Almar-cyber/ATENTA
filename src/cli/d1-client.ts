// Shared by local CLI scripts (enqueue, youtube-auth, *-auth-url) that need D1/env access
// outside the deployed Worker. Loads .env here since nothing else does — npm/tsx don't source
// it automatically, unlike Wrangler which reads secrets a different way.
try {
  process.loadEnvFile();
} catch {
  // no .env file present — requireEnv() below throws a clear error for whichever var is missing
}

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set (see .env.example)`);
  return v;
}

interface D1QueryResponse<T> {
  success: boolean;
  errors: unknown[];
  result: Array<{ results: T[] }>;
}

export async function d1Query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  // Deliberately NOT named CF_ACCOUNT_ID/CF_API_TOKEN: Wrangler itself auto-loads this same
  // .env file and treats those exact names as legacy auth env vars, silently overriding the
  // `wrangler login` session with this D1-only-scoped token and breaking every other wrangler
  // command (secret put, deploy, ...) run from this directory.
  const accountId = requireEnv('D1_ACCOUNT_ID');
  const databaseId = requireEnv('D1_DATABASE_ID');
  const token = requireEnv('D1_API_TOKEN');

  const res = await fetch(`${CF_API_BASE}/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const json = (await res.json()) as D1QueryResponse<T>;
  if (!json.success) throw new Error(`D1 query failed: ${JSON.stringify(json.errors)}`);
  return json.result[0]?.results ?? [];
}
