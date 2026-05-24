/**
 * Kiro Account Pool endpoints — list, add, delete, reactivate, usage stats.
 *
 * Tag strategy:
 *   - 'KiroAccount' for the accounts list
 *   - 'KiroUsage' for the per-account stats endpoint
 *   - 'Dashboard' invalidated on add/delete because top-level usage changes
 *
 * The reactivate mutation hits PATCH and the server actually probes Kiro to
 * verify the token works — kalau gagal, hook return error dengan detail dari
 * Kiro auth endpoint.
 */

import { baseApi } from './baseApi';

export interface KiroAccount {
  id: string;
  email: string | null;
  status: string;
  usageCount: number;
  lastUsed: string | null;
  tokenExpiresAt: string | null;
  exhaustedAt: string | null;
  createdAt: string;
  refreshTokenPreview: string;
}

export interface KiroAccountStats {
  id: string;
  email: string | null;
  status: string;
  createdAt: string;
  lastUsed: string | null;
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  failedRequests: number;
  todayRequests: number;
  todayTokens: number;
  weekRequests: number;
  weekTokens: number;
  lastError: string | null;
  lastErrorAt: string | null;
  exhaustedAt: string | null;
}

export interface KiroSummary {
  totalAccounts: number;
  activeAccounts: number;
  exhaustedAccounts: number;
  totalTokensToday: number;
  totalTokensWeek: number;
  totalTokensAllTime: number;
}

export interface AddTokensResponse {
  total: number;
  added: Array<{ id: string; email: string | null; index: number }>;
  errors: Array<{ index: number; preview: string; error: string }>;
  summary: string;
}

export interface ReactivateResponse {
  id: string;
  status: string;
  email: string | null;
  revived?: boolean;
}

export const kiroAccountsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listKiroAccounts: build.query<{ accounts: KiroAccount[] }, void>({
      query: () => '/api/kiro-accounts',
      providesTags: (result) =>
        result?.accounts
          ? [
              ...result.accounts.map((a) => ({ type: 'KiroAccount' as const, id: a.id })),
              { type: 'KiroAccount' as const, id: 'LIST' },
            ]
          : [{ type: 'KiroAccount', id: 'LIST' }],
    }),

    /**
     * Per-account usage stats. Auto-poll every 30s for "live credit display"
     * UX. Override polling at component level: `useGetKiroUsageQuery(undefined,
     * { pollingInterval: 0 })` to disable.
     */
    getKiroUsage: build.query<
      { accounts: KiroAccountStats[]; summary: KiroSummary },
      void
    >({
      query: () => '/api/kiro-accounts/usage',
      providesTags: ['KiroUsage'],
    }),

    addKiroAccount: build.mutation<AddTokensResponse, { refreshToken: string }>({
      query: (body) => ({
        url: '/api/kiro-accounts',
        method: 'POST',
        body,
      }),
      invalidatesTags: [
        { type: 'KiroAccount', id: 'LIST' },
        'KiroUsage',
        'Dashboard',
      ],
    }),

    deleteKiroAccount: build.mutation<{ deleted: boolean }, string>({
      query: (id) => ({
        url: `/api/kiro-accounts/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'KiroAccount', id },
        { type: 'KiroAccount', id: 'LIST' },
        'KiroUsage',
        'Dashboard',
      ],
    }),

    reactivateKiroAccount: build.mutation<ReactivateResponse, string>({
      query: (id) => ({
        url: `/api/kiro-accounts/${id}`,
        method: 'PATCH',
        body: { status: 'active' },
      }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'KiroAccount', id },
        { type: 'KiroAccount', id: 'LIST' },
        'KiroUsage',
      ],
    }),
  }),
});

export const {
  useListKiroAccountsQuery,
  useGetKiroUsageQuery,
  useAddKiroAccountMutation,
  useDeleteKiroAccountMutation,
  useReactivateKiroAccountMutation,
} = kiroAccountsApi;
