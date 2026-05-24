/**
 * Rate limiter tests — window expiry, per-key isolation, bucket counting.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('rate limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests under the limit', async () => {
    const { rateLimit } = await import('../ratelimit');
    for (let i = 0; i < 5; i++) {
      expect(rateLimit('user-a', 5, 60_000).ok).toBe(true);
    }
  });

  it('rejects when limit exceeded', async () => {
    const { rateLimit } = await import('../ratelimit');
    for (let i = 0; i < 3; i++) rateLimit('user-b', 3, 60_000);
    const result = rateLimit('user-b', 3, 60_000);
    expect(result.ok).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetIn).toBeGreaterThan(0);
  });

  it('resets after window expires', async () => {
    const { rateLimit } = await import('../ratelimit');
    for (let i = 0; i < 3; i++) rateLimit('user-c', 3, 60_000);
    expect(rateLimit('user-c', 3, 60_000).ok).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(61_000);

    expect(rateLimit('user-c', 3, 60_000).ok).toBe(true);
  });

  it('isolates buckets across keys', async () => {
    const { rateLimit } = await import('../ratelimit');
    for (let i = 0; i < 5; i++) rateLimit('user-d', 5, 60_000);
    expect(rateLimit('user-d', 5, 60_000).ok).toBe(false);
    // Different key still allowed
    expect(rateLimit('user-e', 5, 60_000).ok).toBe(true);
  });

  it('decrements remaining count correctly', async () => {
    const { rateLimit } = await import('../ratelimit');
    expect(rateLimit('user-f', 3, 60_000).remaining).toBe(2);
    expect(rateLimit('user-f', 3, 60_000).remaining).toBe(1);
    expect(rateLimit('user-f', 3, 60_000).remaining).toBe(0);
  });

  it('isolates buckets by limit/window combo (different bucket key)', async () => {
    const { rateLimit } = await import('../ratelimit');
    // Same identifier, different limit/window -> different bucket
    rateLimit('user-g', 3, 60_000);
    rateLimit('user-g', 3, 60_000);
    rateLimit('user-g', 3, 60_000);
    expect(rateLimit('user-g', 3, 60_000).ok).toBe(false);
    // Same identifier, different config => fresh bucket
    expect(rateLimit('user-g', 10, 60_000).ok).toBe(true);
  });
});
