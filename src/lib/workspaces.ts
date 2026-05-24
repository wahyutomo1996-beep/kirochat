/**
 * Workspace definitions.
 *
 * Workspaces are first-class scopes for the chat experience. Each one has:
 *   - A short identifier saved on Conversation rows ("general" | "coding" | "trading")
 *   - A default combo slug used when the user starts a fresh chat in that
 *     workspace (the dispatcher tries combo steps in order on rate-limit)
 *   - Display metadata (icon, name, description)
 *
 * Adding a new workspace later means appending an entry here and (optionally)
 * shipping a matching pre-built combo template in combo-templates.ts. The
 * sidebar UI iterates this list to render boxes, so no UI code changes are
 * needed for a new workspace.
 */

export interface WorkspaceDef {
  /** DB value + URL slug — must be lowercase, no spaces. */
  id: string;
  /** Display name shown in the sidebar box. */
  name: string;
  /** Single-character emoji rendered in the sidebar box. */
  icon: string;
  /** One-line description shown under the name on hover. */
  description: string;
  /**
   * Combo slug used as the default when the user clicks the workspace box.
   * If the user doesn't have this combo instantiated yet, the chat page
   * falls back to picking the first available combo of that category, and
   * if no combos exist at all it falls back to a raw model id.
   */
  defaultComboSlug: string;
  /**
   * Raw model fallback used when the user has zero combos. Picked from
   * the built-in Kiro pool so it works out of the box.
   */
  fallbackModel: string;
  /**
   * Built-in system prompt seed for this workspace. The chat page uses
   * this when starting a brand-new conversation. Empty string = no seed.
   */
  systemPrompt: string;
}

export const WORKSPACES: WorkspaceDef[] = [
  {
    id: 'general',
    name: 'General',
    icon: '\u{1F4AC}',
    description: 'Everyday chat, Q&A, brainstorming.',
    defaultComboSlug: 'general-balanced',
    fallbackModel: 'kiro/claude-sonnet-4.6',
    systemPrompt: '',
  },
  {
    id: 'coding',
    name: 'Coding',
    icon: '\u{1F4BB}',
    description: 'Software engineering tasks — debug, refactor, review.',
    defaultComboSlug: 'coding-premium',
    fallbackModel: 'kiro/claude-opus-4.7',
    systemPrompt:
      'You are a senior software engineer. Be precise, give working code, and explain edge cases. ' +
      'When you write code, prefer clarity over cleverness. If the user shares a bug, identify the root ' +
      'cause before suggesting a fix.',
  },
  {
    id: 'trading',
    name: 'Trading',
    icon: '\u{1F4C8}',
    description: 'Market analysis, signals, strategy discussion.',
    defaultComboSlug: 'trading-realtime',
    fallbackModel: 'kiro/claude-haiku-4.5',
    systemPrompt:
      'You are a trading analyst. Stay terse, lead with the signal, then justify briefly. Use bullet ' +
      'points for multi-asset views. Quantify uncertainty with explicit probabilities or ranges. ' +
      'Never give financial advice — frame everything as analysis.',
  },
];

export const WORKSPACE_IDS = WORKSPACES.map((w) => w.id);

export function findWorkspace(id: string): WorkspaceDef | null {
  return WORKSPACES.find((w) => w.id === id) ?? null;
}

/**
 * Validate a workspace id against the known list. Returns 'general' when
 * the input is unknown — defensive default rather than throwing.
 */
export function normalizeWorkspaceId(id: string | null | undefined): string {
  if (!id) return 'general';
  return WORKSPACE_IDS.includes(id) ? id : 'general';
}
