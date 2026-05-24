/**
 * Encryption round-trip + tamper detection tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(() => {
  // Use a deterministic-but-non-prod key for tests
  process.env.NODE_ENV = 'test';
  process.env.ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
});

describe('encryption', () => {
  it('round-trips a simple string', async () => {
    const { encrypt, decrypt } = await import('../encryption');
    const original = 'hello, world';
    const cipher = encrypt(original);
    expect(cipher).not.toBe(original);
    expect(cipher.split(':')).toHaveLength(3); // iv:authTag:encrypted
    expect(decrypt(cipher)).toBe(original);
  });

  it('produces different ciphertext for the same input (random IV)', async () => {
    const { encrypt } = await import('../encryption');
    const a = encrypt('same input');
    const b = encrypt('same input');
    expect(a).not.toBe(b);
  });

  it('handles unicode and long strings', async () => {
    const { encrypt, decrypt } = await import('../encryption');
    const s = 'unicode 🔐 test ' + 'x'.repeat(10_000);
    expect(decrypt(encrypt(s))).toBe(s);
  });

  it('throws on tampered ciphertext (auth tag check)', async () => {
    const { encrypt, decrypt } = await import('../encryption');
    const cipher = encrypt('sensitive data');
    // Flip a byte in the encrypted portion
    const parts = cipher.split(':');
    const tail = parts[2];
    const flipped = parts[0] + ':' + parts[1] + ':' + tail.slice(0, -2) + (tail.endsWith('00') ? '01' : '00');
    expect(() => decrypt(flipped)).toThrow();
  });

  it('throws on malformed ciphertext format', async () => {
    const { decrypt } = await import('../encryption');
    expect(() => decrypt('not-a-valid-ciphertext')).toThrow(/Invalid encrypted format/);
    expect(() => decrypt('only:two')).toThrow(/Invalid encrypted format/);
  });
});

describe('encryption key validation', () => {
  it('refuses to start in production without ENCRYPTION_KEY', async () => {
    // Dynamic import after mutating env (and clearing module cache via vi.resetModules)
    process.env.NODE_ENV = 'production';
    delete process.env.ENCRYPTION_KEY;
    const { encrypt } = await import('../encryption?key-test' + Date.now());
    expect(() => encrypt('test')).toThrow(/ENCRYPTION_KEY/);
  });
});
