'use client';

/**
 * Dashboard — usage analytics page.
 *
 * Refactored from manual fetch to RTK Query. Now:
 *   - One hook (`useGetDashboardQuery`) replaces useState + useEffect + fetch
 *   - Loading / error / data flow handled by the hook
 *   - 401 redirect centralized in baseApi.ts
 *   - Auto-refetch when window regains focus or network reconnects
 *   - Cache hit when switching ranges back-and-forth (instant, no flicker)
 *   - Auto-invalidates after kiro account mutations elsewhere in the app
 *     (the Settings page adds a Kiro account → dashboard refetches itself)
 */

import { useState } from 'react';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { LoadingState } from '@/components/LoadingState';
import { KiroUsageTracker } from '@/components/KiroUsageTracker';
import {
  useGetDashboardQuery,
  type DashboardRange,
} from '@/lib/store/api/dashboardApi';

const RANGES: Array<{ value: DashboardRange; label: string }> = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
];

export default function DashboardPage() {
  const [range, setRange] = useState<DashboardRange>('7d');
  const { data, isLoading } = useGetDashboardQuery(range);

  if (isLoading || !data) return <LoadingState fullScreen />;

  const formatNumber = (n: number) => n.toLocaleString('en-US');
  const formatCost = (c: number) => `$${c.toFixed(c < 0.01 ? 6 : 4)}`;

  // Find max for chart bars
  const maxTokens = Math.max(...data.timeline.map(d => d.tokens), 1);
  const maxRequestsModel = Math.max(...data.byModel.map(m => m.requests), 1);
  const maxRequestsProvider = Math.max(...data.byProvider.map(p => p.requests), 1);

  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="page-header animate-fade-in">
          <div>
            <p className="typo-eyebrow mb-2">Analytics</p>
            <h1 className="typo-headline">Dashboard</h1>
            <p className="typo-body-sm mt-2">Usage statistics and cost tracking</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-surface-1 border border-hairline rounded-lg p-1">
              {RANGES.map(r => (
                <button
                  key={r.value}
                  onClick={() => setRange(r.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    range === r.value ? 'bg-surface-2 text-ink border border-hairline-strong' : 'text-ink-subtle hover:text-ink'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <a href="/chat">
              <Button variant="secondary" size="sm">← Back</Button>
            </a>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 animate-slide-up">
          <StatCard
            label="Total Requests"
            value={formatNumber(data.summary.totalRequests)}
            sub={`${data.summary.successRate}% success`}
          />
          <StatCard
            label="Total Tokens"
            value={formatNumber(data.summary.totalTokens)}
            sub={`${formatNumber(data.summary.totalPromptTokens)} in / ${formatNumber(data.summary.totalCompletionTokens)} out`}
          />
          <StatCard
            label="Estimated Cost"
            value={formatCost(data.summary.totalCost)}
            sub={`Avg ${data.summary.totalRequests > 0 ? formatCost(data.summary.totalCost / data.summary.totalRequests) : '$0'}/req`}
            highlight
          />
          <StatCard
            label="Avg Latency"
            value={`${data.summary.avgLatency}ms`}
            sub={`${data.summary.totalConversations} conversations`}
          />
        </div>

        {/* Kiro pool live quota - manual refresh + auto-refresh 30s.
            Compact mode hides per-account 4-cell breakdown for space. */}
        <div className="mb-6 animate-slide-up">
          <KiroUsageTracker showSummary={true} showPerAccount={true} compact={true} />
        </div>

        {/* Timeline Chart */}
        {data.timeline.length > 0 && (
          <div className="section-card-sm mb-6 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-ink">Token Usage Over Time</h2>
                <p className="text-xs text-ink-subtle mt-0.5">Daily token consumption</p>
              </div>
            </div>
            <div className="flex items-end gap-1 h-32">
              {data.timeline.map((d, i) => {
                const heightPct = (d.tokens / maxTokens) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group min-w-0">
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className="w-full bg-gradient-to-t from-accent/40 to-accent rounded-t hover:from-accent/60 hover:to-accent-hover transition-all relative"
                        style={{ height: `${Math.max(heightPct, 2)}%` }}
                      >
                        <div className="absolute -top-9 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-surface-3 border border-hairline-strong rounded-md px-2 py-1 text-[10px] text-ink whitespace-nowrap pointer-events-none transition-opacity">
                          {formatNumber(d.tokens)} tokens
                          <br />
                          {formatCost(d.cost)}
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] text-ink-subtle truncate w-full text-center">{d.date.slice(5)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Per Model & Per Provider */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* By Model */}
          <div className="section-card-sm animate-slide-up">
            <h2 className="text-base font-semibold text-ink mb-1">By Model</h2>
            <p className="text-xs text-ink-subtle mb-4">Top {data.byModel.length} models</p>
            {data.byModel.length === 0 ? (
              <p className="text-ink-subtle text-sm py-8 text-center">No usage data yet</p>
            ) : (
              <div className="space-y-3">
                {data.byModel.slice(0, 8).map((m, i) => {
                  const widthPct = (m.requests / maxRequestsModel) * 100;
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-ink font-medium font-mono truncate pr-2" title={m.model}>{m.model}</span>
                        <span className="text-ink-subtle shrink-0">{m.requests} req · {formatCost(m.cost)}</span>
                      </div>
                      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-accent/60 to-accent rounded-full transition-all"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* By Provider */}
          <div className="section-card-sm animate-slide-up">
            <h2 className="text-base font-semibold text-ink mb-1">By Provider</h2>
            <p className="text-xs text-ink-subtle mb-4">{data.summary.totalProviders} active providers</p>
            {data.byProvider.length === 0 ? (
              <p className="text-ink-subtle text-sm py-8 text-center">No usage data yet</p>
            ) : (
              <div className="space-y-3">
                {data.byProvider.map((p, i) => {
                  const widthPct = (p.requests / maxRequestsProvider) * 100;
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-ink font-medium truncate pr-2" title={p.providerName}>{p.providerName}</span>
                        <span className="text-ink-subtle shrink-0">{p.requests} req · {formatCost(p.cost)}</span>
                      </div>
                      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-accent-secure/60 to-accent-hover rounded-full transition-all"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-surface-1 border border-hairline rounded-xl overflow-hidden animate-slide-up">
          <div className="px-6 py-5 border-b border-hairline">
            <h2 className="text-base font-semibold text-ink">Recent Activity</h2>
            <p className="text-xs text-ink-subtle mt-0.5">Last {data.recent.length} requests</p>
          </div>
          {data.recent.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-ink text-sm font-medium">No activity yet</p>
              <p className="text-ink-subtle text-xs mt-1">Start chatting to see usage here</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface-2">
                  <tr>
                    <th className="px-5 py-3 text-left typo-eyebrow">Time</th>
                    <th className="px-5 py-3 text-left typo-eyebrow">Provider</th>
                    <th className="px-5 py-3 text-left typo-eyebrow">Model</th>
                    <th className="px-5 py-3 text-right typo-eyebrow">Tokens</th>
                    <th className="px-5 py-3 text-right typo-eyebrow">Latency</th>
                    <th className="px-5 py-3 text-right typo-eyebrow">Cost</th>
                    <th className="px-5 py-3 text-center typo-eyebrow">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {data.recent.map((r, i) => (
                    <tr key={i} className="hover:bg-surface-2 transition-colors">
                      <td className="px-5 py-3 text-xs text-ink-muted whitespace-nowrap">
                        {new Date(r.createdAt).toLocaleString('id-ID', {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit'
                        })}
                      </td>
                      <td className="px-5 py-3 text-xs text-ink">{r.providerName}</td>
                      <td className="px-5 py-3 text-xs text-ink-muted font-mono">{r.model}</td>
                      <td className="px-5 py-3 text-xs text-ink text-right tabular-nums">{formatNumber(r.tokens)}</td>
                      <td className="px-5 py-3 text-xs text-ink-muted text-right tabular-nums">{r.latencyMs}ms</td>
                      <td className="px-5 py-3 text-xs text-ink text-right tabular-nums">{formatCost(r.cost)}</td>
                      <td className="px-5 py-3 text-center">
                        {r.success ? (
                          <Badge variant="success">OK</Badge>
                        ) : (
                          <Badge variant="danger">FAIL</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-5 border transition-all ${
      highlight
        ? 'bg-surface-2 border-hairline-strong'
        : 'bg-surface-1 border-hairline'
    }`}>
      <p className="typo-eyebrow mb-2">{label}</p>
      <p className="text-2xl font-semibold text-ink tabular-nums tracking-tight">{value}</p>
      {sub && <p className="text-[11px] text-ink-subtle mt-1.5 truncate">{sub}</p>}
    </div>
  );
}
