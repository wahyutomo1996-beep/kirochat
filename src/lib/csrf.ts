/**
 * CSRF protection — double-submit cookie pattern.
 *
 * IMPORTANT: This module MUST work in both Node.js (API routes) and Edge
 * runtime (middleware). That's why we use Web Crypto API (globalThis.crypto)
 * instead of `node:crypto` — Edge Runtime forbids node modules.
 *
 * How it works:
 *   1. Server sets a non-httpOnly 'csrf' cookie on each authenticated GET.
 *   2. Frontend reads that cookie value (it's same-origin) and echoes it
 *      back in an 'X-CSRF-Token' header on every state-changing request.
 *   3. Server verifies header == cookie. Cross-origin attackers can't read
 *      the cookie (same-origin policy) and can't set it via fetch (it's
 *      same-site), so they can't satisfy this check.
 *
 * The token is HMAC of (userId + random) so it's bound to the user — even
 * if an attacker grabs a token from one user, it won't validate for another.
 */

const COOKIE_NAME = 'csrf';
const HEADER_NAME = 'x-csrf-token';

/** Encoder reused across all token operations */
const enc = new TextEncoder();

/**
 * Derive the HMAC secret from JWT_SECRET (same trust boundary). Falls back
 * to dev value with warning if missing.
 */
let cachedSecret: string | null = null;
function getCsrfSecret(): string {
  if (cachedSecret) return cachedSecret;
  const raw = process.env.JWT_SECRET;
  if (!raw || raw.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SECURITY: JWT_SECRET required for CSRF protection');
    }
    cachedSecret = 'dev-csrf-secret';
    return cachedSecret;
  }
  cachedSecret = raw;
  return cachedSecret;
}

/** Cache the imported HMAC key — the import is async but the key is reused */
let keyPromise: Promise<CryptoKey> | null = null;
function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      'raw',
      enc.encode(getCsrfSecret()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  }
  return keyPromise;
}

/** Convert ArrayBuffer to lowercase hex string */
function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i].toString(16);
    hex += v.length === 1 ? '0' + v : v;
  }
  return hex;
}

/** Sign userId+random with HMAC-SHA256 and return hex */
async function sign(userId: string, random: string): Promise<string> {
  const key = await getKey();
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${userId}:${random}`));
  return bufToHex(sig);
}

/**
 * Constant-time string comparison. Iterates full length to avoid leaking
 * which prefix matched via timing.
 */
function timingSafeStringEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Generate a CSRF token bound to a user. Format:
 *   <random-hex>.<hmac-hex>
 *
 * The random part is unpredictable (32 bytes from CSPRNG); the HMAC part
 * proves the token came from us and binds it to the user.
 */
export async function generateCsrfToken(userId: string): Promise<string> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const random = bufToHex(randomBytes.buffer);
  const sig = await sign(userId, random);
  return `${random}.${sig}`;
}

/**
 * Verify a CSRF token. Constant-time comparison of HMAC.
 */
export async function verifyCsrfToken(
  token: string | null | undefined,
  userId: string,
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [random, sig] = parts;
  if (!random || !sig) return false;

  const expected = await sign(userId, random);
  return timingSafeStringEq(sig, expected);
}

/**
 * Read the CSRF token from a request's cookie header.
 */
export function readCsrfCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Read the CSRF token from a request's X-CSRF-Token header.
 */
export function readCsrfHeader(request: Request): string | null {
  return request.headers.get(HEADER_NAME) || request.headers.get(HEADER_NAME.toUpperCase());
}

/**
 * Determine if a request must satisfy CSRF.
 *
 *   - Only POST/PUT/PATCH/DELETE
 *   - Only /api/* paths
 *   - Excludes /api/auth/login, /register, /me — login/register can't have
 *     a session yet; /me is GET-only.
 *   - Excludes /v1/* (API gateway uses Bearer token auth, not cookies, so
 *     CSRF doesn't apply — there's no ambient credential to abuse)
 *   - Excludes /api/health (public)
 */
export function requiresCsrf(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;

  const url = new URL(request.url);
  const path = url.pathname;

  if (!path.startsWith('/api/')) return false;
  if (path.startsWith('/api/auth/login')) return false;
  if (path.startsWith('/api/auth/register')) return false;
  if (path.startsWith('/api/auth/me')) return false;
  if (path.startsWith('/api/health')) return false;

  return true;
}

export const CSRF_COOKIE_NAME = COOKIE_NAME;
export const CSRF_HEADER_NAME = HEADER_NAME;
