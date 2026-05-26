'use client';

/**
 * CodingPanel - side panel for the Coding workspace.
 *
 * Auto-extracts code blocks from chat messages and presents them as
 * navigable tabs in a separate panel. The dev sees the conversation on
 * the left and the latest code artifact prominently on the right —
 * mirroring the IDE workflow they're used to.
 *
 * Features:
 *   - Tabs: every fenced ```code``` block becomes a tab. Newest first.
 *   - Language label badge on each tab (auto-detected from fence info)
 *   - Syntax highlighting via highlight.js (already in deps)
 *   - Copy button per block + copy-all
 *   - Empty state: friendly hint to send the AI a coding question
 *   - Terminal-like bottom area: reserved for future "run output"
 *
 * Why this design:
 *   - Most chat UIs make you scroll up to find old code. Pinning code on
 *     a side panel lets the dev keep referring to it while continuing.
 *   - The newest block auto-selects, so AI's latest answer is always
 *     visible without manual selection.
 *   - Tab list scrolls horizontally so long sessions still work.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

interface CodeBlock {
  /** Unique id within the panel - msg id + block index */
  id: string;
  /** Language hint from the markdown fence (e.g. "ts", "python", or "" if absent) */
  language: string;
  /** The code body (between the fences, without the fence markers) */
  code: string;
  /** Reference to which message this block came from */
  messageId: string;
  /** Position in chronological order — used for "1 of N" indicator */
  index: number;
}

interface Props {
  messages: ChatMessage[];
}

/**
 * Parse fenced code blocks out of markdown content.
 * Handles: ```lang\ncode\n```  and  ```\ncode\n```
 *
 * Returns blocks in the order they appear in the source. We use a regex
 * with the dotall flag (`s`) so multi-line bodies are captured cleanly.
 */
function extractCodeBlocks(messages: ChatMessage[]): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  // Use a global regex - exec loop captures all matches per message
  const fenceRe = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue; // only AI's code is "artifact"
    let match: RegExpExecArray | null;
    fenceRe.lastIndex = 0;
    let blockIndex = 0;
    while ((match = fenceRe.exec(msg.content)) !== null) {
      const language = (match[1] || '').toLowerCase().trim();
      const code = match[2];
      if (code.trim().length === 0) continue;
      blocks.push({
        id: `${msg.id}-${blockIndex}`,
        language,
        code,
        messageId: msg.id,
        index: blocks.length,
      });
      blockIndex++;
    }
  }

  return blocks;
}

/**
 * Best-effort language label for a fence info string.
 * "ts" -> "TypeScript", "py" -> "Python", "" -> "Plain"
 */
function languageLabel(lang: string): string {
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript (TSX)',
    js: 'JavaScript',
    jsx: 'JavaScript (JSX)',
    py: 'Python',
    python: 'Python',
    rb: 'Ruby',
    go: 'Go',
    rs: 'Rust',
    java: 'Java',
    kt: 'Kotlin',
    cpp: 'C++',
    c: 'C',
    cs: 'C#',
    php: 'PHP',
    sh: 'Shell',
    bash: 'Bash',
    zsh: 'Zsh',
    sql: 'SQL',
    html: 'HTML',
    css: 'CSS',
    json: 'JSON',
    yaml: 'YAML',
    yml: 'YAML',
    md: 'Markdown',
    diff: 'Diff',
    dockerfile: 'Dockerfile',
    prisma: 'Prisma',
  };
  if (!lang) return 'Plain text';
  return map[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1);
}

export function CodingPanel({ messages }: Props) {
  const blocks = useMemo(() => extractCodeBlocks(messages), [messages]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  // Auto-select the newest block whenever a new one arrives. If user
  // explicitly clicks an older tab, we keep their selection sticky until
  // the next new block lands.
  const newestBlockId = blocks.length > 0 ? blocks[blocks.length - 1].id : null;
  useEffect(() => {
    if (!newestBlockId) {
      setActiveId(null);
      return;
    }
    // Only auto-jump if user is on the previous newest (or nothing)
    setActiveId((cur) => {
      if (!cur) return newestBlockId;
      // If the current block is still in the list, keep it
      const stillExists = blocks.some((b) => b.id === cur);
      if (!stillExists) return newestBlockId;
      // Otherwise we trust the user's explicit selection
      return cur;
    });
  }, [newestBlockId, blocks]);

  const activeBlock = blocks.find((b) => b.id === activeId) ?? blocks[blocks.length - 1] ?? null;

  // Re-run highlight.js whenever active block changes. We render a fresh
  // <code> element each time so highlight.js can attach without conflict.
  useEffect(() => {
    if (codeRef.current && activeBlock) {
      // Reset any previous highlighting attribute so highlight.js doesn't bail
      delete (codeRef.current.dataset as Record<string, string>).highlighted;
      try {
        hljs.highlightElement(codeRef.current);
      } catch {
        /* ignore highlight failures - text still renders */
      }
    }
  }, [activeBlock?.id, activeBlock?.code]);

  const handleCopy = async () => {
    if (!activeBlock) return;
    try {
      await navigator.clipboard.writeText(activeBlock.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API can fail in iframes / insecure contexts */
    }
  };

  // ─── Empty state ────────────────────────────────────────────────────────
  if (blocks.length === 0) {
    return (
      <div className="flex flex-col h-full bg-surface-1 border-l border-hairline">
        <div className="px-4 py-3 border-b border-hairline flex items-center gap-2 shrink-0">
          <svg className="w-4 h-4 text-ink-subtle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <p className="typo-eyebrow">Code Artifacts</p>
        </div>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-xs">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.05))',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                boxShadow: '0 8px 32px -8px rgba(16, 185, 129, 0.4)',
              }}
            >
              <svg className="w-7 h-7" fill="none" stroke="rgb(52, 211, 153)" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </div>
            <p className="text-white text-sm font-medium">No code yet</p>
            <p className="text-txt-muted text-xs mt-1.5 leading-relaxed">
              Ask the AI to write or refactor code. Code blocks from its responses will appear here as tabs.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-1 border-l border-hairline min-w-0">
      {/* Header with tab strip */}
      <div className="border-b border-hairline shrink-0">
        <div className="px-4 py-2 flex items-center gap-2">
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <p className="text-xs font-semibold text-white uppercase tracking-wider">Code Artifacts</p>
          <span className="text-[10px] text-txt-faint tabular-nums ml-auto">
            {blocks.length} {blocks.length === 1 ? 'block' : 'blocks'}
          </span>
        </div>

        {/* Horizontal scroll tab strip - shows all blocks */}
        <div className="flex gap-1 px-2 pb-2 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
          {blocks.map((block) => {
            const isActive = activeBlock?.id === block.id;
            return (
              <button
                key={block.id}
                type="button"
                onClick={() => setActiveId(block.id)}
                className={`shrink-0 px-2.5 py-1 rounded text-[11px] font-mono transition-all border ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40'
                    : 'bg-surface-2/60 text-txt-secondary border-edge/40 hover:bg-surface-2 hover:text-white hover:border-edge'
                }`}
                title={`Block ${block.index + 1} · ${languageLabel(block.language)}`}
              >
                <span className="opacity-60 mr-1">#{block.index + 1}</span>
                {languageLabel(block.language)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active code body */}
      {activeBlock && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-4 py-2 border-b border-edge/40 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-[11px] text-txt-muted">
              <span className="font-mono text-emerald-300/80">
                {languageLabel(activeBlock.language)}
              </span>
              <span className="text-txt-faint">·</span>
              <span className="tabular-nums">
                {activeBlock.code.split('\n').length} lines
              </span>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="text-[11px] px-2 py-0.5 rounded text-txt-muted hover:text-white hover:bg-surface-2 transition-colors flex items-center gap-1.5 btn-squash"
            >
              {copied ? (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          </div>

          {/* Code body — scrollable. Pre-wrap retains formatting; horizontal
              scroll on long lines. */}
          <div className="flex-1 overflow-auto bg-[#0d1117]">
            <pre className="p-4 text-[12px] leading-[1.6]">
              <code
                ref={codeRef}
                className={activeBlock.language ? `language-${activeBlock.language}` : ''}
                style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
              >
                {activeBlock.code}
              </code>
            </pre>
          </div>

          {/* Terminal placeholder bottom — reserved for future "run output" */}
          <div className="border-t border-edge/40 px-4 py-2 bg-surface-0/40 shrink-0">
            <div className="flex items-center gap-2 text-[10px] text-txt-faint uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60"></span>
              Output
              <span className="text-txt-faint normal-case tracking-normal ml-auto">
                Coming soon — execute snippets inline
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
