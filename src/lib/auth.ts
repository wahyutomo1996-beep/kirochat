/**
 * Authentication & session management.
 *
 * SECURITY: JWT_SECRET must be set in production. The fallback to a static
 * string would let anyone with access to this repo forge tokens for any
 * deployment that didn't set the env var.
 */

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'crypto';

const DEV_SECRET = 'dev-jwt-secret-change-in-production-very-insecure';
let cachedSecret: Uint8Array | null = null;
let warnedDev = false;

function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const raw = process.env.JWT_SECRET;
  if (!raw || raw.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SECURITY: JWT_SECRET env var is required in production. ' +
          'Generate one with: openssl rand -hex 32',
      );
    }
    if (!warnedDev) {
      // eslint-disable-next-line no-console
      console.warn(
        '\x1b[33m[auth]\x1b[0m JWT_SECRET not set, using DEV secret. ' +
          'Tokens are forgeable until you set a strong secret.',
      );
      warnedDev = true;
    }
    cachedSecret = new TextEncoder().encode(DEV_SECRET);
    return cachedSecret;
  }
  cachedSecret = new TextEncoder().encode(raw);
  return cachedSecret;
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  status: string;
}

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function requireAuth(): Promise<JWTPayload> {
  const session = await getSession();
  if (!session) {
    throw new Error('Unauthorized');
  }
  if (session.status !== 'approved') {
    throw new Error('Account not approved');
  }
  return session;
}

export async function requireAdmin(): Promise<JWTPayload> {
  const session = await requireAuth();
  if (session.role !== 'admin') {
    throw new Error('Admin access required');
  }
  return session;
}

/**
 * Generate a new API key.
 *
 * Returns the plain key (shown to user once). Use `hashApiKey()` before
 * persisting to DB so a database leak doesn't expose live keys.
 *
 * Format: pmt-<48 hex chars> (24 bytes entropy)
 */
export function generateApiKey(): string {
  return 'pmt-' + randomBytes(24).toString('hex');
}

/**
 * Hash an API key for storage and lookup. Uses SHA-256 (not bcrypt) because:
 *   - Lookups need to be O(1) — bcrypt is intentionally slow per-check
 *   - The key already has 24 bytes of entropy, so dictionary attacks aren't
 *     a concern (no need for slow hashing)
 *
 * The same key always hashes to the same value, so we can use the hash as
 * a unique index for lookup.
 */
export function hashApiKey(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}
