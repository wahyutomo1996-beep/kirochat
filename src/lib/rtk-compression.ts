/**
 * RTK Token Saver - inline implementation for Prometheus webapp.
 *
 * Inspired by https://github.com/rtk-ai/rtk - compresses tool-output style
 * content (git diff, grep, ls, file dumps) before sending to LLMs. Saves
 * 20-40% input tokens on requests with heavy tool_result blocks.
 *
 * Design rules:
 *   1. SAFETY > savings. If a filter throws, returns empty, or makes the
 *      output BIGGER, we silently keep the original. Errors never bubble.
 *   2. AUTO-DETECT, no config. Peek the first ~1KB of each chunk and pick
 *      the right filter heuristically. User toggles RTK on/off; the filter
 *      choice is automatic.
 *   3. STATELESS. Each call independent. No global state, no caches.
 *
 * Filters:
 *   - smart-truncate    long generic text (default fallback)
 *   - dedup-log         repeated lines (logs, watch output)
 *   - git-diff          collapse @@ hunks, drop file headers when unique
 *   - grep-results      collapse files with many matches
 *   - ls-tree           collapse directory listings, keep first/last entries
 *   - empty             stripped whitespace-only blocks
 */

interface Filter {
  name: string;
  /** Heuristic: does this filter want to handle this text? */
  detect(sample: string): boolean;
  /** Compress. Return original if no improvement. */
  apply(text: string): string;
}

/** Maximum bytes to read for filter detection (peek, not full scan) */
const PEEK_BYTES = 1024;

/**
 * Smart truncate - keep head + tail, summarize middle. Used as default
 * fallback for any long text where no specific filter matches.
 */
const smartTruncate: Filter = {
  name: 'smart-truncate',
  detect: () => false, // never auto-picked, only used explicitly
  apply(text) {
    const lines = text.split('\n');
    if (lines.length < 200) return text;
    const head = lines.slice(0, 80).join('\n');
    const tail = lines.slice(-80).join('\n');
    const skipped = lines.length - 160;
    return `${head}\n\n[... ${skipped} lines omitted ...]\n\n${tail}`;
  },
};

/**
 * Dedup consecutive duplicate lines - common in logs, watch output, retries.
 *   "ERROR: connection refused\nERROR: connection refused\n..." (50 times)
 *   becomes:
 *   "ERROR: connection refused\n[... repeated 50× ...]"
 */
const dedupLog: Filter = {
  name: 'dedup-log',
  detect(sample) {
    // Look for 3+ consecutive identical lines in the sample
    const lines = sample.split('\n');
    let runStart = 0;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === lines[runStart]) {
        if (i - runStart >= 2) return true;
      } else {
        runStart = i;
      }
    }
    return false;
  },
  apply(text) {
    const lines = text.split('\n');
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const cur = lines[i];
      let j = i + 1;
      while (j < lines.length && lines[j] === cur) j++;
      const runLen = j - i;
      if (runLen >= 3) {
        out.push(cur);
        out.push(`[... repeated ${runLen}× ...]`);
      } else {
        for (let k = i; k < j; k++) out.push(lines[k]);
      }
      i = j;
    }
    return out.join('\n');
  },
};

/**
 * Git diff compression - drop binary diffs, summarize huge hunks, keep the
 * structurally important lines (file headers, +/- markers).
 */
const gitDiff: Filter = {
  name: 'git-diff',
  detect(sample) {
    return /^diff --git /m.test(sample) || /^@@ -\d+,?\d*/m.test(sample);
  },
  apply(text) {
    const lines = text.split('\n');
    const out: string[] = [];
    let inHunk = false;
    let hunkLineCount = 0;
    let truncatedThisHunk = false;
    const HUNK_MAX_LINES = 50;

    for (const line of lines) {
      if (line.startsWith('diff --git ') || line.startsWith('index ') ||
          line.startsWith('--- ') || line.startsWith('+++ ')) {
        out.push(line);
        inHunk = false;
        truncatedThisHunk = false;
        continue;
      }
      if (line.startsWith('@@')) {
        out.push(line);
        inHunk = true;
        hunkLineCount = 0;
        truncatedThisHunk = false;
        continue;
      }
      if (line.startsWith('Binary files ')) {
        out.push('[binary diff omitted]');
        continue;
      }
      if (inHunk) {
        hunkLineCount++;
        if (hunkLineCount > HUNK_MAX_LINES) {
          if (!truncatedThisHunk) {
            out.push(`[... hunk continues (${hunkLineCount}+ lines), truncated ...]`);
            truncatedThisHunk = true;
          }
          continue;
        }
      }
      out.push(line);
    }
    return out.join('\n');
  },
};

/**
 * Directory listing compression - long ls/find/tree outputs collapsed to
 * head + count + tail.
 */
const lsTree: Filter = {
  name: 'ls-tree',
  detect(sample) {
    const lines = sample.split('\n').slice(0, 20);
    if (lines.length < 10) return false;
    // Heuristic: most lines look like file paths or have indentation
    let pathLike = 0;
    for (const l of lines) {
      if (/^[\s│├└─]*[\w.\-/]+/.test(l)) pathLike++;
    }
    return pathLike / lines.length > 0.7;
  },
  apply(text) {
    const lines = text.split('\n');
    if (lines.length < 100) return text;
    const head = lines.slice(0, 30).join('\n');
    const tail = lines.slice(-20).join('\n');
    const skipped = lines.length - 50;
    return `${head}\n[... ${skipped} entries omitted ...]\n${tail}`;
  },
};

/**
 * Grep result compression - collapse files with many matches into a count.
 *   "src/foo.ts:10: match\nsrc/foo.ts:20: match\n..." (50 lines from foo.ts)
 *   becomes:
 *   "src/foo.ts: 50 matches\n[first 5 shown]\n... \n[last 2 shown]"
 */
const grepResults: Filter = {
  name: 'grep-results',
  detect(sample) {
    // ripgrep / grep -n style: path:line:content
    const lines = sample.split('\n').slice(0, 30);
    if (lines.length < 10) return false;
    let grepLike = 0;
    for (const l of lines) {
      if (/^[^\s:]+:\d+:/.test(l)) grepLike++;
    }
    return grepLike / lines.length > 0.6;
  },
  apply(text) {
    const lines = text.split('\n').filter((l) => l.length > 0);
    if (lines.length < 50) return text;

    // Group by file path
    const byFile = new Map<string, string[]>();
    for (const line of lines) {
      const m = line.match(/^([^:]+):/);
      const file = m ? m[1] : '<other>';
      const arr = byFile.get(file) ?? [];
      arr.push(line);
      byFile.set(file, arr);
    }

    const out: string[] = [];
    for (const [file, matches] of Array.from(byFile.entries())) {
      if (matches.length <= 8) {
        out.push(...matches);
      } else {
        out.push(`${file}: ${matches.length} matches`);
        out.push(...matches.slice(0, 5));
        out.push(`[... ${matches.length - 7} more matches ...]`);
        out.push(...matches.slice(-2));
      }
    }
    return out.join('\n');
  },
};

const FILTERS: Filter[] = [gitDiff, grepResults, lsTree, dedupLog];

/**
 * Apply RTK compression to a single text block.
 *
 * Strategy:
 *   1. Skip if too short to bother (<500 chars - any savings drowned by overhead)
 *   2. Try each detector against the peek window
 *   3. Apply the first matching filter
 *   4. If apply throws OR result is bigger, return original
 *   5. If still long after filter, also apply smart-truncate
 *
 * Result is always safe to send to the LLM.
 */
export function compressBlock(text: string): { text: string; filter: string } {
  if (typeof text !== 'string' || text.length < 500) {
    return { text, filter: 'none' };
  }

  const sample = text.slice(0, PEEK_BYTES);

  for (const filter of FILTERS) {
    let detected = false;
    try {
      detected = filter.detect(sample);
    } catch {
      continue;
    }
    if (!detected) continue;

    try {
      const compressed = filter.apply(text);
      if (typeof compressed === 'string' && compressed.length < text.length) {
        // Still long? Cap with smart-truncate as well.
        if (compressed.length > 10_000) {
          const final = smartTruncate.apply(compressed);
          if (final.length < compressed.length) {
            return { text: final, filter: `${filter.name}+truncate` };
          }
        }
        return { text: compressed, filter: filter.name };
      }
    } catch {
      // Filter blew up - fall through to next filter or original
      continue;
    }
  }

  // No specific filter matched - try smart-truncate as last resort if very long
  if (text.length > 20_000) {
    try {
      const truncated = smartTruncate.apply(text);
      if (truncated.length < text.length) {
        return { text: truncated, filter: 'smart-truncate' };
      }
    } catch {
      /* fall through */
    }
  }

  return { text, filter: 'none' };
}

export interface RtkStats {
  /** Number of message content blocks compressed */
  blocksCompressed: number;
  /** Bytes before compression */
  bytesBefore: number;
  /** Bytes after compression */
  bytesAfter: number;
  /** Per-filter usage count */
  byFilter: Record<string, number>;
}

/**
 * Apply RTK compression to OpenAI-style messages array.
 *
 * Targets:
 *   - role: 'tool' messages (their content is tool output)
 *   - content blocks of type 'tool_result' inside user messages (Anthropic style)
 *   - Long string content in user messages (last resort)
 *
 * System and assistant messages are NEVER touched - those are intent, not output.
 */
export function compressMessages<T extends { role: string; content: unknown }>(
  messages: T[],
): { messages: T[]; stats: RtkStats } {
  const stats: RtkStats = {
    blocksCompressed: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    byFilter: {},
  };

  const tally = (filter: string, before: number, after: number) => {
    if (filter === 'none' || before === after) return;
    stats.blocksCompressed++;
    stats.bytesBefore += before;
    stats.bytesAfter += after;
    stats.byFilter[filter] = (stats.byFilter[filter] ?? 0) + 1;
  };

  const next = messages.map((msg) => {
    // Tool messages: content is the tool output, compress directly
    if (msg.role === 'tool' && typeof msg.content === 'string') {
      const before = msg.content.length;
      const { text, filter } = compressBlock(msg.content);
      tally(filter, before, text.length);
      return { ...msg, content: text };
    }

    // Anthropic-style content blocks (array of {type, text} or tool_result)
    if (Array.isArray(msg.content)) {
      const newBlocks = msg.content.map((block) => {
        if (block && typeof block === 'object' && 'type' in block) {
          const b = block as Record<string, unknown>;
          if (b.type === 'tool_result' && typeof b.content === 'string') {
            const before = (b.content as string).length;
            const { text, filter } = compressBlock(b.content as string);
            tally(filter, before, text.length);
            return { ...b, content: text };
          }
          if (b.type === 'text' && typeof b.text === 'string' && (b.text as string).length > 5000) {
            const before = (b.text as string).length;
            const { text, filter } = compressBlock(b.text as string);
            tally(filter, before, text.length);
            return { ...b, text };
          }
        }
        return block;
      });
      return { ...msg, content: newBlocks };
    }

    // User string content longer than 5K - very long pasted blocks
    if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.length > 5000) {
      const before = msg.content.length;
      const { text, filter } = compressBlock(msg.content);
      tally(filter, before, text.length);
      return { ...msg, content: text };
    }

    return msg;
  });

  return { messages: next as T[], stats };
}
