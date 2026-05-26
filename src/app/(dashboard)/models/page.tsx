'use client';

/**
 * Models catalog page.
 *
 * Lists every AI model available through Prometheus with:
 *   - Model ID (copy-to-clipboard for use in OpenCode/Cursor/etc)
 *   - Display name + thinking variant indicator
 *   - Tier badge (performance/balanced/economy)
 *   - Context window + max tokens
 *   - Test connection button (sends "ready" ping, shows latency + reply)
 *   - Search + tier filter
 *
 * Use case: user wants to grab a model id like `kiro/claude-opus-4.7-thinking`
 * to paste into their AI client config, and verify the connection works
 * before committing.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppDispatch } from '@/lib/store/hooks';
import { showToast } from '@/lib/store/slices/uiSlice';
import {
  useListModelsQuery,
  useTestModelMutation,
  type ModelEntry,
  type TestModelResult,
} from '@/lib/store/api/modelsApi';

type TierFilter = 'all' | 'performance' | 'balanced' | 'economy';

const TIER_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  performance: {
    bg: 'rgba(99, 102, 241, 0.15)',
    border: 'rgba(99, 102, 241, 0.4)',
    text: 'rgb(165, 180, 252)',
    label: 'Performance',
  },
  balanced: {
    bg: 'rgba(52, 211, 153, 0.15)',
    border: 'rgba(52, 211, 153, 0.4)',
    text: 'rgb(110, 231, 183)',
    label: 'Balanced',
  },
  economy: {
    bg: 'rgba(251, 191, 36, 0.15)',
    border: 'rgba(251, 191, 36, 0.4)',
    text: 'rgb(252, 211, 77)',
    label: 'Economy',
  },
};

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default function ModelsPage() {
  const dispatch = useAppDispatch();
  const { data, isLoading } = useListModelsQuery();
  const [testModel, testState] = useTestModelMutation();

  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [hideThinking, setHideThinking] = useState(false);

  /** Map of modelId -> last test result, kept in component state */
  const [results, setResults] = useState<Record<string, TestModelResult>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const models = useMemo(() => data?.models ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter((m) => {
      if (tierFilter !== 'all' && m.tier !== tierFilter) return false;
      if (hideThinking && m.thinking) return false;
      if (q && !m.id.toLowerCase().includes(q) && !m.displayName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [models, search, tierFilter, hideThinking]);

  // Group by provider for clean visual sections
  const grouped = useMemo(() => {
    const map = new Map<string, ModelEntry[]>();
    for (const m of filtered) {
      const key = m.provider;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      dispatch(showToast({ type: 'success', message: `Copied: ${text}` }));
    } catch {
      dispatch(showToast({ type: 'error', message: 'Copy failed — clipboard not available' }));
    }
  };

  const handleTest = async (modelId: string) => {
    setTesting(modelId);
    try {
      const result = await testModel(modelId).unwrap();
      setResults((prev) => ({ ...prev, [modelId]: result }));
      if (result.ok) {
        dispatch(showToast({ type: 'success', message: `${modelId} — ${result.latencyMs}ms` }));
      } else {
        dispatch(showToast({
          type: 'error',
          message: `${modelId} failed: ${result.error?.slice(0, 80) ?? 'unknown'}`,
          duration: 6000,
        }));
      }
    } catch {
      dispatch(showToast({ type: 'error', message: 'Test request failed' }));
    } finally {
      setTesting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-txt-muted">
        Loading models...
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-6 fold:px-6 fold:py-8">
      <div className="max-w-5xl mx-auto">
        {/* Hero */}
        <div className="mb-6 fold:mb-8">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-emerald-400">
                  {models.length} models available
                </span>
              </div>
              <h1 className="text-2xl fold:text-3xl font-bold text-white tracking-tight mb-1">
                AI Models
              </h1>
              <p className="text-sm text-txt-muted leading-relaxed max-w-2xl">
                Daftar model yang bisa lo pakai. Klik <kbd className="px-1 bg-surface-2/60 border border-edge/40 rounded text-[10px]">Copy ID</kbd> untuk
                ambil model identifier — paste ke OpenCode, Cursor, atau client OpenAI-compatible
                lainnya. Tombol <kbd className="px-1 bg-surface-2/60 border border-edge/40 rounded text-[10px]">Test</kbd> mengirim
                ping ke model untuk verify koneksi + cek latency.
              </p>
            </div>
            <Link
              href="/chat"
              className="text-sm text-txt-secondary hover:text-white px-3 py-1.5 rounded-lg border border-edge/60 hover:border-edge-hover transition-all"
            >
              ← Back to chat
            </Link>
          </div>

          {/* Quick connection info */}
          <div className="mt-5 bg-surface-1/40 backdrop-blur-sm border border-edge/60 rounded-xl p-3">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-txt-muted mb-2">
              Connection details
            </p>
            <div className="grid fold:grid-cols-2 gap-2 text-xs">
              <CopyRow
                label="Base URL"
                value={typeof window !== 'undefined' ? `${window.location.origin}/v1` : '/v1'}
                onCopy={handleCopy}
              />
              <CopyRow
                label="API Key"
                value="pmt-... (Settings → API Key)"
                hint
                onCopy={() => {}}
              />
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-surface-1/40 backdrop-blur-sm border border-edge/60 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 flex-1 min-w-[200px]">
            <svg className="w-3.5 h-3.5 text-txt-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by id or name..."
              className="flex-1 bg-transparent text-sm text-white placeholder:text-txt-ghost focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-txt-muted hover:text-white text-xs"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(['all', 'performance', 'balanced', 'economy'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTierFilter(t)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-all ${
                  tierFilter === t
                    ? 'bg-white text-black'
                    : 'bg-surface-2/40 text-txt-secondary border border-edge/40 hover:text-white'
                }`}
              >
                {t === 'all' ? 'All' : TIER_STYLES[t].label}
              </button>
            ))}

            <label className="flex items-center gap-1.5 text-[11px] text-txt-secondary cursor-pointer ml-2">
              <input
                type="checkbox"
                checked={hideThinking}
                onChange={(e) => setHideThinking(e.target.checked)}
                className="w-3 h-3 accent-emerald-500"
              />
              Hide thinking variants
            </label>
          </div>
        </div>

        {/* Model groups */}
        {filtered.length === 0 ? (
          <div className="bg-surface-1/40 border border-edge/60 rounded-xl p-12 text-center">
            <p className="text-white text-sm font-medium">No models match your filter</p>
            <p className="text-txt-muted text-xs mt-1">Try clearing search or switching tier.</p>
          </div>
        ) : (
          grouped.map(([provider, list]) => (
            <div key={provider} className="mb-6">
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-txt-muted">
                  {provider}
                </span>
                <span className="text-[10px] text-txt-faint">{list.length} models</span>
              </div>
              <div className="grid grid-cols-1 fold:grid-cols-2 gap-2">
                {list.map((m) => (
                  <ModelCard
                    key={m.id}
                    model={m}
                    result={results[m.id]}
                    isTesting={testing === m.id && testState.isLoading}
                    onCopy={handleCopy}
                    onTest={handleTest}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────── Sub-components ────────────────────────────── */

function CopyRow({
  label,
  value,
  hint,
  onCopy,
}: {
  label: string;
  value: string;
  hint?: boolean;
  onCopy: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 bg-surface-2/40 border border-edge/40 rounded px-2.5 py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-txt-muted shrink-0">{label}</span>
      <code className={`flex-1 text-xs truncate font-mono ${hint ? 'text-txt-faint' : 'text-white'}`}>
        {value}
      </code>
      {!hint && (
        <button
          type="button"
          onClick={() => onCopy(value)}
          className="text-[10px] text-txt-muted hover:text-white px-1.5 py-0.5 rounded hover:bg-surface-2/60 btn-squash"
          title="Copy to clipboard"
        >
          Copy
        </button>
      )}
    </div>
  );
}

function ModelCard({
  model,
  result,
  isTesting,
  onCopy,
  onTest,
}: {
  model: ModelEntry;
  result?: TestModelResult;
  isTesting: boolean;
  onCopy: (v: string) => void;
  onTest: (id: string) => void;
}) {
  const tier = TIER_STYLES[model.tier] ?? TIER_STYLES.balanced;
  const hasResult = !!result;

  return (
    <div className="bg-surface-1/40 backdrop-blur-sm border border-edge/60 rounded-xl p-3 hover:border-edge-hover transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">{model.displayName}</span>
            {model.thinking && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-purple-300 uppercase tracking-wider font-bold">
                Thinking
              </span>
            )}
          </div>
          <code className="text-[11px] text-txt-secondary font-mono break-all leading-snug">
            {model.id}
          </code>
        </div>
        <span
          className="shrink-0 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded"
          style={{
            background: tier.bg,
            color: tier.text,
            border: `1px solid ${tier.border}`,
          }}
        >
          {tier.label}
        </span>
      </div>

      {/* Specs row */}
      <div className="flex items-center gap-3 text-[10px] text-txt-muted mb-2">
        <span className="flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="tabular-nums">{formatContext(model.contextWindow)}</span> ctx
        </span>
        <span className="flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="tabular-nums">{formatContext(model.maxTokens)}</span> max
        </span>
      </div>

      {/* Test result inline */}
      {hasResult && (
        <div
          className={`mb-2 px-2 py-1.5 rounded border text-[11px] ${
            result!.ok
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
              : 'bg-red-500/10 border-red-500/30 text-red-200'
          }`}
        >
          {result!.ok ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">✓ OK · {result!.latencyMs}ms</span>
                <span className="text-[10px] opacity-70 tabular-nums">
                  {result!.promptTokens}→{result!.completionTokens} tok
                </span>
              </div>
              {result!.sampleReply && (
                <p className="mt-0.5 font-mono text-[10px] opacity-70 truncate">
                  &ldquo;{result!.sampleReply}&rdquo;
                </p>
              )}
            </>
          ) : (
            <>
              <span className="font-medium">✗ Failed</span>
              {result!.upstreamStatus && (
                <span className="text-[10px] opacity-70 ml-1">
                  ({result!.upstreamStatus})
                </span>
              )}
              <p className="mt-0.5 font-mono text-[10px] opacity-70 truncate">
                {result!.error ?? 'unknown'}
              </p>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onCopy(model.id)}
          className="flex-1 text-[11px] px-2 py-1 rounded bg-white/95 hover:bg-white text-black font-medium btn-squash transition-colors"
        >
          Copy ID
        </button>
        <button
          type="button"
          onClick={() => onTest(model.id)}
          disabled={isTesting}
          className="flex-1 text-[11px] px-2 py-1 rounded border border-edge/60 hover:border-edge-hover hover:bg-surface-2/60 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed btn-squash transition-colors flex items-center justify-center gap-1.5"
        >
          {isTesting ? (
            <>
              <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Testing
            </>
          ) : (
            <>Test</>
          )}
        </button>
      </div>
    </div>
  );
}
