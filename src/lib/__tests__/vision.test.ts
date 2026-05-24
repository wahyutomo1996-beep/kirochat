/**
 * Vision routing decision tests — which (provider, model) gets a vision request.
 */

import { describe, it, expect } from 'vitest';
import { isVisionCapable, isKiroBacked, pickVisionFallback, type ProviderLike } from '../vision';

describe('isVisionCapable', () => {
  it('returns true for known vision models on regular providers', () => {
    const p: ProviderLike = { id: '1', name: 'OR', type: 'api_key', baseUrl: 'https://openrouter.ai/api/v1' };
    expect(isVisionCapable(p, 'gpt-4o')).toBe(true);
    expect(isVisionCapable(p, 'openai/gpt-4o')).toBe(true);
    expect(isVisionCapable(p, 'claude-3-5-sonnet')).toBe(true);
    expect(isVisionCapable(p, 'gemini-1.5-pro')).toBe(true);
    expect(isVisionCapable(p, 'pixtral-12b')).toBe(true);
  });

  it('returns false for non-vision models', () => {
    const p: ProviderLike = { id: '1', name: 'OR', type: 'api_key', baseUrl: 'https://openrouter.ai/api/v1' };
    expect(isVisionCapable(p, 'gpt-3.5-turbo')).toBe(false);
    expect(isVisionCapable(p, 'mistral-7b')).toBe(false);
    expect(isVisionCapable(p, undefined)).toBe(false);
    expect(isVisionCapable(p, '')).toBe(false);
  });

  it('returns false for kiro-backed providers regardless of model name', () => {
    const kiroProvider: ProviderLike = { id: '1', name: 'Kiro', type: 'kiro_refresh_token', baseUrl: '' };
    expect(isVisionCapable(kiroProvider, 'gpt-4o')).toBe(false);

    const kiroProxy: ProviderLike = {
      id: '2',
      name: 'WIR',
      type: 'api_key',
      baseUrl: 'http://137.184.195.229:3000/v1',
    };
    expect(isVisionCapable(kiroProxy, 'claude-3-5-sonnet')).toBe(false);
  });
});

describe('isKiroBacked', () => {
  it('returns true for the builtin Prometheus pool', () => {
    expect(isKiroBacked(null, true)).toBe(true);
  });

  it('returns true for kiro_refresh_token providers', () => {
    expect(
      isKiroBacked({ id: '1', name: 'Kiro', type: 'kiro_refresh_token', baseUrl: '' }),
    ).toBe(true);
  });

  it('returns true for kiro proxy URLs', () => {
    expect(
      isKiroBacked({ id: '1', name: 'Proxy', type: 'api_key', baseUrl: 'https://x.amazonaws.com/api' }),
    ).toBe(true);
  });

  it('returns false for vanilla OpenAI-compatible providers', () => {
    expect(
      isKiroBacked({ id: '1', name: 'OR', type: 'api_key', baseUrl: 'https://openrouter.ai/api/v1' }),
    ).toBe(false);
  });
});

describe('pickVisionFallback', () => {
  it('picks the first vision-capable provider', () => {
    const providers: ProviderLike[] = [
      {
        id: '1',
        name: 'OpenRouter',
        type: 'api_key',
        baseUrl: 'https://openrouter.ai/api/v1',
        models: JSON.stringify(['openai/gpt-4o', 'mistral-7b']),
        isActive: true,
      },
    ];
    const result = pickVisionFallback(providers);
    expect(result?.provider.name).toBe('OpenRouter');
    expect(result?.model).toBe('openai/gpt-4o');
  });

  it('returns null when no provider has a vision model', () => {
    const providers: ProviderLike[] = [
      {
        id: '1',
        name: 'OR',
        type: 'api_key',
        baseUrl: 'https://openrouter.ai/api/v1',
        models: JSON.stringify(['mistral-7b', 'llama-3-8b']),
        isActive: true,
      },
    ];
    expect(pickVisionFallback(providers)).toBeNull();
  });

  it('skips inactive and kiro-backed providers', () => {
    const providers: ProviderLike[] = [
      {
        id: '1',
        name: 'inactive',
        type: 'api_key',
        baseUrl: 'https://openrouter.ai/api/v1',
        models: JSON.stringify(['gpt-4o']),
        isActive: false,
      },
      {
        id: '2',
        name: 'kiro',
        type: 'kiro_refresh_token',
        baseUrl: '',
        models: JSON.stringify(['gpt-4o']),
        isActive: true,
      },
      {
        id: '3',
        name: 'good',
        type: 'api_key',
        baseUrl: 'https://api.openai.com/v1',
        models: JSON.stringify(['gpt-4o-mini']),
        isActive: true,
      },
    ];
    const result = pickVisionFallback(providers);
    expect(result?.provider.id).toBe('3');
  });

  it('handles malformed JSON in models field gracefully', () => {
    const providers: ProviderLike[] = [
      {
        id: '1',
        name: 'broken',
        type: 'api_key',
        baseUrl: 'https://openrouter.ai/api/v1',
        models: '{not-valid-json',
        isActive: true,
      },
    ];
    expect(pickVisionFallback(providers)).toBeNull();
  });
});
