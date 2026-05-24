/**
 * Auth helper tests — API key generation, hashing, Bearer extraction.
 */

import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-with-enough-entropy-1234567890';
  process.env.NODE_ENV = 'test';
});

describe('generateApiKey', () => {
  it('produces keys with the pmt- prefix', async () => {
    const { generateApiKey } = await import('../auth');
    for (let i = 0; i < 10; i++) {
      const k = generateApiKey();
      expect(k).toMatch(/^pmt-[0-9a-f]{48}$/);
    }
  });

  it('produces unique keys (high entropy)', async () => {
    const { generateApiKey } = await import('../auth');
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateApiKey());
    expect(set.size).toBe(100);
  });
});

describe('hashApiKey', () => {
  it('produces deterministic SHA-256 hex output', async () => {
    const { hashApiKey } = await import('../auth');
    const a = hashApiKey('pmt-abc123');
    const b = hashApiKey('pmt-abc123');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different keys', async () => {
    const { hashApiKey } = await import('../auth');
    expect(hashApiKey('pmt-a')).not.toBe(hashApiKey('pmt-b'));
  });
});

describe('extractBearerToken', () => {
  it('extracts token from Bearer header', async () => {
    const { extractBearerToken } = await import('../api-key-auth');
    const r = new Request('http://x', { headers: { authorization: 'Bearer pmt-test123' } });
    expect(extractBearerToken(r)).toBe('pmt-test123');
  });

  it('handles capitalized header name', async () => {
    const { extractBearerToken } = await import('../api-key-auth');
    const r = new Request('http://x', { headers: { Authorization: 'Bearer pmt-test123' } });
    expect(extractBearerToken(r)).toBe('pmt-test123');
  });

  it('handles case-insensitive Bearer keyword', async () => {
    const { extractBearerToken } = await import('../api-key-auth');
    const r = new Request('http://x', { headers: { authorization: 'bearer pmt-x' } });
    expect(extractBearerToken(r)).toBe('pmt-x');
  });

  it('returns null when header missing', async () => {
    const { extractBearerToken } = await import('../api-key-auth');
    const r = new Request('http://x');
    expect(extractBearerToken(r)).toBeNull();
  });

  it('returns null for non-Bearer auth schemes', async () => {
    const { extractBearerToken } = await import('../api-key-auth');
    const r = new Request('http://x', { headers: { authorization: 'Basic abc123' } });
    expect(extractBearerToken(r)).toBeNull();
  });
});
