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
    <div className="min-h-screen bg-surface-0">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-fade-in">
          <div>
            <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
            <p className="text-txt-muted text-sm mt-1">Usage statistics and cost tracking</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-surface-1 border border-edge rounded-lg p-1">
              {RANGES.map(r => (
                <button
                  key={r.value}
                  onClick={() => setRange(r.value)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                    range === r.value ? 'bg-white text-black' : 'text-txt-muted hover:text-white'
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
            icon="📊"
          />
          <StatCard
            label="Total Tokens"
            value={formatNumber(data.summary.totalTokens)}
            sub={`${formatNumber(data.summary.totalPromptTokens)} in / ${formatNumber(data.summary.totalCompletionTokens)} out`}
            icon="🔤"
          />
          <StatCard
            label="Estimated Cost"
            value={formatCost(data.summary.totalCost)}
            sub={`Avg ${data.summary.totalRequests > 0 ? formatCost(data.summary.totalCost / data.summary.totalRequests) : '$0'}/req`}
            icon="💰"
            highlight
          />
          <StatCard
            label="Avg Latency"
            value={`${data.summary.avgLatency}ms`}
            sub={`${data.summary.totalConversations} conversations`}
            icon="⚡"
          />
        </div>

        {/* Timeline Chart */}
        {data.timeline.length > 0 && (
          <div className="bg-surface-1 border border-edge rounded-xl p-5 mb-6 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-white">Token Usage Over Time</h2>
                <p className="text-xs text-txt-muted mt-0.5">Daily token consumption</p>
              </div>
            </div>
            <div className="flex items-end gap-1 h-32">
              {data.timeline.map((d, i) => {
                const heightPct = (d.tokens / maxTokens) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group min-w-0">
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className="w-full bg-gradient-to-t from-white/40 to-white/80 rounded-t hover:from-white/60 hover:to-white transition-all relative"
                        style={{ height: `${Math.max(heightPct, 2)}%` }}
                      >
                        <div className="absolute -top-9 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-surface-3 border border-edge-hover rounded-md px-2 py-1 text-[10px] text-white whitespace-nowrap pointer-events-none transition-opacity">
                          {formatNumber(d.tokens)} tokens
                          <br />
                          {formatCost(d.cost)}
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] text-txt-muted truncate w-full text-center">{d.date.slice(5)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Per Model & Per Provider */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* By Model */}
          <div className="bg-surface-1 border border-edge rounded-xl p-5 animate-slide-up">
            <h2 className="text-base font-semibold text-white mb-1">By Model</h2>
            <p className="text-xs text-txt-muted mb-4">Top {data.byModel.length} models</p>
            {data.byModel.length === 0 ? (
              <p className="text-txt-muted text-sm py-8 text-center">No usage data yet</p>
            ) : (
              <div className="space-y-3">
                {data.byModel.slice(0, 8).map((m, i) => {
                  const widthPct = (m.requests / maxRequestsModel) * 100;
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-white font-medium font-mono truncate pr-2" title={m.model}>{m.model}</span>
                        <span className="text-txt-muted shrink-0">{m.requests} req · {formatCost(m.cost)}</span>
                      </div>
                      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-white/60 to-white rounded-full transition-all"
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
          <div className="bg-surface-1 border border-edge rounded-xl p-5 animate-slide-up">
            <h2 className="text-base font-semibold text-white mb-1">By Provider</h2>
            <p className="text-xs text-txt-muted mb-4">{data.summary.totalProviders} active providers</p>
            {data.byProvider.length === 0 ? (
              <p className="text-txt-muted text-sm py-8 text-center">No usage data yet</p>
            ) : (
              <div className="space-y-3">
                {data.byProvider.map((p, i) => {
                  const widthPct = (p.requests / maxRequestsProvider) * 100;
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="text-white font-medium truncate pr-2" title={p.providerName}>{p.providerName}</span>
                        <span className="text-txt-muted shrink-0">{p.requests} req · {formatCost(p.cost)}</span>
                      </div>
                      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-purple-400/60 to-purple-300 rounded-full transition-all"
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
        <div className="bg-surface-1 border border-edge rounded-xl overflow-hidden animate-slide-up">
          <div className="px-5 py-4 border-b border-edge">
            <h2 className="text-base font-semibold text-white">Recent Activity</h2>
            <p className="text-xs text-txt-muted mt-0.5">Last {data.recent.length} requests</p>
          </div>
          {data.recent.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-white text-sm font-medium">No activity yet</p>
              <p className="text-txt-muted text-xs mt-1">Start chatting to see usage here</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-surface-2">
                  <tr>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Time</th>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Provider</th>
                    <th className="px-5 py-3 text-left text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Model</th>
                    <th className="px-5 py-3 text-right text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Tokens</th>
                    <th className="px-5 py-3 text-right text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Latency</th>
                    <th className="px-5 py-3 text-right text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Cost</th>
                    <th className="px-5 py-3 text-center text-[11px] font-semibold text-txt-muted uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {data.recent.map((r, i) => (
                    <tr key={i} className="hover:bg-surface-2 transition-colors">
                      <td className="px-5 py-2.5 text-xs text-txt-secondary whitespace-nowrap">
                        {new Date(r.createdAt).toLocaleString('id-ID', {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit'
                        })}
                      </td>
                      <td className="px-5 py-2.5 text-xs text-white">{r.providerName}</td>
                      <td className="px-5 py-2.5 text-xs text-txt-secondary font-mono">{r.model}</td>
                      <td className="px-5 py-2.5 text-xs text-white text-right tabular-nums">{formatNumber(r.tokens)}</td>
                      <td className="px-5 py-2.5 text-xs text-txt-secondary text-right tabular-nums">{r.latencyMs}ms</td>
                      <td className="px-5 py-2.5 text-xs text-white text-right tabular-nums">{formatCost(r.cost)}</td>
                      <td className="px-5 py-2.5 text-center">
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

function StatCard({ label, value, sub, icon, highlight }: { label: string; value: string; sub?: string; icon?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-4 border transition-all ${
      highlight
        ? 'bg-gradient-to-br from-purple-500/10 to-surface-1 border-purple-500/30'
        : 'bg-surface-1 border-edge'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold text-txt-muted uppercase tracking-wider">{label}</p>
        {icon && <span className="text-base opacity-50">{icon}</span>}
      </div>
      <p className="text-2xl font-semibold text-white tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-txt-faint mt-1 truncate">{sub}</p>}
    </div>
  );
}
