import { decryptJSON, encryptJSON } from './crypto.js';
import { nowIso } from './db.js';

// Adapters (Phase 1+) call these instead of touching token_ciphertext/token_iv directly.

export async function getAccountTokens<T = Record<string, unknown>>(
  db: D1Database,
  accountId: string,
  encryptionKey: string
): Promise<T | null> {
  const row = await db
    .prepare('select token_ciphertext, token_iv from accounts where id = ?')
    .bind(accountId)
    .first<{ token_ciphertext: string | null; token_iv: string | null }>();
  if (!row?.token_ciphertext || !row.token_iv) return null;
  return decryptJSON<T>(row.token_ciphertext, row.token_iv, encryptionKey);
}

export async function setAccountTokens(
  db: D1Database,
  accountId: string,
  payload: Record<string, unknown>,
  encryptionKey: string
): Promise<void> {
  const { ciphertext, iv } = await encryptJSON(payload, encryptionKey);
  await db
    .prepare('update accounts set token_ciphertext = ?, token_iv = ?, updated_at = ? where id = ?')
    .bind(ciphertext, iv, nowIso(), accountId)
    .run();
}
