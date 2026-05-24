/**
 * Admin user management endpoints — list, update (role/status), delete.
 *
 * Tag strategy:
 *   - 'AdminUser' for individual user records and the list
 *   - Mutations invalidate both the specific user and the LIST so the table
 *     and stats stay in sync without manual refetch wiring.
 */

import { baseApi } from './baseApi';

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  createdAt: string;
  _count: { providers: number; conversations: number };
}

export interface UpdateUserPayload {
  id: string;
  status?: string;
  role?: string;
}

export const adminUsersApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listAdminUsers: build.query<{ users: AdminUser[] }, void>({
      query: () => '/api/admin/users',
      providesTags: (result) =>
        result?.users
          ? [
              ...result.users.map((u) => ({ type: 'AdminUser' as const, id: u.id })),
              { type: 'AdminUser' as const, id: 'LIST' },
            ]
          : [{ type: 'AdminUser', id: 'LIST' }],
    }),

    updateAdminUser: build.mutation<{ user: AdminUser }, UpdateUserPayload>({
      query: ({ id, ...body }) => ({
        url: `/api/admin/users/${id}`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: 'AdminUser', id },
        { type: 'AdminUser', id: 'LIST' },
      ],
    }),

    deleteAdminUser: build.mutation<{ deleted: boolean }, string>({
      query: (id) => ({
        url: `/api/admin/users/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'AdminUser', id },
        { type: 'AdminUser', id: 'LIST' },
      ],
    }),
  }),
});

export const {
  useListAdminUsersQuery,
  useUpdateAdminUserMutation,
  useDeleteAdminUserMutation,
} = adminUsersApi;
