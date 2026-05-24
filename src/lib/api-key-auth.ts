/**
 * API Key Authentication
 *
 * Authenticates requests via Bearer API key in Authorization header.
 * Used by OpenAI-compatible /v1 endpoints.
 *
 * SECURITY: We look up by SHA-256 hash, never by plain key. The plain key is
 * only present in the request and the user's clipboard - it's never stored
 * in our DB. Even a full DB dump exposes only hashes.
 */

import { prisma } from './prisma';
import { hashApiKey } from './auth';

export interface ApiKeyAuthResult {
  userId: string;
  username: string;
  email: string;
  role: string;
}

/**
 * Extract Bearer token from Authorization header.
 */
export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Authenticate a request using API key.
 * Returns the user info or throws.
 */
export async function requireApiKey(req: Request): Promise<ApiKeyAuthResult> {
  const apiKey = extractBearerToken(req);
  if (!apiKey) {
    throw new Error('Missing Authorization header');
  }

  if (!apiKey.startsWith('pmt-')) {
    throw new Error('Invalid API key format. Expected: pmt-<...>');
  }

  // Hash the presented key and look up by hash. This is constant-time at the
  // DB level (B-tree index lookup) and the hash itself is fast (sha256 < 1µs).
  const hash = hashApiKey(apiKey);
  const user = await prisma.user.findUnique({
    where: { apiKeyHash: hash },
  });

  if (!user) {
    throw new Error('Invalid API key');
  }

  if (user.status !== 'approved') {
    throw new Error('Account not approved');
  }

  return {
    userId: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
}
