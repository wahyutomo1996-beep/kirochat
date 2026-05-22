// Estimasi cost per 1M tokens (USD)
// Source: Provider pricing pages (perlu update berkala)

interface ModelPricing {
  prompt: number;     // USD per 1M prompt tokens
  completion: number; // USD per 1M completion tokens
}

const PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': { prompt: 2.50, completion: 10.00 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.60 },
  'gpt-4-turbo': { prompt: 10.00, completion: 30.00 },
  'gpt-4': { prompt: 30.00, completion: 60.00 },
  'gpt-3.5-turbo': { prompt: 0.50, completion: 1.50 },
  'o1': { prompt: 15.00, completion: 60.00 },
  'o1-mini': { prompt: 3.00, completion: 12.00 },
  'o3-mini': { prompt: 1.10, completion: 4.40 },

  // Anthropic Claude
  'claude-opus-4': { prompt: 15.00, completion: 75.00 },
  'claude-opus-4.7': { prompt: 15.00, completion: 75.00 },
  'claude-sonnet-4': { prompt: 3.00, completion: 15.00 },
  'claude-sonnet-4.5': { prompt: 3.00, completion: 15.00 },
  'claude-3-5-sonnet': { prompt: 3.00, completion: 15.00 },
  'claude-3-5-haiku': { prompt: 0.80, completion: 4.00 },
  'claude-3-opus': { prompt: 15.00, completion: 75.00 },
  'claude-3-sonnet': { prompt: 3.00, completion: 15.00 },
  'claude-3-haiku': { prompt: 0.25, completion: 1.25 },

  // Google
  'gemini-2.0-flash': { prompt: 0.10, completion: 0.40 },
  'gemini-2.0-flash-thinking': { prompt: 0.10, completion: 0.40 },
  'gemini-1.5-pro': { prompt: 1.25, completion: 5.00 },
  'gemini-1.5-flash': { prompt: 0.075, completion: 0.30 },
  'gemini-1.5-flash-8b': { prompt: 0.0375, completion: 0.15 },

  // DeepSeek
  'deepseek-chat': { prompt: 0.14, completion: 0.28 },
  'deepseek-reasoner': { prompt: 0.55, completion: 2.19 },
  'deepseek-v3': { prompt: 0.14, completion: 0.28 },
  'deepseek-r1': { prompt: 0.55, completion: 2.19 },

  // Groq (free tier - estimate from regular)
  'llama-3.3-70b': { prompt: 0.59, completion: 0.79 },
  'llama-3.1-70b': { prompt: 0.59, completion: 0.79 },
  'llama-3.1-8b': { prompt: 0.05, completion: 0.08 },
  'mixtral-8x7b': { prompt: 0.24, completion: 0.24 },
  'gemma2-9b': { prompt: 0.20, completion: 0.20 },

  // Mistral
  'mistral-large': { prompt: 2.00, completion: 6.00 },
  'mistral-medium': { prompt: 2.70, completion: 8.10 },
  'mistral-small': { prompt: 0.20, completion: 0.60 },
  'codestral': { prompt: 0.20, completion: 0.60 },

  // Kiro (claim from Anthropic Claude pricing as fallback)
  'kiro/claude-opus-4.7': { prompt: 15.00, completion: 75.00 },
  'kiro/claude-sonnet-4.5': { prompt: 3.00, completion: 15.00 },
};

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  // Try exact match first
  let pricing = PRICING[model];

  // Try fuzzy match (normalize)
  if (!pricing) {
    const normalized = model.toLowerCase().replace(/[^a-z0-9.-]/g, '');
    for (const [key, value] of Object.entries(PRICING)) {
      const keyNorm = key.toLowerCase().replace(/[^a-z0-9.-]/g, '');
      if (normalized.includes(keyNorm) || keyNorm.includes(normalized)) {
        pricing = value;
        break;
      }
    }
  }

  // Default: gpt-4o-mini pricing as fallback
  if (!pricing) pricing = { prompt: 0.15, completion: 0.60 };

  const promptCost = (promptTokens / 1_000_000) * pricing.prompt;
  const completionCost = (completionTokens / 1_000_000) * pricing.completion;
  return Number((promptCost + completionCost).toFixed(6));
}

export function getModelPricing(model: string): ModelPricing | null {
  return PRICING[model] || null;
}
