'use client';

/**
 * Quota Tracker — dedicated SaaS-style monitoring dashboard for Kiro accounts.
 *
 * Layout:
 *   [Hero header: title + description]
 *   [Filter bar: provider | account | sort | toggles | auto-refresh]
 *   [Summary chips: total accounts, healthy, exhausted, total quota left]
 *   [Card grid: 1-col mobile / 2-col fold+ / 3-col xl - one per account]
 *   [Pagination footer]
 *
 * Each card surfaces:
 *   - account email + status indicator
 *   - color-coded progress bar (emerald/amber/red)
 *   - "X / Y" remaining numbers
 *   - "Resets in 5h 22m" live countdown ticker
 *   - action icons: refresh / edit limit / delete / activate-disable
 *
 * The page reuses all existing RTK Query hooks (no new endpoints needed).
 * Reset countdown comes from quotaResetInMs server-side, ticked every
 * second by a small leaf component to avoid re-rendering the whole page.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppDispatch } from '@/lib/store/hooks';
import { showToast } from '@/lib/store/slices/uiSlice';
import {
  useGetKiroUsageQuery,
  useDeleteKiroAccountMutation,
  useReactivateKiroAccountMutation,
  useSetKiroDailyLimitMutation,
  type KiroAccountStats,
} from '@/lib/store/api/kiroAccountsApi';

const REFRESH_MS = 30_000;
const PAGE_SIZE_OPTIONS = [6, 12, 24, 48];

/** Format an ms duration into "5d 4h 22m" / "2h 13m" / "47s" */
function formatDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Live "Resets in Xd Yh Zm" ticker. Isolated to its own component so the
 *  parent doesnt re-render every second. */
function ResetCountdown({ resetAt }: { resetAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!resetAt) return <span className="text-txt-faint">—</span>;
  const remaining = new Date(resetAt).getTime() - now;
  return <span className="tabular-nums">{formatDuration(remaining)}</span>;
}

type SortMode = 'reset-soonest' | 'reset-latest' | 'remaining-low' | 'remaining-high' | 'name';

export default function QuotaTrackerPage() {
  const dispatch = useAppDispatch();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>('reset-soonest');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'exhausted'>('all');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  const { data, isFetching, refetch } = useGetKiroUsageQuery(undefined, {
    pollingInterval: autoRefresh ? REFRESH_MS : 0,
  });

  const [deleteAccount] = useDeleteKiroAccountMutation();
  const [reactivateAccount] = useReactivateKiroAccountMutation();
  const [setDailyLimit] = useSetKiroDailyLimitMutation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLimit, setDraftLimit] = useState('');

  const allAccounts = useMemo(() => data?.accounts ?? [], [data]);

  // Filtering pipeline
  const filtered = useMemo(() => {
    let list = [...allAccounts];
    if (statusFilter !== 'all') {
      list = list.filter((a) => a.status === statusFilter);
    }
    if (hideEmpty) {
      list = list.filter((a) => a.todayRequests > 0 || a.totalRequests > 0);
    }
    if (showAvailableOnly) {
      list = list.filter((a) => {
        if (a.status !== 'active') return false;
        if (a.dailyLimit === null) return true; // unlimited counts as available
        return (a.dailyRemaining ?? 0) > 0;
      });
    }
    return list;
  }, [allAccounts, statusFilter, hideEmpty, showAvailableOnly]);

  // Sorting
  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      if (sortMode === 'reset-soonest') {
        return (a.quotaResetInMs ?? Infinity) - (b.quotaResetInMs ?? Infinity);
      }
      if (sortMode === 'reset-latest') {
        return (b.quotaResetInMs ?? -Infinity) - (a.quotaResetInMs ?? -Infinity);
      }
      if (sortMode === 'remaining-low') {
        const ra = a.dailyRemaining ?? Infinity;
        const rb = b.dailyRemaining ?? Infinity;
        return ra - rb;
      }
      if (sortMode === 'remaining-high') {
        const ra = a.dailyRemaining ?? -1;
        const rb = b.dailyRemaining ?? -1;
        return rb - ra;
      }
      // name
      return (a.email ?? '').localeCompare(b.email ?? '');
    });
    return list;
  }, [filtered, sortMode]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageAccounts = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Reset to page 1 if filters reduce list below current page
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  // Summary chips
  const summary = useMemo(() => {
    const total = allAccounts.length;
    const active = allAccounts.filter((a) => a.status === 'active').length;
    const exhausted = allAccounts.filter((a) => a.status === 'exhausted').length;
    let totalRemaining = 0;
    let hasUnlimited = false;
    for (const a of allAccounts) {
      if (a.dailyLimit === null) hasUnlimited = true;
      else totalRemaining += a.dailyRemaining ?? 0;
    }
    return { total, active, exhausted, totalRemaining, hasUnlimited };
  }, [allAccounts]);

  // Mutations
  const handleDelete = async (id: string, email: string | null) => {
    if (!confirm(`Hapus akun ${email ?? '(no email)'}? Semua usage history tetap tersimpan.`)) return;
    try {
      await deleteAccount(id).unwrap();
      dispatch(showToast({ type: 'success', message: 'Akun dihapus' }));
    } catch {
      dispatch(showToast({ type: 'error', message: 'Gagal menghapus akun' }));
    }
  };

  const handleReactivate = async (id: string) => {
    try {
      await reactivateAccount(id).unwrap();
      dispatch(showToast({ type: 'success', message: 'Akun diaktifkan kembali' }));
    } catch (err) {
      const data = (err as { data?: { error?: string; detail?: string } })?.data;
      dispatch(showToast({
        type: 'error',
        message: data?.error
          ? `${data.error}${data.detail ? ` (${String(data.detail).slice(0, 80)})` : ''}`
          : 'Gagal mengaktifkan akun',
      }));
    }
  };

  const handleSaveLimit = async (id: string) => {
    const trimmed = draftLimit.trim();
    let value: number | null = null;
    if (trimmed !== '' && trimmed !== '0') {
      const parsed = parseInt(trimmed, 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
        dispatch(showToast({ type: 'error', message: 'Limit harus 0..1,000,000' }));
        setEditingId(null);
        return;
      }
      value = parsed;
    }
    try {
      await setDailyLimit({ id, dailyLimit: value }).unwrap();
      dispatch(showToast({
        type: 'success',
        message: value ? `Limit diset ke ${value.toLocaleString('en-US')}` : 'Limit dihapus (unlimited)',
      }));
    } catch {
      dispatch(showToast({ type: 'error', message: 'Gagal menyimpan limit' }));
    }
    setEditingId(null);
  };

  return (
    <div className="min-h-screen px-4 py-6 fold:px-6 fold:py-8">
      <div className="max-w-6xl mx-auto">
        {/* Hero */}
        <div className="mb-6 fold:mb-8">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-emerald-400">
                  Live monitor
                </span>
              </div>
              <h1 className="text-2xl fold:text-3xl font-bold text-white tracking-tight mb-1">
                Quota Tracker
              </h1>
              <p className="text-sm text-txt-muted leading-relaxed max-w-2xl">
                Pantau dan kelola batas kuota API per akun Kiro. Set daily limit per akun
                (1000, 2000, atau berapa pun), lihat sisa request real-time, dan tau
                kapan kuotanya reset.
              </p>
            </div>
            <Link
              href="/chat"
              className="text-sm text-txt-secondary hover:text-white px-3 py-1.5 rounded-lg border border-edge/60 hover:border-edge-hover transition-all"
            >
              ← Back to chat
            </Link>
          </div>

          {/* Summary chips */}
          <div className="grid grid-cols-2 fold:grid-cols-4 gap-2 mt-5">
            <SummaryChip label="Total accounts" value={String(summary.total)} tone="neutral" />
            <SummaryChip label="Active" value={String(summary.active)} tone="good" />
            <SummaryChip
              label="Exhausted"
              value={String(summary.exhausted)}
              tone={summary.exhausted > 0 ? 'bad' : 'neutral'}
            />
            <SummaryChip
              label="Quota left today"
              value={
                summary.hasUnlimited && summary.totalRemaining === 0
                  ? '∞'
                  : `${summary.totalRemaining.toLocaleString('en-US')}${summary.hasUnlimited ? ' + ∞' : ''}`
              }
              tone="neutral"
            />
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-surface-1/40 backdrop-blur-sm border border-edge/60 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-2">
          {/* Status filter */}
          <FilterGroup label="Status">
            {(['all', 'active', 'exhausted'] as const).map((s) => (
              <FilterPill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                {s === 'all' ? 'Semua' : s === 'active' ? 'Aktif' : 'Habis'}
              </FilterPill>
            ))}
          </FilterGroup>

          {/* Sort */}
          <FilterGroup label="Sort">
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="bg-surface-2/60 border border-edge/40 rounded text-[11px] text-white px-2 py-1 focus:outline-none focus:border-edge-hover"
            >
              <option value="reset-soonest">Reset paling cepat</option>
              <option value="reset-latest">Reset paling lama</option>
              <option value="remaining-low">Sisa terkecil</option>
              <option value="remaining-high">Sisa terbanyak</option>
              <option value="name">Nama (A-Z)</option>
            </select>
          </FilterGroup>

          {/* Toggles */}
          <FilterGroup label="">
            <label className="flex items-center gap-1.5 text-[11px] text-txt-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={(e) => setHideEmpty(e.target.checked)}
                className="w-3 h-3 accent-emerald-500"
              />
              Hide empty
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-txt-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={showAvailableOnly}
                onChange={(e) => setShowAvailableOnly(e.target.checked)}
                className="w-3 h-3 accent-emerald-500"
              />
              Tampilkan tersedia
            </label>
          </FilterGroup>

          {/* Auto refresh + manual refresh */}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-2 py-1 rounded text-[10px] font-medium uppercase tracking-wider border transition-colors ${
                autoRefresh
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-surface-2/60 text-txt-muted border-edge/40 hover:text-white'
              }`}
              title={autoRefresh ? 'Auto-refresh ON (30s)' : 'Auto-refresh OFF'}
            >
              Auto {autoRefresh ? 'on' : 'off'}
            </button>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-1.5 rounded hover:bg-surface-2/60 disabled:opacity-50 transition-colors btn-squash"
              title="Refresh now"
              aria-label="Refresh now"
            >
              <svg
                className={`w-4 h-4 text-white ${isFetching ? 'animate-spin' : ''}`}
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

        {/* Cards grid */}
        {allAccounts.length === 0 ? (
          <EmptyState />
        ) : sorted.length === 0 ? (
          <div className="bg-surface-1/40 border border-edge/60 rounded-xl p-12 text-center">
            <p className="text-white text-sm font-medium">No accounts match your filters</p>
            <p className="text-txt-muted text-xs mt-1">
              Coba ubah filter atau matikan toggle untuk lihat semua akun.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 fold:grid-cols-2 xl:grid-cols-3 gap-3">
            {pageAccounts.map((acc) => (
              <QuotaCard
                key={acc.id}
                account={acc}
                isEditing={editingId === acc.id}
                draftLimit={draftLimit}
                onStartEdit={() => {
                  setDraftLimit(acc.dailyLimit !== null ? String(acc.dailyLimit) : '');
                  setEditingId(acc.id);
                }}
                onCancelEdit={() => setEditingId(null)}
                onChangeDraft={setDraftLimit}
                onSaveLimit={() => handleSaveLimit(acc.id)}
                onDelete={() => handleDelete(acc.id, acc.email)}
                onReactivate={() => handleReactivate(acc.id)}
                onRefresh={() => refetch()}
              />
            ))}
          </div>
        )}

        {/* Pagination footer */}
        {sorted.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-txt-muted">
            <div className="flex items-center gap-2">
              <span>Per halaman:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-surface-2/60 border border-edge/40 rounded px-2 py-0.5 text-white focus:outline-none focus:border-edge-hover"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span className="text-txt-faint">
                Menampilkan {(safePage - 1) * pageSize + 1}-
                {Math.min(safePage * pageSize, sorted.length)} dari {sorted.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(Math.max(1, safePage - 1))}
                disabled={safePage === 1}
                className="px-2 py-1 rounded hover:bg-surface-2/60 disabled:opacity-30 transition-colors"
                aria-label="Previous page"
              >
                ←
              </button>
              <span className="px-2 tabular-nums">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                disabled={safePage >= totalPages}
                className="px-2 py-1 rounded hover:bg-surface-2/60 disabled:opacity-30 transition-colors"
                aria-label="Next page"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────── Sub-components ────────────────────────────── */

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'bad' | 'neutral';
}) {
  const valueColor =
    tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-white';
  return (
    <div className="bg-surface-1/40 backdrop-blur-sm border border-edge/60 rounded-xl px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-txt-muted">{label}</p>
      <p className={`text-base fold:text-lg font-semibold tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      {label && (
        <span className="text-[10px] uppercase tracking-wider text-txt-muted font-semibold">
          {label}
        </span>
      )}
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
        active
          ? 'bg-white text-black'
          : 'bg-surface-2/40 text-txt-secondary border border-edge/40 hover:text-white hover:border-edge-hover'
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="bg-surface-1/40 border border-edge/60 rounded-xl p-12 text-center backdrop-blur-sm">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(99, 102, 241, 0.05))',
          border: '1px solid rgba(99, 102, 241, 0.3)',
          boxShadow: '0 8px 32px -8px rgba(99, 102, 241, 0.4)',
        }}
      >
        ⚡
      </div>
      <p className="text-white text-base font-semibold">Belum ada akun Kiro</p>
      <p className="text-txt-muted text-sm mt-1.5 leading-relaxed">
        Tambah akun pertama lo lewat{' '}
        <Link href="/settings" className="text-emerald-300 hover:underline">
          Settings → Kiro Account Pool
        </Link>
        , baru quota tracker bakal aktif di sini.
      </p>
    </div>
  );
}

function QuotaCard({
  account,
  isEditing,
  draftLimit,
  onStartEdit,
  onCancelEdit,
  onChangeDraft,
  onSaveLimit,
  onDelete,
  onReactivate,
  onRefresh,
}: {
  account: KiroAccountStats;
  isEditing: boolean;
  draftLimit: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onChangeDraft: (v: string) => void;
  onSaveLimit: () => void;
  onDelete: () => void;
  onReactivate: () => void;
  onRefresh: () => void;
}) {
  const hasLimit = account.dailyLimit !== null && account.dailyLimit > 0;
  const usagePct = hasLimit
    ? (account.dailyUsagePct ?? 0) * 100
    : Math.min(100, (account.todayTokens / 5_000_000) * 100);

  // Bar color matches user spec: emerald for healthy, amber for half-used, red for near-empty.
  const barColor =
    account.status === 'exhausted'
      ? 'rgb(239, 68, 68)' // red-500
      : usagePct >= 85
        ? 'rgb(248, 113, 113)' // red
        : usagePct >= 50
          ? 'rgb(251, 191, 36)' // amber (yellow per spec at half)
          : 'rgb(52, 211, 153)'; // emerald

  const isExhausted = account.status === 'exhausted';

  return (
    <div className="bg-surface-1/40 backdrop-blur-sm border border-edge/60 rounded-2xl p-4 hover:border-edge-hover transition-all hover-lift">
      {/* Top row: status dot + email + action icons */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              isExhausted ? 'bg-red-400' : 'bg-emerald-400'
            }`}
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {account.email ?? '(no email)'}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-txt-muted">
              {account.status} · {account.quotaCycle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <IconBtn onClick={onRefresh} title="Refresh" aria-label="Refresh">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </IconBtn>
          <IconBtn onClick={onStartEdit} title="Edit limit" aria-label="Edit limit">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </IconBtn>
          {isExhausted ? (
            <IconBtn
              onClick={onReactivate}
              title="Reactivate"
              aria-label="Reactivate"
              tone="good"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </IconBtn>
          ) : (
            <IconBtn
              onClick={onReactivate}
              title="Verify connection"
              aria-label="Verify connection"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </IconBtn>
          )}
          <IconBtn onClick={onDelete} title="Delete" aria-label="Delete" tone="bad">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </IconBtn>
        </div>
      </div>

      {/* Big stat: X / Y */}
      <div className="mb-2">
        {hasLimit ? (
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-2xl fold:text-3xl font-bold tabular-nums ${
                (account.dailyRemaining ?? 0) === 0 ? 'text-red-300' : 'text-white'
              }`}
            >
              {(account.dailyRemaining ?? 0).toLocaleString('en-US')}
            </span>
            <span className="text-base text-txt-faint tabular-nums">
              / {account.dailyLimit?.toLocaleString('en-US')}
            </span>
            <span className="text-[11px] text-txt-muted ml-auto">requests left</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl fold:text-3xl font-bold text-white tabular-nums">∞</span>
            <span className="text-base text-txt-faint">unlimited</span>
            <span className="text-[11px] text-txt-muted ml-auto">
              {account.todayRequests.toLocaleString('en-US')} req today
            </span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-surface-3/60 overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${usagePct}%`, backgroundColor: barColor }}
        />
      </div>

      {/* Footer row: usage detail + reset countdown */}
      <div className="flex items-center justify-between text-[11px] text-txt-muted">
        <span>
          {account.todayRequests.toLocaleString('en-US')} used today
        </span>
        <span className="flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Resets in <ResetCountdown resetAt={account.quotaResetAt} />
        </span>
      </div>

      {/* Inline limit editor */}
      {isEditing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSaveLimit();
          }}
          className="mt-3 pt-3 border-t border-edge/40 flex items-center gap-2"
        >
          <span className="text-[10px] uppercase tracking-wider text-txt-muted shrink-0">
            Daily limit
          </span>
          <input
            type="number"
            min="0"
            max="1000000"
            autoFocus
            value={draftLimit}
            onChange={(e) => onChangeDraft(e.target.value)}
            placeholder="0 = unlimited"
            className="flex-1 px-2 py-1 bg-surface-0/80 border border-emerald-500/40 rounded text-xs text-white font-mono tabular-nums focus:outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 text-[11px] hover:bg-emerald-500/30"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onCancelEdit}
            className="px-2 py-1 rounded text-[11px] text-txt-muted hover:text-white"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Last error inline */}
      {account.lastError && (
        <div className="mt-3 px-2 py-1.5 bg-red-500/10 border border-red-500/30 rounded text-[10px] text-red-300/90">
          <span className="font-medium uppercase tracking-wider">
            {isExhausted ? 'Exhausted' : 'Last error'}
          </span>
          <span className="block mt-0.5 font-mono text-red-300/70 truncate">
            {account.lastError}
          </span>
        </div>
      )}
    </div>
  );
}

function IconBtn({
  onClick,
  children,
  title,
  tone = 'neutral',
  ...rest
}: {
  onClick: () => void;
  children: React.ReactNode;
  title: string;
  tone?: 'neutral' | 'good' | 'bad';
} & Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>) {
  const colorClass =
    tone === 'good'
      ? 'text-emerald-300 hover:text-emerald-200 hover:bg-emerald-500/10'
      : tone === 'bad'
        ? 'text-txt-muted hover:text-red-300 hover:bg-red-500/10'
        : 'text-txt-muted hover:text-white hover:bg-surface-2/60';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={rest['aria-label'] ?? title}
      className={`p-1.5 rounded transition-colors btn-squash ${colorClass}`}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {children}
      </svg>
    </button>
  );
}
