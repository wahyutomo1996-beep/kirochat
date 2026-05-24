/**
 * Health endpoint — public, polled by status indicators.
 *
 * Default polling interval is 30s when subscribed (component-level override
 * possible via `useGetHealthQuery(undefined, { pollingInterval: 5000 })`).
 */

import { baseApi } from './baseApi';

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  uptimeSeconds: number;
  timestamp: string;
  version: string;
  db: {
    ok: boolean;
    latencyMs: number;
    error?: string;
  };
  pool?: {
    totalAccounts: number;
    activeAccounts: number;
    exhaustedAccounts: number;
    totalUsers: number;
  };
}

export const healthApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getHealth: build.query<HealthResponse, { detail?: boolean } | void>({
      query: (arg) => `/api/health${arg?.detail ? '?detail=1' : ''}`,
      providesTags: ['Health'],
    }),
  }),
});

export const { useGetHealthQuery } = healthApi;
