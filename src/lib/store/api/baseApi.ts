/**
 * Base RTK Query configuration.
 *
 * - Base URL is env-driven so local/prod just swap `NEXT_PUBLIC_API_BASE_URL`.
 *   Default to relative path `''` which works for same-origin Next.js routes.
 * - `credentials: 'include'` so the JWT cookie ('token') is sent on every call.
 * - Centralized 401 handling: redirect to /login on session expiry, but only
 *   when running in browser (avoids SSR redirect loops).
 * - Error normalization: every endpoint returns the same shape so UI doesn't
 *   need to handle 5 different error formats.
 *
 * Tag types are declared here so individual feature slices can `providesTags`
 * and `invalidatesTags` against a shared registry — kalau lo `addKiroAccount`
 * di settings page, dashboard refetch otomatis tanpa manual coordination.
 */

import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';

/**
 * Read the API base URL from env. Empty string = same-origin (default for
 * local dev). Set NEXT_PUBLIC_API_BASE_URL=https://api.example.com untuk
 * prod kalau lo split frontend & backend ke domain berbeda.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE_URL,
  // Cookie-based auth - JWT lives in httpOnly cookie 'token'
  credentials: 'include',
  prepareHeaders: (headers) => {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return headers;
  },
});

/**
 * Wraps the base query to add cross-cutting behavior:
 * - 401 -> redirect to login (browser-only, skip during SSR)
 * - 403 (account not approved) -> surface to UI without redirect
 * - Network errors -> normalized error shape
 */
const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  const result = await rawBaseQuery(args, api, extraOptions);

  if (result.error) {
    const status = result.error.status;

    // Auth expired - kick to login (browser only)
    if (status === 401 && typeof window !== 'undefined') {
      // Don't loop redirect if we're already on login page
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
  }

  return result;
};

/**
 * Tag registry. Add new tags here as features grow.
 *
 * Convention: tag = entity type. Use { type, id } for specific item, or
 * { type, id: 'LIST' } for collection-level invalidation.
 */
export const API_TAGS = [
  'Auth',
  'KiroAccount',
  'KiroUsage',
  'Provider',
  'Conversation',
  'Message',
  'Dashboard',
  'ApiKey',
  'Health',
  'AdminUser',
] as const;

export type ApiTag = (typeof API_TAGS)[number];

/**
 * The single root API slice. Feature slices inject endpoints into this via
 * `injectEndpoints` — keeps bundle splitting clean and store config small.
 */
export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: API_TAGS,
  // Most data should refetch on focus for "live feel" — individual endpoints
  // can opt-out with refetchOnFocus: false.
  refetchOnFocus: true,
  refetchOnReconnect: true,
  // Keep cached results for 60s after the last subscriber unmounts. Prevents
  // refetch storms when navigating between pages quickly.
  keepUnusedDataFor: 60,
  endpoints: () => ({}),
});
