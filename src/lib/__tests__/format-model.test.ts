import { describe, it, expect } from 'vitest';
import { formatModelDisplay } from '../format-model';

describe('formatModelDisplay', () => {
  it('strips kiro/ provider prefix', () => {
    expect(formatModelDisplay('kiro/claude-opus-4.7')).toBe('Claude Opus 4.7');
  });

  it('strips other provider prefixes', () => {
    expect(formatModelDisplay('openai/gpt-4o')).toBe('GPT 4o');
    expect(formatModelDisplay('anthropic/claude-sonnet-4.6')).toBe('Claude Sonnet 4.6');
  });

  it('detects -thinking suffix and surfaces as (Thinking)', () => {
    expect(formatModelDisplay('kiro/claude-opus-4.7-thinking')).toBe('Claude Opus 4.7 (Thinking)');
    expect(formatModelDisplay('kiro/deepseek-3.2-thinking')).toBe('DeepSeek 3.2 (Thinking)');
  });

  it('handles brand-name acronyms with hand-tuned casing', () => {
    expect(formatModelDisplay('kiro/deepseek-3.2')).toBe('DeepSeek 3.2');
    expect(formatModelDisplay('kiro/qwen3-coder-next')).toBe('Qwen3 Coder Next');
    expect(formatModelDisplay('kiro/minimax-m2.5')).toBe('MiniMax M2.5');
    expect(formatModelDisplay('kiro/glm-5')).toBe('GLM 5');
    expect(formatModelDisplay('openai/gpt-5')).toBe('GPT 5');
  });

  it('handles ids with no prefix', () => {
    expect(formatModelDisplay('claude-haiku-4.5')).toBe('Claude Haiku 4.5');
  });

  it('returns empty string on empty / null / undefined input', () => {
    expect(formatModelDisplay('')).toBe('');
    expect(formatModelDisplay(null)).toBe('');
    expect(formatModelDisplay(undefined)).toBe('');
  });

  it('preserves version numbers as-is', () => {
    expect(formatModelDisplay('kiro/claude-opus-4.7')).toBe('Claude Opus 4.7');
    expect(formatModelDisplay('kiro/kiro-auto')).toBe('Kiro Auto');
  });
});
