/**
 * Auth endpoints — login, register, current user, logout.
 *
 * After successful login/logout, we invalidate the 'Auth' tag which forces
 * any component subscribed to `useGetMeQuery` to refetch. This keeps the
 * UI in sync without manual reload.
 */

import { baseApi } from './baseApi';

export interface MeResponse {
  user: {
    id: string;
    email: string;
    username: string;
    role: string;
    status: string;
  };
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: {
    id: string;
    email: string;
    username: string;
    role: string;
  };
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

export interface RegisterResponse {
  message: string;
}

export const authApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    getMe: build.query<MeResponse, void>({
      query: () => '/api/auth/me',
      providesTags: ['Auth'],
    }),

    login: build.mutation<LoginResponse, LoginRequest>({
      query: (credentials) => ({
        url: '/api/auth/login',
        method: 'POST',
        body: credentials,
      }),
      invalidatesTags: ['Auth'],
    }),

    register: build.mutation<RegisterResponse, RegisterRequest>({
      query: (data) => ({
        url: '/api/auth/register',
        method: 'POST',
        body: data,
      }),
    }),
  }),
});

export const {
  useGetMeQuery,
  useLoginMutation,
  useRegisterMutation,
} = authApi;
