import { describe, it, expect } from 'vitest';
import { parseAllowedUserIds, generateWebhookSecret } from '../telegram';

describe('parseAllowedUserIds', () => {
  it('parses comma-separated IDs', () => {
    const ids = parseAllowedUserIds('123456789, 987654321');
    expect(ids.has('123456789')).toBe(true);
    expect(ids.has('987654321')).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('parses whitespace-separated IDs', () => {
    const ids = parseAllowedUserIds('111 222\n333');
    expect(ids.size).toBe(3);
  });

  it('rejects non-numeric junk', () => {
    const ids = parseAllowedUserIds('123, abc, 456, !@#');
    expect(ids.has('123')).toBe(true);
    expect(ids.has('456')).toBe(true);
    expect(ids.has('abc')).toBe(false);
    expect(ids.size).toBe(2);
  });

  it('handles empty input safely', () => {
    expect(parseAllowedUserIds('').size).toBe(0);
    expect(parseAllowedUserIds('   ').size).toBe(0);
  });

  it('deduplicates repeated IDs', () => {
    const ids = parseAllowedUserIds('123, 123, 123');
    expect(ids.size).toBe(1);
  });
});

describe('generateWebhookSecret', () => {
  it('returns 64-char hex string', () => {
    const s = generateWebhookSecret();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns different value each call', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).not.toBe(b);
  });
});
