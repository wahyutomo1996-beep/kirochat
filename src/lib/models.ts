/**
 * Model Registry
 *
 * Defines all available models that Prometheus can serve.
 * Each model has: id, display_name, provider, tier, context_window, max_tokens.
 * Includes both regular and "thinking" variants where applicable.
 */

export type ModelTier = 'performance' | 'balanced' | 'economy';

export interface ModelInfo {
  id: string;             // OpenAI-compatible model ID (e.g. "kiro/claude-opus-4.7")
  displayName: string;    // Human-readable name
  provider: 'kiro' | 'fm-openai' | 'fm-anthropic' | 'xm';
  tier: ModelTier;
  contextWindow: number;
  maxTokens: number;
  supportsThinking: boolean;
  // Internal Kiro modelId (sent in userInputMessage.modelId)
  kiroModelId?: string;
}

export const MODEL_REGISTRY: ModelInfo[] = [
  // Kiro - Claude Opus
  { id: 'kiro/claude-opus-4.7', displayName: 'Claude Opus 4.7', provider: 'kiro', tier: 'performance', contextWindow: 1_000_000, maxTokens: 8192, supportsThinking: true, kiroModelId: 'claude-opus-4.7' },
  { id: 'kiro/claude-opus-4.6', displayName: 'Claude Opus 4.6', provider: 'kiro', tier: 'performance', contextWindow: 1_000_000, maxTokens: 8192, supportsThinking: true, kiroModelId: 'claude-opus-4.6' },
  { id: 'kiro/claude-opus-4.5', displayName: 'Claude Opus 4.5', provider: 'kiro', tier: 'performance', contextWindow: 200_000, maxTokens: 8192, supportsThinking: true, kiroModelId: 'claude-opus-4.5' },

  // Kiro - Claude Sonnet
  { id: 'kiro/claude-sonnet-4.6', displayName: 'Claude Sonnet 4.6', provider: 'kiro', tier: 'performance', contextWindow: 10_000_000, maxTokens: 8192, supportsThinking: true, kiroModelId: 'claude-sonnet-4.6' },
  { id: 'kiro/claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5', provider: 'kiro', tier: 'balanced', contextWindow: 200_000, maxTokens: 8192, supportsThinking: true, kiroModelId: 'claude-sonnet-4.5' },
  { id: 'kiro/claude-sonnet-4', displayName: 'Claude Sonnet 4', provider: 'kiro', tier: 'balanced', contextWindow: 200_000, maxTokens: 8192, supportsThinking: true, kiroModelId: 'claude-sonnet-4' },

  // Kiro - Claude Haiku
  { id: 'kiro/claude-haiku-4.5', displayName: 'Claude Haiku 4.5', provider: 'kiro', tier: 'economy', contextWindow: 200_000, maxTokens: 8192, supportsThinking: true, kiroModelId: 'claude-haiku-4.5' },

  // Kiro - Auto
  { id: 'kiro/kiro-auto', displayName: 'Kiro Auto', provider: 'kiro', tier: 'balanced', contextWindow: 200_000, maxTokens: 8192, supportsThinking: true, kiroModelId: 'auto' },

  // Kiro - DeepSeek
  { id: 'kiro/deepseek-3.2', displayName: 'DeepSeek 3.2', provider: 'kiro', tier: 'economy', contextWindow: 128_000, maxTokens: 8192, supportsThinking: true, kiroModelId: 'deepseek-3.2' },

  // Kiro - Qwen
  { id: 'kiro/qwen3-coder-next', displayName: 'Qwen3 Coder Next', provider: 'kiro', tier: 'balanced', contextWindow: 256_000, maxTokens: 8192, supportsThinking: true, kiroModelId: 'qwen3-coder-next' },

  // Kiro - Minimax
  { id: 'kiro/minimax-m2.5', displayName: 'MiniMax M2.5', provider: 'kiro', tier: 'economy', contextWindow: 196_000, maxTokens: 8192, supportsThinking: true, kiroModelId: 'minimax-m2.5' },

  // Kiro - GLM
  { id: 'kiro/glm-5', displayName: 'GLM-5', provider: 'kiro', tier: 'balanced', contextWindow: 128_000, maxTokens: 8192, supportsThinking: true, kiroModelId: 'glm-5' },
];

/**
 * Get expanded model list including thinking variants.
 * For each model with supportsThinking=true, also expose <id>-thinking variant.
 */
export function getAllModels(): ModelInfo[] {
  const all: ModelInfo[] = [];
  for (const m of MODEL_REGISTRY) {
    all.push(m);
    if (m.supportsThinking) {
      all.push({
        ...m,
        id: `${m.id}-thinking`,
        displayName: `${m.displayName} (Thinking)`,
      });
    }
  }
  return all;
}

/**
 * Find a model by its OpenAI-compatible ID.
 * Strips -thinking suffix to find base model and returns base model + thinking flag.
 */
export function findModel(id: string): { model: ModelInfo; thinking: boolean } | null {
  const isThinking = id.endsWith('-thinking');
  const baseId = isThinking ? id.slice(0, -'-thinking'.length) : id;
  const model = MODEL_REGISTRY.find(m => m.id === baseId);
  if (!model) return null;
  return { model, thinking: isThinking };
}

/**
 * OpenAI-compatible models response format.
 */
export function toOpenAIFormat(models: ModelInfo[]): Array<{
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}> {
  const created = Math.floor(Date.now() / 1000);
  return models.map(m => ({
    id: m.id,
    object: 'model' as const,
    created,
    owned_by: m.provider,
  }));
}
