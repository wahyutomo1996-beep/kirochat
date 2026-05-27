/**
 * Format a raw model id (e.g. "kiro/claude-opus-4.7-thinking") into a
 * human-friendly display name ("Claude Opus 4.7 (Thinking)").
 *
 * Used in chat sidebar, dashboard tables, combo panels, and routing
 * notices — anywhere we'd otherwise show the raw provider/slug pair.
 *
 * Rules:
 *   - Strip provider prefix ("kiro/", "openai/", "anthropic/", etc).
 *     Users have no use for it; it just steals horizontal space.
 *   - Detect "-thinking" suffix and surface as " (Thinking)".
 *   - Title-case word-by-word with hand-tuned exceptions for common
 *     acronyms (GPT, DeepSeek, Qwen3, GLM, MiniMax) so the output reads
 *     naturally instead of "Gpt 4o" / "Deepseek 3.2".
 *
 * Safe with empty / non-string inputs (returns empty string).
 */
export function formatModelDisplay(id: string | null | undefined): string {
  if (!id || typeof id !== 'string') return '';

  // Strip provider prefix — anything before the first slash.
  const noPrefix = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;

  // Detect thinking variant and strip the suffix before tokenizing.
  const isThinking = noPrefix.endsWith('-thinking');
  const base = isThinking ? noPrefix.slice(0, -'-thinking'.length) : noPrefix;

  // Tokenize on hyphens / underscores. Versions like "4.7" pass through
  // intact because they don't match the alpha-only acronym table.
  const words = base.split(/[-_]/).filter(Boolean).map((w) => {
    const lower = w.toLowerCase();
    // Acronym / brand fixups
    if (lower === 'gpt') return 'GPT';
    if (lower === 'glm') return 'GLM';
    if (lower === 'ai') return 'AI';
    if (lower === 'deepseek') return 'DeepSeek';
    if (lower === 'qwen3') return 'Qwen3';
    if (lower === 'qwen') return 'Qwen';
    if (lower === 'minimax') return 'MiniMax';
    if (lower === 'codex') return 'Codex';
    // Versions / numbers — pass through as-is
    if (/^\d/.test(w)) return w;
    // Default: capitalize first letter, keep the rest lowercase
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  });

  const pretty = words.join(' ');
  return isThinking ? `${pretty} (Thinking)` : pretty;
}
