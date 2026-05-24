/**
 * CSRF token generation + verification tests.
 */

import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-with-enough-entropy-1234567890';
});

describe('csrf token', () => {
  it('generates a valid token bound to userId', async () => {
    const { generateCsrfToken, verifyCsrfToken } = await import('../csrf');
    const userId = 'user-abc';
    const token = await generateCsrfToken(userId);
    expect(token).toMatch(/^[0-9a-f]+\.[0-9a-f]+$/);
    expect(await verifyCsrfToken(token, userId)).toBe(true);
  });

  it('rejects token bound to a different user', async () => {
    const { generateCsrfToken, verifyCsrfToken } = await import('../csrf');
    const token = await generateCsrfToken('user-a');
    expect(await verifyCsrfToken(token, 'user-b')).toBe(false);
  });

  it('rejects null/empty/malformed tokens', async () => {
    const { verifyCsrfToken } = await import('../csrf');
    expect(await verifyCsrfToken(null, 'u')).toBe(false);
    expect(await verifyCsrfToken(undefined, 'u')).toBe(false);
    expect(await verifyCsrfToken('', 'u')).toBe(false);
    expect(await verifyCsrfToken('no-dot', 'u')).toBe(false);
    expect(await verifyCsrfToken('.empty-random', 'u')).toBe(false);
    expect(await verifyCsrfToken('empty-sig.', 'u')).toBe(false);
  });

  it('rejects token with tampered HMAC', async () => {
    const { generateCsrfToken, verifyCsrfToken } = await import('../csrf');
    const token = await generateCsrfToken('user-x');
    // Flip a byte in the signature half
    const [random, sig] = token.split('.');
    const tampered = `${random}.${sig.slice(0, -1)}${sig.endsWith('a') ? 'b' : 'a'}`;
    expect(await verifyCsrfToken(tampered, 'user-x')).toBe(false);
  });

  it('produces unique tokens per call (different random parts)', async () => {
    const { generateCsrfToken } = await import('../csrf');
    const t1 = await generateCsrfToken('u');
    const t2 = await generateCsrfToken('u');
    expect(t1).not.toBe(t2);
  });
});

describe('csrf request guards', () => {
  it('requiresCsrf returns true for state-changing /api requests', async () => {
    const { requiresCsrf } = await import('../csrf');
    const req = (method: string, path: string) =>
      new Request(`http://localhost${path}`, { method });

    expect(requiresCsrf(req('POST', '/api/api-key'))).toBe(true);
    expect(requiresCsrf(req('PATCH', '/api/kiro-accounts/1'))).toBe(true);
    expect(requiresCsrf(req('DELETE', '/api/providers/1'))).toBe(true);
    expect(requiresCsrf(req('PUT', '/api/admin/users/1'))).toBe(true);
  });

  it('requiresCsrf returns false for safe methods', async () => {
    const { requiresCsrf } = await import('../csrf');
    const req = (method: string, path: string) =>
      new Request(`http://localhost${path}`, { method });

    expect(requiresCsrf(req('GET', '/api/dashboard'))).toBe(false);
    expect(requiresCsrf(req('HEAD', '/api/health'))).toBe(false);
    expect(requiresCsrf(req('OPTIONS', '/api/api-key'))).toBe(false);
  });

  it('requiresCsrf returns false for excluded paths', async () => {
    const { requiresCsrf } = await import('../csrf');
    const req = (method: string, path: string) =>
      new Request(`http://localhost${path}`, { method });

    expect(requiresCsrf(req('POST', '/api/auth/login'))).toBe(false);
    expect(requiresCsrf(req('POST', '/api/auth/register'))).toBe(false);
    expect(requiresCsrf(req('POST', '/api/health'))).toBe(false);
    expect(requiresCsrf(req('POST', '/v1/chat/completions'))).toBe(false);
  });
});
