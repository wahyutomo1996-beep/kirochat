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
   */
  defaultComboSlug: string;
  /**
   * Raw model fallback used when the user has zero combos.
   */
  fallbackModel: string;
  /**
   * Built-in system prompt seed for this workspace.
   */
  systemPrompt: string;
  /**
   * When true, images attached in this workspace are auto-described via
   * a vision-capable provider (Gemini/GPT-4o/Haiku) before forwarding to
   * the workspace's primary model. Lets users use Kiro-backed combos with
   * image input.
   *
   * User can override per-workspace via User.workspaceSettings JSON.
   */
  bridgeImagesByDefault: boolean;
}

export interface UserWorkspaceSettings {
  bridgeImages?: boolean;
}

/**
 * Resolve effective settings for a user + workspace. Falls back to the
 * workspace's built-in defaults when user hasn't configured anything.
 */
export function resolveWorkspaceSettings(
  workspaceId: string,
  userSettings: Record<string, UserWorkspaceSettings | undefined> | null,
): { bridgeImages: boolean } {
  const ws = findWorkspace(workspaceId);
  const userOverride = userSettings?.[workspaceId] ?? {};
  return {
    bridgeImages:
      userOverride.bridgeImages !== undefined
        ? userOverride.bridgeImages
        : ws?.bridgeImagesByDefault ?? true,
  };
}

/**
 * Parse the JSON-serialized workspaceSettings column off a User row.
 * Returns empty record on parse failure (defensive).
 */
export function parseUserWorkspaceSettings(
  json: string | null | undefined,
): Record<string, UserWorkspaceSettings> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, UserWorkspaceSettings>;
    }
  } catch {
    /* ignore */
  }
  return {};
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
    bridgeImagesByDefault: true,
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
    bridgeImagesByDefault: true,
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
    bridgeImagesByDefault: true,
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
