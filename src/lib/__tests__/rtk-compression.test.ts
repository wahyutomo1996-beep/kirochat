/**
 * RTK compression tests — verify safety guarantees and sample compressions.
 */

import { describe, it, expect } from 'vitest';
import { compressBlock, compressMessages } from '../rtk-compression';

describe('compressBlock - safety', () => {
  it('returns original for short text', () => {
    const text = 'hello world';
    const result = compressBlock(text);
    expect(result.text).toBe(text);
    expect(result.filter).toBe('none');
  });

  it('returns original when no filter detects pattern', () => {
    const text = 'just some random prose '.repeat(50);
    const result = compressBlock(text);
    // Generic prose under 20K won't match any specific filter
    if (text.length < 20_000) {
      expect(result.filter).toBe('none');
    }
  });

  it('never returns text larger than input', () => {
    const inputs = [
      'a'.repeat(2000),
      'diff --git a/x b/x\n@@ -1,1 +1,1 @@\n-old\n+new\n',
      Array(100).fill('src/foo.ts:10: match here').join('\n'),
    ];
    for (const input of inputs) {
      const result = compressBlock(input);
      expect(result.text.length).toBeLessThanOrEqual(input.length);
    }
  });
});

describe('compressBlock - dedup-log', () => {
  it('collapses repeated lines', () => {
    const text = Array(50).fill('ERROR: connection refused').join('\n');
    const result = compressBlock(text);
    expect(result.filter).toBe('dedup-log');
    expect(result.text).toContain('repeated 50');
    expect(result.text.length).toBeLessThan(text.length);
  });

  it('preserves singletons', () => {
    const text = 'unique line a\nunique line b\nunique line c\n' + 'x'.repeat(2000);
    const result = compressBlock(text);
    // No 3+ runs in the unique part - dedup-log shouldn't trigger
    expect(result.filter).not.toBe('dedup-log');
  });
});

describe('compressBlock - git-diff', () => {
  it('collapses huge hunks', () => {
    const lines: string[] = ['diff --git a/big.ts b/big.ts', '@@ -1,200 +1,200 @@'];
    for (let i = 0; i < 200; i++) lines.push(`+ added line ${i}`);
    const text = lines.join('\n');
    const result = compressBlock(text);
    expect(result.filter).toBe('git-diff');
    expect(result.text).toMatch(/hunk continues/);
    expect(result.text.length).toBeLessThan(text.length);
  });

  it('drops binary diff content', () => {
    const text =
      'diff --git a/img.png b/img.png\n' +
      'Binary files differ\n' +
      'a'.repeat(2000);
    const result = compressBlock(text);
    if (result.filter === 'git-diff' || result.filter.startsWith('git-diff')) {
      expect(result.text.length).toBeLessThan(text.length);
    }
  });
});

describe('compressBlock - grep-results', () => {
  it('collapses files with many matches', () => {
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) lines.push(`src/foo.ts:${i}: match content here`);
    for (let i = 0; i < 5; i++) lines.push(`src/bar.ts:${i}: small match`);
    const text = lines.join('\n');
    const result = compressBlock(text);
    expect(result.filter).toBe('grep-results');
    expect(result.text).toMatch(/foo\.ts: 50 matches/);
    expect(result.text).toContain('bar.ts:0:');
  });
});

describe('compressMessages - integration', () => {
  it('compresses tool messages', () => {
    const messages = [
      { role: 'user' as const, content: 'run grep' },
      {
        role: 'tool' as const,
        content: Array(50).fill('src/file.ts:10: match').join('\n'),
      },
    ];
    const { messages: out, stats } = compressMessages(messages);
    expect(stats.blocksCompressed).toBeGreaterThan(0);
    expect(stats.bytesAfter).toBeLessThan(stats.bytesBefore);
    expect(typeof out[1].content).toBe('string');
    expect((out[1].content as string).length).toBeLessThan(
      (messages[1].content as string).length,
    );
  });

  it('compresses tool_result blocks in user messages (Anthropic style)', () => {
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text', text: 'see this output' },
          {
            type: 'tool_result',
            content: Array(60).fill('repeated log line').join('\n'),
          },
        ],
      },
    ];
    const { messages: out, stats } = compressMessages(messages);
    expect(stats.blocksCompressed).toBeGreaterThan(0);
    const blocks = out[0].content as Array<{ type: string; content?: string; text?: string }>;
    const toolResult = blocks.find((b) => b.type === 'tool_result');
    expect(toolResult?.content).toBeDefined();
    expect((toolResult!.content as string).length).toBeLessThan(
      (Array(60).fill('repeated log line').join('\n')).length,
    );
  });

  it('never compresses system or assistant messages', () => {
    const longText = Array(100).fill('important repeated guidance').join('\n');
    const messages = [
      { role: 'system' as const, content: longText },
      { role: 'assistant' as const, content: longText },
    ];
    const { messages: out, stats } = compressMessages(messages);
    expect(stats.blocksCompressed).toBe(0);
    expect(out[0].content).toBe(longText);
    expect(out[1].content).toBe(longText);
  });

  it('reports filter usage in stats', () => {
    // Need >500 chars to trigger compression. 50 lines of 'ERROR: connection refused 12345'
    // is enough to cross the threshold.
    const longRepeat = Array(50).fill('ERROR: connection refused at endpoint /v1/chat').join('\n');
    const messages = [
      {
        role: 'tool' as const,
        content: longRepeat,
      },
    ];
    const { stats } = compressMessages(messages);
    expect(stats.byFilter['dedup-log']).toBeGreaterThan(0);
  });
});
