// Shared by local CLI scripts (enqueue, youtube-auth) that need D1 access outside the deployed
// Worker — talks to Cloudflare's D1 REST API rather than the env.DB binding, which only exists
// inside the Worker itself.

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
  const accountId = requireEnv('CF_ACCOUNT_ID');
  const databaseId = requireEnv('CF_D1_DATABASE_ID');
  const token = requireEnv('CF_API_TOKEN');

  const res = await fetch(`${CF_API_BASE}/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const json = (await res.json()) as D1QueryResponse<T>;
  if (!json.success) throw new Error(`D1 query failed: ${JSON.stringify(json.errors)}`);
  return json.result[0]?.results ?? [];
}
