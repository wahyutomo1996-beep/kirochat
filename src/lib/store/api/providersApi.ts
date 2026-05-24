/**
 * External Provider endpoints — list, create, update, delete, refresh models.
 *
 * The list endpoint also returns the synthetic Prometheus virtual provider
 * (id="__prometheus__"). Components should treat it as read-only — only DB
 * providers can be deleted/disabled.
 */

import { baseApi } from './baseApi';

export interface Provider {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  models: string;
  modelsLastFetched: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt?: string;
  /** Only present on the built-in Prometheus virtual provider */
  builtin?: boolean;
  accountCount?: number;
}

export interface ListProvidersResponse {
  providers: Provider[];
  activeKiroAccounts: number;
}

export interface CreateProviderRequest {
  name: string;
  type: string;
  baseUrl: string;
  apiKey: string;
}

export interface CreateProviderResponse {
  provider: Provider;
  modelsCount: number;
  message: string;
}

export const providersApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listProviders: build.query<ListProvidersResponse, void>({
      query: () => '/api/providers',
      providesTags: (result) =>
        result?.providers
          ? [
              ...result.providers.map((p) => ({ type: 'Provider' as const, id: p.id })),
              { type: 'Provider' as const, id: 'LIST' },
            ]
          : [{ type: 'Provider', id: 'LIST' }],
    }),

    createProvider: build.mutation<CreateProviderResponse, CreateProviderRequest>({
      query: (body) => ({
        url: '/api/providers',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'Provider', id: 'LIST' }],
    }),

    updateProvider: build.mutation<
      Provider,
      { id: string; isDefault?: boolean; isActive?: boolean }
    >({
      query: ({ id, ...body }) => ({
        url: `/api/providers/${id}`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Provider', id },
        { type: 'Provider', id: 'LIST' },
      ],
    }),

    deleteProvider: build.mutation<{ deleted: boolean }, string>({
      query: (id) => ({
        url: `/api/providers/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Provider', id },
        { type: 'Provider', id: 'LIST' },
      ],
    }),

    refreshProviderModels: build.mutation<{ count: number; models: string[] }, string>({
      query: (id) => ({
        url: `/api/providers/${id}/models`,
        method: 'GET',
      }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Provider', id },
        { type: 'Provider', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useListProvidersQuery,
  useCreateProviderMutation,
  useUpdateProviderMutation,
  useDeleteProviderMutation,
  useRefreshProviderModelsMutation,
} = providersApi;
