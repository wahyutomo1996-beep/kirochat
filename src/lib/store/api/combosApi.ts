/**
 * Combos endpoint slice - CRUD + templates.
 *
 * Tag strategy:
 *   - 'Combo' for the user's combos (LIST + per-id)
 *   - Templates are static so no tag (server cache only)
 */

import { baseApi } from './baseApi';

export interface ComboStep {
  providerId: string;
  model: string;
  label?: string;
}

export interface Combo {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  steps: ComboStep[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ComboTemplate {
  slug: string;
  name: string;
  description: string;
  category: 'coding' | 'trading' | 'research' | 'general';
  icon: string;
  steps: ComboStep[];
  tags: string[];
  recommendedExternal?: Array<{ name: string; reason: string; baseUrl: string }>;
}

export interface CreateComboPayload {
  name: string;
  slug?: string;
  description?: string;
  category?: string;
  icon?: string;
  steps: ComboStep[];
  isActive?: boolean;
}

export interface UpdateComboPayload {
  id: string;
  name?: string;
  description?: string;
  icon?: string;
  steps?: ComboStep[];
  isActive?: boolean;
}

export const combosApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listCombos: build.query<{ combos: Combo[] }, void>({
      query: () => '/api/combos',
      providesTags: (result) =>
        result?.combos
          ? [
              ...result.combos.map((c) => ({ type: 'Combo' as const, id: c.id })),
              { type: 'Combo' as const, id: 'LIST' },
            ]
          : [{ type: 'Combo', id: 'LIST' }],
    }),

    listComboTemplates: build.query<{ templates: ComboTemplate[] }, string | void>({
      query: (category) =>
        `/api/combos/templates${category ? `?category=${encodeURIComponent(category)}` : ''}`,
    }),

    createCombo: build.mutation<{ combo: Combo }, CreateComboPayload>({
      query: (body) => ({
        url: '/api/combos',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'Combo', id: 'LIST' }],
    }),

    instantiateTemplate: build.mutation<{ combo: Combo }, string>({
      query: (templateSlug) => ({
        url: `/api/combos?from=${encodeURIComponent(templateSlug)}`,
        method: 'POST',
      }),
      invalidatesTags: [{ type: 'Combo', id: 'LIST' }],
    }),

    updateCombo: build.mutation<{ combo: Combo }, UpdateComboPayload>({
      query: ({ id, ...body }) => ({
        url: `/api/combos/${id}`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'Combo', id },
        { type: 'Combo', id: 'LIST' },
      ],
    }),

    deleteCombo: build.mutation<{ deleted: boolean }, string>({
      query: (id) => ({
        url: `/api/combos/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Combo', id },
        { type: 'Combo', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useListCombosQuery,
  useListComboTemplatesQuery,
  useCreateComboMutation,
  useInstantiateTemplateMutation,
  useUpdateComboMutation,
  useDeleteComboMutation,
} = combosApi;
