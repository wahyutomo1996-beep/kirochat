/**
 * Body size limit + CORS helper tests.
 */

import { describe, it, expect } from 'vitest';
import { readJsonBody, PayloadTooLargeError, corsOrigin, corsHeaders } from '../http';

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

describe('readJsonBody', () => {
  it('parses valid JSON within limit', async () => {
    const req = makeRequest(JSON.stringify({ hello: 'world' }));
    const body = await readJsonBody<{ hello: string }>(req, 1024);
    expect(body.hello).toBe('world');
  });

  it('throws PayloadTooLargeError when content-length exceeds limit', async () => {
    const big = JSON.stringify({ data: 'x'.repeat(2000) });
    const req = makeRequest(big);
    await expect(readJsonBody(req, 1000)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('throws PayloadTooLargeError when streamed body exceeds limit even without content-length', async () => {
    const big = JSON.stringify({ data: 'x'.repeat(2000) });
    // Construct without explicit content-length - browser/node will set it,
    // but the test still exercises the streaming guard
    const req = makeRequest(big);
    await expect(readJsonBody(req, 500)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('preserves error type for instanceof checks', async () => {
    const req = makeRequest(JSON.stringify({ data: 'x'.repeat(2000) }));
    try {
      await readJsonBody(req, 100);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PayloadTooLargeError);
      expect((e as PayloadTooLargeError).maxBytes).toBe(100);
    }
  });
});

describe('corsOrigin', () => {
  const originalEnv = process.env.GATEWAY_CORS_ORIGINS;
  const restoreEnv = () => {
    process.env.GATEWAY_CORS_ORIGINS = originalEnv;
  };

  it('returns null when env is unset', () => {
    delete process.env.GATEWAY_CORS_ORIGINS;
    const req = new Request('http://x', { headers: { origin: 'https://attacker.example' } });
    expect(corsOrigin(req)).toBeNull();
    restoreEnv();
  });

  it('returns wildcard when env is *', () => {
    process.env.GATEWAY_CORS_ORIGINS = '*';
    const req = new Request('http://x', { headers: { origin: 'https://anything.example' } });
    expect(corsOrigin(req)).toBe('*');
    restoreEnv();
  });

  it('returns null when origin not in whitelist', () => {
    process.env.GATEWAY_CORS_ORIGINS = 'https://app1.com,https://app2.com';
    const req = new Request('http://x', { headers: { origin: 'https://attacker.com' } });
    expect(corsOrigin(req)).toBeNull();
    restoreEnv();
  });

  it('echoes matching origin from whitelist', () => {
    process.env.GATEWAY_CORS_ORIGINS = 'https://app1.com,https://app2.com';
    const req = new Request('http://x', { headers: { origin: 'https://app2.com' } });
    expect(corsOrigin(req)).toBe('https://app2.com');
    restoreEnv();
  });

  it('returns null when no Origin header on request', () => {
    process.env.GATEWAY_CORS_ORIGINS = 'https://app1.com';
    const req = new Request('http://x');
    expect(corsOrigin(req)).toBeNull();
    restoreEnv();
  });
});

describe('corsHeaders', () => {
  it('returns empty object when no origin allowed', () => {
    delete process.env.GATEWAY_CORS_ORIGINS;
    const req = new Request('http://x', { headers: { origin: 'https://x.com' } });
    expect(corsHeaders(req)).toEqual({});
  });

  it('returns full CORS header set when origin matches', () => {
    process.env.GATEWAY_CORS_ORIGINS = 'https://allowed.com';
    const req = new Request('http://x', { headers: { origin: 'https://allowed.com' } });
    const h = corsHeaders(req);
    expect(h['Access-Control-Allow-Origin']).toBe('https://allowed.com');
    expect(h['Vary']).toBe('Origin');
    expect(h['Access-Control-Allow-Methods']).toContain('POST');
    delete process.env.GATEWAY_CORS_ORIGINS;
  });
});
