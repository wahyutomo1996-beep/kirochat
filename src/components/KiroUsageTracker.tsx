'use client';

/**
 * KiroUsageTracker - real-time quota & usage tracker for the Kiro pool.
 *
 * Features:
 *   - Auto-refresh every 30s (toggle-able, persisted to localStorage)
 *   - Manual refresh button with spinner during refetch
 *   - "Updated Xs ago" live counter ticking every second
 *   - Pool-wide summary (active/exhausted accounts, tokens today/7d/all-time)
 *   - Per-account: today / 7d / total / failed + status badge + last error
 *   - Per-account daily request limit + REMAINING countdown
 *     (e.g. "1840 / 2000 left today" with color-coded progress bar)
 *   - Inline edit: click the limit number to set 1000/2000/etc per account
 *
 * Reuses RTK Query so it dedupes requests when multiple instances mount.
 * The component is self-contained: drop into any page, it handles state.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useGetKiroUsageQuery,
  useSetKiroDailyLimitMutation,
  type KiroAccountStats,
  type KiroSummary,
} from '@/lib/store/api/kiroAccountsApi';

const AUTO_REFRESH_KEY = 'prometheus.kiro.autoRefresh';
const REFRESH_MS = 30_000;

interface Props {
  /** Show pool-wide summary section. Default: true */
  showSummary?: boolean;
  /** Show per-account breakdown. Default: true */
  showPerAccount?: boolean;
  /** Compact variant (smaller stat cards). Useful for Dashboard widget. */
  compact?: boolean;
}

function formatTokens(n: number): string {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '') + 'K';
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, '') + 'M';
}

function loadAutoRefresh(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const v = localStorage.getItem(AUTO_REFRESH_KEY);
    return v === null ? true : v === 'true';
  } catch {
    return true;
  }
}

function saveAutoRefresh(v: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTO_REFRESH_KEY, String(v));
  } catch {
    /* localStorage full or disabled */
  }
}

/**
 * Tick counter that emits seconds-since-last-refresh. We avoid re-rendering
 * the whole tracker every second by isolating the tick into a small leaf
 * component.
 */
function FreshnessIndicator({ since }: { since: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (since === null) {
    return <span className="text-txt-faint">—</span>;
  }
  const seconds = Math.floor((now - since) / 1000);
  if (seconds < 5) return <span className="text-emerald-400">just now</span>;
  if (seconds < 60) return <span className="text-txt-secondary">{seconds}s ago</span>;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return <span className="text-txt-muted">{minutes}m ago</span>;
  return <span className="text-txt-faint">stale</span>;
}

/**
 * One row per account showing:
 *   - status indicator + email
 *   - REQUEST quota: "X / Y left today" with progress bar
 *     (or token total when no limit set)
 *   - 4-cell breakdown (today/7d/total/in-out) unless compact mode
 *   - Inline-editable dailyLimit: click the limit number to change it
 */
function AccountRow({
  stats,
  emailFallback,
  status,
  refreshTokenPreview,
  compact,
}: {
  stats: KiroAccountStats | undefined;
  emailFallback: string | null;
  status: string;
  refreshTokenPreview?: string;
  compact: boolean;
}) {
  const [setDailyLimit, { isLoading: savingLimit }] = useSetKiroDailyLimitMutation();
  const [editingLimit, setEditingLimit] = useState(false);
  const [draftLimit, setDraftLimit] = useState('');

  if (!stats) {
    return (
      <div className="px-3 py-2 text-xs text-txt-faint">
        Loading account stats...
      </div>
    );
  }

  // Quota math — prefer dailyLimit if user set one, else fall back to
  // showing token usage with an arbitrary 5M reference (just for the bar
  // color heuristic when no explicit limit exists).
  const hasLimit = stats.dailyLimit !== null && stats.dailyLimit > 0;
  const usagePct = hasLimit
    ? (stats.dailyUsagePct ?? 0) * 100
    : Math.min(100, (stats.todayTokens / 5_000_000) * 100);
  const barColor =
    usagePct >= 85
      ? 'rgb(248, 113, 113)' // red
      : usagePct >= 60
        ? 'rgb(251, 191, 36)' // amber
        : 'rgb(52, 211, 153)'; // emerald

  const handleSaveLimit = async () => {
    const trimmed = draftLimit.trim();
    let value: number | null;
    if (trimmed === '' || trimmed === '0') {
      value = null;
    } else {
      const parsed = parseInt(trimmed, 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
        // Invalid — just close edit, dont save
        setEditingLimit(false);
        return;
      }
      value = parsed;
    }
    try {
      await setDailyLimit({ id: stats.id, dailyLimit: value }).unwrap();
    } catch {
      /* error — no toast here, user can retry */
    }
    setEditingLimit(false);
  };

  const handleStartEdit = () => {
    setDraftLimit(stats.dailyLimit !== null ? String(stats.dailyLimit) : '');
    setEditingLimit(true);
  };

  return (
    <div className="px-3 py-3 hover:bg-surface-2/40 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                status === 'active' ? 'bg-emerald-400' : 'bg-red-400'
              }`}
            />
            <span className="text-sm font-medium text-white truncate">
              {emailFallback ?? '(no email)'}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-txt-muted">
              {status}
            </span>
          </div>
          {refreshTokenPreview && (
            <p className="text-[10px] text-txt-faint font-mono ml-3.5">
              {refreshTokenPreview}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          {hasLimit ? (
            <>
              <p className="text-xs font-semibold text-white tabular-nums">
                <span className={stats.dailyRemaining === 0 ? 'text-red-300' : ''}>
                  {(stats.dailyRemaining ?? 0).toLocaleString('en-US')}
                </span>
                <span className="text-txt-faint"> / {stats.dailyLimit?.toLocaleString('en-US')}</span>
              </p>
              <p className="text-[10px] text-txt-faint">
                requests left today
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-white tabular-nums">
                {stats.todayRequests.toLocaleString('en-US')}
              </p>
              <p className="text-[10px] text-txt-faint">requests today</p>
            </>
          )}
        </div>
      </div>

      {/* Quota progress bar — full when hasLimit, else heuristic from tokens */}
      <div className="ml-3.5 mr-1 mb-2">
        <div className="h-1 rounded-full bg-surface-3/60 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${usagePct}%`, backgroundColor: barColor }}
          />
        </div>
      </div>

      {/* Daily limit editor row - inline below progress bar */}
      <div className="ml-3.5 mb-2 flex items-center gap-2 text-[10px]">
        <span className="text-txt-muted uppercase tracking-wider">Daily limit:</span>
        {editingLimit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveLimit();
            }}
            className="flex items-center gap-1"
          >
            <input
              type="number"
              min="0"
              max="1000000"
              autoFocus
              value={draftLimit}
              onChange={(e) => setDraftLimit(e.target.value)}
              onBlur={handleSaveLimit}
              placeholder="unlimited"
              className="w-24 px-1.5 py-0.5 bg-surface-0/80 border border-emerald-500/40 rounded text-white font-mono tabular-nums focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={savingLimit}
              className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              {savingLimit ? '…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setEditingLimit(false)}
              className="px-1.5 py-0.5 rounded text-txt-muted hover:text-white"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={handleStartEdit}
            className="font-mono tabular-nums text-white hover:text-emerald-300 transition-colors hover:underline underline-offset-2"
            title="Click to edit"
          >
            {stats.dailyLimit !== null ? stats.dailyLimit.toLocaleString('en-US') + ' req/day' : 'unlimited'}
          </button>
        )}
      </div>

      {/* Compact: hide the 4-cell breakdown */}
      {!compact && (
        <div className="ml-3.5 grid grid-cols-4 gap-2 text-[11px]">
          <Stat label="Today" value={formatTokens(stats.todayTokens)} sub={`${stats.todayRequests} req`} />
          <Stat label="7d" value={formatTokens(stats.weekTokens)} sub={`${stats.weekRequests} req`} />
          <Stat label="Total" value={formatTokens(stats.totalTokens)} sub={`${stats.totalRequests} req`} />
          <Stat
            label="In/Out"
            value={`${formatTokens(stats.totalPromptTokens)}/${formatTokens(stats.totalCompletionTokens)}`}
            sub={`${stats.failedRequests} failed`}
            tone={stats.failedRequests > 0 ? 'warn' : 'neutral'}
          />
        </div>
      )}

      {stats.lastError && (
        <div className="ml-3.5 mt-2 px-2 py-1.5 bg-red-500/10 border border-red-500/30 rounded text-[10px] text-red-300/90">
          <span className="font-medium uppercase tracking-wider">
            {status === 'exhausted' ? 'Exhausted' : 'Last error'}
          </span>
          {stats.lastErrorAt && (
            <span className="text-red-400/70">
              {' '}· {new Date(stats.lastErrorAt).toLocaleString('id-ID')}
            </span>
          )}
          <span className="block mt-0.5 font-mono text-red-300/70 truncate">
            {stats.lastError}
          </span>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub: string;
  tone?: 'neutral' | 'warn';
}) {
  const valueClass = tone === 'warn' ? 'text-amber-300' : 'text-white';
  return (
    <div className="bg-surface-2/40 border border-edge/40 rounded px-2 py-1">
      <p className="text-[9px] uppercase tracking-wider text-txt-muted">{label}</p>
      <p className={`font-semibold tabular-nums ${valueClass}`}>{value}</p>
      <p className="text-[9px] text-txt-faint">{sub}</p>
    </div>
  );
}

export interface KiroUsageTrackerHandle {
  refresh: () => void;
}

export function KiroUsageTracker({ showSummary = true, showPerAccount = true, compact = false }: Props) {
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  // Restore preference on mount
  useEffect(() => {
    setAutoRefresh(loadAutoRefresh());
  }, []);

  const { data, isFetching, refetch } = useGetKiroUsageQuery(undefined, {
    pollingInterval: autoRefresh ? REFRESH_MS : 0,
  });

  // Bump lastFetched whenever isFetching transitions from true -> false
  // (i.e. a fetch just completed). useRef tracks previous value.
  const wasFetching = useRef(false);
  useEffect(() => {
    if (wasFetching.current && !isFetching && data) {
      setLastFetched(Date.now());
    }
    wasFetching.current = isFetching;
  }, [isFetching, data]);
  // Also seed lastFetched on first successful load
  useEffect(() => {
    if (data && lastFetched === null) {
      setLastFetched(Date.now());
    }
  }, [data, lastFetched]);

  const accounts: KiroAccountStats[] = useMemo(() => data?.accounts ?? [], [data]);
  const summary: KiroSummary | null = data?.summary ?? null;

  const handleRefresh = () => {
    refetch();
  };

  const handleToggleAutoRefresh = () => {
    const next = !autoRefresh;
    setAutoRefresh(next);
    saveAutoRefresh(next);
  };

  return (
    <div className="bg-surface-1 border border-hairline rounded-xl overflow-hidden">
      {/* Header bar with refresh controls */}
      <div className="px-4 py-2.5 border-b border-edge/40 flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <svg
            className={`w-3.5 h-3.5 shrink-0 ${
              autoRefresh ? 'text-emerald-400' : 'text-txt-muted'
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-txt-secondary">
            Kiro pool quota
          </p>
        </div>

        <div className="flex items-center gap-3 text-[10px] text-txt-muted">
          <span>
            updated <FreshnessIndicator since={lastFetched} />
          </span>

          <button
            type="button"
            onClick={handleToggleAutoRefresh}
            className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider transition-colors ${
              autoRefresh
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : 'bg-surface-2/60 text-txt-muted border border-edge/40 hover:text-white'
            }`}
            title={autoRefresh ? 'Auto-refresh ON (30s)' : 'Auto-refresh OFF'}
          >
            Auto {autoRefresh ? 'on' : 'off'}
          </button>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={isFetching}
            className="p-1 rounded hover:bg-surface-2/60 disabled:opacity-50 transition-colors btn-squash"
            title="Refresh now"
            aria-label="Refresh now"
          >
            <svg
              className={`w-3.5 h-3.5 text-white ${isFetching ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Pool-wide summary */}
      {showSummary && summary && (
        <div className="px-4 py-3 border-b border-edge/40 bg-surface-2/20 grid grid-cols-3 gap-3">
          <SummaryCard
            label="Active accounts"
            value={`${summary.activeAccounts} / ${summary.totalAccounts}`}
            tone={summary.activeAccounts === 0 ? 'bad' : 'good'}
            sub={summary.exhaustedAccounts > 0 ? `${summary.exhaustedAccounts} exhausted` : 'all healthy'}
          />
          <SummaryCard
            label="Tokens today"
            value={formatTokens(summary.totalTokensToday)}
            tone="neutral"
            sub={`7d: ${formatTokens(summary.totalTokensWeek)}`}
          />
          <SummaryCard
            label="All-time"
            value={formatTokens(summary.totalTokensAllTime)}
            tone="neutral"
            sub="cumulative"
          />
        </div>
      )}

      {/* Per-account list */}
      {showPerAccount && (
        <div className="divide-y divide-edge/30">
          {accounts.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-txt-muted">
              No Kiro accounts yet. Add one in <span className="text-txt-secondary">Settings → Kiro Account Pool</span>.
            </div>
          ) : (
            accounts.map((stats) => (
              <AccountRow
                key={stats.id}
                stats={stats}
                emailFallback={stats.email}
                status={stats.status}
                compact={compact}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'good' | 'bad' | 'neutral';
}) {
  const valueColor =
    tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-white';
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-txt-muted">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${valueColor}`}>{value}</p>
      <p className="text-[10px] text-txt-faint mt-0.5">{sub}</p>
    </div>
  );
}
