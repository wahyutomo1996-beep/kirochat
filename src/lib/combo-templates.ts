/**
 * Pre-built combo templates focused on coding and trading workflows.
 *
 * Each template defines an ordered chain of (provider, model) steps. The
 * dispatcher tries them in order — falls back to the next step on rate-limit,
 * auth failure, or network error. This lets users get reliability + cost
 * optimization without manual switching.
 *
 * Naming convention:
 *   coding-*    Software engineering tasks (debugging, refactoring, review)
 *   trading-*   Crypto / stock analysis, signal generation, market commentary
 *   research-*  Multi-step research with web search style workflows
 *   general-*   Catch-all chat
 *
 * Provider IDs:
 *   __prometheus__ - the built-in Kiro pool (always available if user has
 *                    Kiro accounts)
 *   <provider-id>  - external provider the user has added in Settings
 *
 * Templates use only built-in (Kiro) by default. When the user instantiates
 * a template, they can map external providers in if they want premium tiers.
 */

import { PROMETHEUS_PROVIDER_ID } from './constants';

export interface ComboStepDef {
  /** Provider ID. Use PROMETHEUS_PROVIDER_ID for built-in Kiro pool. */
  providerId: string;
  /** Model identifier (provider-native format) */
  model: string;
  /** Optional human label for the step */
  label?: string;
}

export interface ComboTemplate {
  slug: string;
  name: string;
  description: string;
  category: 'coding' | 'trading' | 'research' | 'general';
  icon: string;
  /** Default steps using only the built-in Kiro pool */
  steps: ComboStepDef[];
  /** Display tags - shown in template picker UI */
  tags: string[];
  /**
   * Recommended external providers to add for premium tier of this combo.
   * Just informational - user can ignore if they want all-free.
   */
  recommendedExternal?: Array<{ name: string; reason: string; baseUrl: string }>;
}

const KIRO = PROMETHEUS_PROVIDER_ID;

export const COMBO_TEMPLATES: ComboTemplate[] = [
  // ────────────────────────────── CODING ─────────────────────────────────
  {
    slug: 'coding-premium',
    name: 'Coding · Premium Quality',
    description:
      'Best-quality models first, with cheaper free fallbacks. Ideal for hard refactors, architecture review, complex debugging.',
    category: 'coding',
    icon: '\uD83C\uDFC6',
    tags: ['claude-opus', 'high-accuracy', 'fallback-ready'],
    steps: [
      { providerId: KIRO, model: 'kiro/claude-opus-4.7', label: 'Claude Opus 4.7 (best)' },
      { providerId: KIRO, model: 'kiro/claude-sonnet-4.6', label: 'Claude Sonnet 4.6 (fallback)' },
      { providerId: KIRO, model: 'kiro/deepseek-3.2', label: 'DeepSeek 3.2 (last resort)' },
    ],
    recommendedExternal: [
      { name: 'OpenRouter', reason: 'Adds GPT-5/Claude direct as premium tier', baseUrl: 'https://openrouter.ai/api/v1' },
    ],
  },
  {
    slug: 'coding-fast',
    name: 'Coding · Speed-First',
    description:
      'Fast models for quick iteration — boilerplate, naming, small fixes. Sacrifices quality for sub-second response.',
    category: 'coding',
    icon: '\u26A1',
    tags: ['haiku', 'low-latency', 'cheap'],
    steps: [
      { providerId: KIRO, model: 'kiro/claude-haiku-4.5', label: 'Claude Haiku 4.5 (fastest)' },
      { providerId: KIRO, model: 'kiro/qwen3-coder-next', label: 'Qwen3 Coder' },
      { providerId: KIRO, model: 'kiro/glm-5', label: 'GLM-5 (cheap fallback)' },
    ],
  },
  {
    slug: 'coding-debug',
    name: 'Coding · Deep Debug',
    description:
      'Reasoning-heavy models for root cause analysis, race conditions, perf debugging. Slower but rigorous.',
    category: 'coding',
    icon: '\uD83D\uDD0D',
    tags: ['reasoning', 'thinking', 'root-cause'],
    steps: [
      { providerId: KIRO, model: 'kiro/claude-opus-4.7', label: 'Claude Opus (extended thinking)' },
      { providerId: KIRO, model: 'kiro/deepseek-3.2', label: 'DeepSeek R1 (reasoning)' },
      { providerId: KIRO, model: 'kiro/claude-sonnet-4.6', label: 'Claude Sonnet (fallback)' },
    ],
  },
  {
    slug: 'coding-review',
    name: 'Coding · Code Review',
    description:
      'Models tuned for code review style feedback — diff analysis, security, style consistency.',
    category: 'coding',
    icon: '\uD83D\uDC40',
    tags: ['review', 'security', 'diff'],
    steps: [
      { providerId: KIRO, model: 'kiro/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
      { providerId: KIRO, model: 'kiro/glm-5', label: 'GLM-5' },
      { providerId: KIRO, model: 'kiro/claude-haiku-4.5', label: 'Haiku (fallback)' },
    ],
  },

  // ────────────────────────────── TRADING ────────────────────────────────
  {
    slug: 'trading-realtime',
    name: 'Trading · Real-Time Signals',
    description:
      'Fast models for low-latency market commentary, signal interpretation, real-time chart reading. Speed > depth.',
    category: 'trading',
    icon: '\uD83D\uDCC8',
    tags: ['low-latency', 'signals', 'real-time'],
    steps: [
      { providerId: KIRO, model: 'kiro/claude-haiku-4.5', label: 'Haiku (fastest)' },
      { providerId: KIRO, model: 'kiro/glm-5', label: 'GLM-5' },
      { providerId: KIRO, model: 'kiro/minimax-m2.5', label: 'MiniMax M2.5' },
    ],
    recommendedExternal: [
      { name: 'Groq', reason: 'Sub-100ms inference for tick-by-tick analysis', baseUrl: 'https://api.groq.com/openai/v1' },
    ],
  },
  {
    slug: 'trading-research',
    name: 'Trading · Deep Research',
    description:
      'High-quality reasoning models for fundamental analysis, multi-asset research, scenario modeling. Slower, deeper.',
    category: 'trading',
    icon: '\uD83D\uDCCA',
    tags: ['fundamentals', 'analysis', 'thesis'],
    steps: [
      { providerId: KIRO, model: 'kiro/claude-opus-4.7', label: 'Claude Opus 4.7' },
      { providerId: KIRO, model: 'kiro/deepseek-3.2', label: 'DeepSeek 3.2' },
      { providerId: KIRO, model: 'kiro/claude-sonnet-4.6', label: 'Claude Sonnet (fallback)' },
    ],
    recommendedExternal: [
      { name: 'Perplexity', reason: 'Web-grounded financial news for current events', baseUrl: 'https://api.perplexity.ai' },
    ],
  },
  {
    slug: 'trading-backtest',
    name: 'Trading · Strategy Backtesting',
    description:
      'For analyzing strategy code, performance reports, drawdown analysis. Mix of reasoning + speed.',
    category: 'trading',
    icon: '\u2696\uFE0F',
    tags: ['backtesting', 'strategy', 'analysis'],
    steps: [
      { providerId: KIRO, model: 'kiro/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
      { providerId: KIRO, model: 'kiro/qwen3-coder-next', label: 'Qwen3 Coder (numeric)' },
      { providerId: KIRO, model: 'kiro/claude-haiku-4.5', label: 'Haiku (fast fallback)' },
    ],
  },

  // ───────────────────────────── RESEARCH ────────────────────────────────
  {
    slug: 'research-deep',
    name: 'Research · Deep Dive',
    description:
      'Long-form synthesis, document analysis, multi-source comparison. High quality models throughout.',
    category: 'research',
    icon: '\uD83D\uDCDA',
    tags: ['synthesis', 'long-context', 'analysis'],
    steps: [
      { providerId: KIRO, model: 'kiro/claude-opus-4.7' },
      { providerId: KIRO, model: 'kiro/claude-sonnet-4.6' },
      { providerId: KIRO, model: 'kiro/deepseek-3.2' },
    ],
  },

  // ───────────────────────────── GENERAL ─────────────────────────────────
  {
    slug: 'general-balanced',
    name: 'General · Balanced',
    description:
      'Sane default for everyday chat — balances quality, speed, and pool capacity.',
    category: 'general',
    icon: '\u2728',
    tags: ['balanced', 'default'],
    steps: [
      { providerId: KIRO, model: 'kiro/claude-sonnet-4.6' },
      { providerId: KIRO, model: 'kiro/claude-haiku-4.5' },
      { providerId: KIRO, model: 'kiro/glm-5' },
    ],
  },
  {
    slug: 'general-cheap',
    name: 'General · Cheapest',
    description:
      'Optimized for pool conservation. Uses lightest models first to spread quota across users.',
    category: 'general',
    icon: '\uD83D\uDCB0',
    tags: ['cheap', 'low-cost'],
    steps: [
      { providerId: KIRO, model: 'kiro/claude-haiku-4.5' },
      { providerId: KIRO, model: 'kiro/glm-5' },
      { providerId: KIRO, model: 'kiro/minimax-m2.5' },
    ],
  },
];

/**
 * Find a template by slug. Returns null if not found.
 */
export function findTemplate(slug: string): ComboTemplate | null {
  return COMBO_TEMPLATES.find((t) => t.slug === slug) ?? null;
}

/**
 * List templates filtered by category. Returns all if no category given.
 */
export function listTemplates(category?: ComboTemplate['category']): ComboTemplate[] {
  if (!category) return COMBO_TEMPLATES;
  return COMBO_TEMPLATES.filter((t) => t.category === category);
}
