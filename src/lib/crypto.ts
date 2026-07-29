// Token encryption for D1 (no Postgres-Vault equivalent on Cloudflare). Standard Web Crypto
// AES-GCM — not hand-rolled crypto, just the platform's built-in primitive — keyed from a
// Wrangler secret (TOKEN_ENCRYPTION_KEY) that only ever exists as a Worker secret.
//
// Generate the key once with: `openssl rand -base64 32`, then `wrangler secret put TOKEN_ENCRYPTION_KEY`.

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
}

export async function encryptJSON(payload: unknown, base64Key: string): Promise<EncryptedPayload> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertextBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuf)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptJSON<T>(ciphertext: string, iv: string, base64Key: string): Promise<T> {
  const key = await importKey(base64Key);
  const plaintextBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintextBuf)) as T;
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64ToBytes(base64Key), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
