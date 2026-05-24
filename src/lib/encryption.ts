/**
 * Encryption helper — AES-256-GCM with authenticated encryption.
 *
 * Used to protect refresh tokens and API keys at rest in the database.
 *
 * SECURITY: Production builds (NODE_ENV=production) refuse to start unless
 * ENCRYPTION_KEY is set. Dev mode falls back to a development key with a
 * loud warning, so devs can still iterate without manual env setup.
 *
 * Key requirements:
 *   - Production: 64 hex chars (32 bytes raw entropy from `openssl rand -hex 32`)
 *   - Dev: any string >= 16 chars (gets hashed to 32 bytes)
 *
 * Format on disk: `<iv-hex>:<authTag-hex>:<ciphertext-hex>`. The auth tag is
 * Critical for integrity — if anyone tampers with stored ciphertext, decrypt
 * throws.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const DEV_KEY = 'dev-32-char-encryption-key-here!';

/**
 * Derive a 32-byte key from the env var. We accept either:
 *   - a 64-char hex string (used directly), or
 *   - any other string (hashed via SHA-256 to get a 32-byte key)
 *
 * SHA-256 derivation lets users pass a passphrase without computing hex.
 * The hex path is preferred because it preserves full 256-bit entropy.
 */
function deriveKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return crypto.createHash('sha256').update(raw).digest();
}

let cachedKey: Buffer | null = null;
let warnedDev = false;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.ENCRYPTION_KEY;

  if (!raw || raw.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SECURITY: ENCRYPTION_KEY env var is required in production. ' +
          'Generate one with: openssl rand -hex 32',
      );
    }
    // Dev fallback - log loudly so it's obvious this isn't safe for prod
    if (!warnedDev) {
      // eslint-disable-next-line no-console
      console.warn(
        '\x1b[33m[encryption]\x1b[0m ENCRYPTION_KEY not set, using DEV key. ' +
          'This is unsafe for production. Generate one: openssl rand -hex 32',
      );
      warnedDev = true;
    }
    cachedKey = deriveKey(DEV_KEY);
    return cachedKey;
  }

  cachedKey = deriveKey(raw);
  return cachedKey;
}

export function encrypt(text: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  const key = getKey();
  const parts = encryptedText.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
