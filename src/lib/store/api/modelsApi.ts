/**
 * Models endpoint slice — list all models + test connection per model.
 *
 * The underlying /v1/models endpoint requires Bearer API key auth, but
 * the listing here is for the dashboard UI which uses cookie session.
 * We expose a simpler /api/models proxy that uses session auth.
 *
 * Test connection sends a tiny ping prompt through the chat dispatcher
 * to verify the whole flow (auth + pool + refresh + actual model accepts).
 */

import { baseApi } from './baseApi';

export interface ModelEntry {
  id: string;             // OpenAI-compatible id, e.g. "kiro/claude-opus-4.7"
  displayName: string;
  provider: string;
  tier: string;           // 'performance' | 'balanced' | 'economy'
  contextWindow: number;
  maxTokens: number;
  supportsThinking: boolean;
  /** True when this is the -thinking variant of a base model */
  thinking?: boolean;
}

export interface ModelsListResponse {
  models: ModelEntry[];
}

export interface TestModelResult {
  ok: boolean;
  modelId: string;
  latencyMs: number;
  sampleReply?: string;
  promptTokens?: number;
  completionTokens?: number;
  error?: string;
  upstreamStatus?: number;
}

export const modelsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    /**
     * List all available models. Cookie-authenticated so the dashboard
     * UI can render this without surfacing the API key in the browser.
     */
    listModels: build.query<ModelsListResponse, void>({
      query: () => '/api/models',
    }),

    /**
     * Send a ping prompt to a specific model. Returns success + latency
     * + sample reply, or error message when the dispatch failed.
     * Mutation type because it has side effects (token usage attribution
     * + Kiro API call), even though we dont mutate cached state.
     */
    testModel: build.mutation<TestModelResult, string>({
      query: (modelId) => ({
        url: '/api/models/test',
        method: 'POST',
        body: { modelId },
      }),
    }),
  }),
});

export const { useListModelsQuery, useTestModelMutation } = modelsApi;
