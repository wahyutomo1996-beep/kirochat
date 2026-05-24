/**
 * API Key endpoint — get current key, regenerate.
 *
 * Regenerating invalidates the 'ApiKey' tag, but in practice the user is
 * shown the new key inline so refetch isn't strictly needed. It's invalidated
 * for the rare case where multiple tabs are open.
 */

import { baseApi } from './baseApi';

export interface ApiKeyResponse {
  apiKey: string;
}

export const apiKeyApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getApiKey: build.query<ApiKeyResponse, void>({
      query: () => '/api/api-key',
      providesTags: ['ApiKey'],
    }),

    regenerateApiKey: build.mutation<ApiKeyResponse, void>({
      query: () => ({
        url: '/api/api-key',
        method: 'POST',
      }),
      invalidatesTags: ['ApiKey'],
    }),
  }),
});

export const { useGetApiKeyQuery, useRegenerateApiKeyMutation } = apiKeyApi;
