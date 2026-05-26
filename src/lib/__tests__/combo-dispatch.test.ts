/**
 * Combo dispatch helper tests — slug parsing, fall-through error classification.
 */

import { describe, it, expect } from 'vitest';
import { parseComboRef, isFallThroughError } from '../combo-dispatch';

describe('parseComboRef', () => {
  it('strips combo: prefix', () => {
    expect(parseComboRef('combo:coding-premium')).toBe('coding-premium');
    expect(parseComboRef('combo:trading-realtime')).toBe('trading-realtime');
  });

  it('accepts bare slug pattern with hyphens', () => {
    expect(parseComboRef('coding-fast')).toBe('coding-fast');
    expect(parseComboRef('my-custom-combo-1')).toBe('my-custom-combo-1');
  });

  it('accepts single-word slugs (no hyphen required)', () => {
    // Combo create API allows single-word slugs (^[a-z0-9]+(-[a-z0-9]+)*$),
    // so the chat-side parser must too. Earlier mismatch silently rejected
    // any single-word combo at chat time.
    expect(parseComboRef('coding')).toBe('coding');
    expect(parseComboRef('mystack')).toBe('mystack');
    expect(parseComboRef('combo:coding')).toBe('coding');
  });

  it('rejects invalid input', () => {
    expect(parseComboRef('')).toBeNull();
    expect(parseComboRef('Not-A-Slug')).toBeNull();  // uppercase
    expect(parseComboRef('no-uppercase BUT this')).toBeNull();
    expect(parseComboRef('with_underscore')).toBeNull();
    expect(parseComboRef('combo:')).toBeNull();  // empty after prefix is invalid
    expect(parseComboRef('-leading-hyphen')).toBeNull();
    expect(parseComboRef('trailing-hyphen-')).toBeNull();
  });
});

describe('isFallThroughError', () => {
  it('classifies rate limit as fall-through', () => {
    expect(isFallThroughError(new Error('429 Too Many Requests'))).toBe(true);
    expect(isFallThroughError(new Error('rate limit exceeded'))).toBe(true);
    expect(isFallThroughError(new Error('quota exceeded for today'))).toBe(true);
  });

  it('classifies auth/quota errors as fall-through', () => {
    expect(isFallThroughError(new Error('Kiro 403: forbidden'))).toBe(true);
    expect(isFallThroughError(new Error('No active Kiro accounts'))).toBe(true);
    expect(isFallThroughError(new Error('All Kiro accounts failed'))).toBe(true);
  });

  it('classifies transient errors as fall-through', () => {
    expect(isFallThroughError(new Error('fetch failed'))).toBe(true);
    expect(isFallThroughError(new Error('connection timeout after 30s'))).toBe(true);
    expect(isFallThroughError(new Error('ECONNRESET'))).toBe(true);
  });

  it('classifies upstream 5xx as fall-through', () => {
    expect(isFallThroughError(new Error('502 Bad Gateway'))).toBe(true);
    expect(isFallThroughError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isFallThroughError(new Error('500 Internal Server Error'))).toBe(true);
  });

  it('does NOT classify hard errors as fall-through', () => {
    // Model not found - retrying with another step won't help if user picked
    // a totally invalid model name in the combo definition
    expect(isFallThroughError(new Error('Model gpt-99 not found'))).toBe(false);
    // Malformed payload - request body issue, not provider issue
    expect(isFallThroughError(new Error('Invalid messages array'))).toBe(false);
    // Auth (401) on user side - their api key is wrong, all steps would fail
    expect(isFallThroughError(new Error('Invalid API key'))).toBe(false);
    // Successful response - shouldn't be checked but verify no false positive
    expect(isFallThroughError(null)).toBe(false);
    expect(isFallThroughError(undefined)).toBe(false);
  });
});
