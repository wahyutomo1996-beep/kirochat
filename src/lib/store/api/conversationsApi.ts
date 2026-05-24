/**
 * Conversation endpoints — list, create, delete, fetch messages.
 *
 * Note: chat streaming itself goes through fetch() directly (RTK Query's
 * cache model doesn't fit streaming). But conversation metadata + message
 * history go through here so the sidebar stays in sync.
 */

import { baseApi } from './baseApi';

export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  images: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  createdAt: string;
}

export const conversationsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listConversations: build.query<{ conversations: ConversationSummary[] }, void>({
      query: () => '/api/conversations',
      providesTags: (result) =>
        result?.conversations
          ? [
              ...result.conversations.map((c) => ({ type: 'Conversation' as const, id: c.id })),
              { type: 'Conversation' as const, id: 'LIST' },
            ]
          : [{ type: 'Conversation', id: 'LIST' }],
    }),

    getConversationMessages: build.query<{ messages: Message[] }, string>({
      query: (id) => `/api/conversations/${id}/messages`,
      providesTags: (_result, _error, id) => [{ type: 'Message', id }],
    }),

    deleteConversation: build.mutation<{ deleted: boolean }, string>({
      query: (id) => ({
        url: `/api/conversations/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_result, _error, id) => [
        { type: 'Conversation', id },
        { type: 'Conversation', id: 'LIST' },
        { type: 'Message', id },
      ],
    }),
  }),
});

export const {
  useListConversationsQuery,
  useGetConversationMessagesQuery,
  useDeleteConversationMutation,
} = conversationsApi;
