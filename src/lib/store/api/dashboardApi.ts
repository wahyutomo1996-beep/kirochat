/**
 * Dashboard endpoints — usage statistics aggregated by time range.
 *
 * The 'Dashboard' tag is invalidated by mutations across the app (chat,
 * provider changes, kiro account changes) so the dashboard always reflects
 * the latest state without manual refresh.
 */

import { baseApi } from './baseApi';

export type DashboardRange = '24h' | '7d' | '30d' | 'all';

export interface DashboardSummary {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCost: number;
  avgLatency: number;
  totalConversations: number;
  totalProviders: number;
}

export interface DashboardData {
  range: string;
  summary: DashboardSummary;
  byModel: Array<{ model: string; requests: number; tokens: number; cost: number }>;
  byProvider: Array<{
    providerName: string;
    providerId: string;
    requests: number;
    tokens: number;
    cost: number;
  }>;
  timeline: Array<{ date: string; requests: number; tokens: number; cost: number }>;
  recent: Array<{
    providerName: string;
    model: string;
    tokens: number;
    cost: number;
    latencyMs: number;
    success: boolean;
    createdAt: string;
  }>;
}

export const dashboardApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getDashboard: build.query<DashboardData, DashboardRange>({
      query: (range) => `/api/dashboard?range=${range}`,
      providesTags: (_result, _error, range) => [{ type: 'Dashboard', id: range }],
    }),
  }),
});

export const { useGetDashboardQuery } = dashboardApi;
