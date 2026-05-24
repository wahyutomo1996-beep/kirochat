/**
 * API Key endpoint — get current key, regenerate.
 *
 * SECURITY: The server only stores the SHA-256 hash of the API key. Plain
 * key is returned ONCE (on first-time mint or regenerate). After that, GET
 * returns `apiKey: null, hasKey: true` and the user can only regenerate
 * to get a new plain value.
 */

import { baseApi } from './baseApi';

export interface ApiKeyResponse {
  /** Plain API key, only present when freshly minted/regenerated */
  apiKey: string | null;
  /** True if a key already exists but the plain value is not recoverable */
  hasKey?: boolean;
  /** True when this response carries a freshly-minted plain key */
  isNew?: boolean;
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
