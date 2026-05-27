'use client';

/**
 * WorkspaceBox - sidebar tile representing a chat workspace.
 *
 * Each box has:
 *   - Icon + name header (clickable, starts a fresh chat in this workspace)
 *   - Inline selector with two modes:
 *       * Combo  — chained fallback (existing behavior)
 *       * Model  — pick a specific raw model (new — fixes "locked to one
 *         provider" UX bug where users had to create a combo for every
 *         single model they wanted to try)
 *   - Active state styling when this is the current workspace
 *
 * Click on the body (not chevron) -> activate workspace + start new chat.
 * Click on chevron -> toggle inline selector.
 */

import { useState } from 'react';
import type { WorkspaceDef } from '@/lib/workspaces';
import { formatModelDisplay } from '@/lib/format-model';

/**
 * Per-workspace accent color tokens. These map to the CSS variables defined
 * in globals.css under :root. The component uses inline styles to opt into
 * the right accent (rather than --ws-active which only follows the active
 * workspace) — this way each box shows its own color even when not active.
 */
const WORKSPACE_ACCENT: Record<string, { rgb: string; bright: string }> = {
  general: { rgb: '94 106 210', bright: '#828fff' },     // Linear lavender
  coding: { rgb: '16 185 129', bright: 'hsl(158, 75%, 62%)' },
  trading: { rgb: '245 158 11', bright: 'hsl(38, 100%, 67%)' },
};

/**
 * Minimal combo shape this component needs. Kept locally so the chat
 * page can pass either the RTK Query Combo type or its own ChatCombo
 * subset without an import dance.
 */
export interface WorkspaceComboLike {
  id: string;
  slug: string;
  name: string;
  icon: string;
  steps: Array<{ providerId: string; model: string; label?: string }>;
}

/** Minimal model shape for the picker dropdown */
export interface WorkspaceModelLike {
  id: string;            // e.g. "kiro/claude-opus-4.7"
  displayName: string;
  tier?: string;         // 'performance' | 'balanced' | 'economy'
}

/**
 * Selection state per workspace.
 *   - mode 'combo': value = combo slug
 *   - mode 'model': providerId + value = (which provider, which model id)
 *
 * Why providerId for model mode?
 *   The chat dispatcher needs to know whether to send to the built-in
 *   Kiro pool ('__prometheus__') or an external provider DB id. Without
 *   it, picking a "Claude Haiku 4.5" from Genfity would route to
 *   Kiro's haiku instead of Genfity's — same display name, different
 *   upstream.
 */
export type WorkspaceSelection =
  | { mode: 'combo'; value: string }
  | { mode: 'model'; providerId: string; value: string };

/**
 * Provider catalog passed in by the parent. One entry per provider
 * available to this user — '__prometheus__' (Kiro pool) is always
 * present, plus zero or more external providers from Settings.
 *
 * `shared: true` marks providers the user doesn't own (e.g. admin's
 * shared free tier). UI surfaces a badge so users know this catalog's
 * models hit someone else's quota and may have a limited model list.
 */
export interface ProviderCatalog {
  id: string;              // '__prometheus__' or DB provider id
  name: string;            // 'Prometheus', 'Genfity', etc.
  models: WorkspaceModelLike[];
  /** True iff catalog is from a shared provider (not user-owned) */
  shared?: boolean;
}

interface Props {
  workspace: WorkspaceDef;
  /** Combos available for this workspace (filtered to matching category) */
  combos: WorkspaceComboLike[];
  /** Provider catalogs the user can pick from in Model mode */
  providers: ProviderCatalog[];
  /** Current selection — combo slug or (provider, model) pair */
  selection: WorkspaceSelection;
  /** True if this workspace is the active one in chat */
  isActive: boolean;
  /** Called when user clicks the box (start fresh chat in this ws) */
  onActivate: () => void;
  /** Called when user picks a different combo OR model for this workspace */
  onSelectionChange: (selection: WorkspaceSelection) => void;
}

export function WorkspaceBox({
  workspace,
  combos,
  providers,
  selection,
  isActive,
  onActivate,
  onSelectionChange,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const accent = WORKSPACE_ACCENT[workspace.id] ?? WORKSPACE_ACCENT.general;

  // Resolve the current display label depending on mode
  const currentCombo = selection.mode === 'combo'
    ? combos.find((c) => c.slug === selection.value)
    : null;

  const activeProvider = selection.mode === 'model'
    ? providers.find((p) => p.id === selection.providerId)
    : null;
  const currentModel = selection.mode === 'model' && activeProvider
    ? activeProvider.models.find((m) => m.id === selection.value)
    : null;

  // Pick the first valid model for a given provider — used when user
  // switches the provider chip.
  const firstModelOf = (providerId: string): { id: string; providerId: string } | null => {
    const p = providers.find((x) => x.id === providerId);
    if (!p || p.models.length === 0) return null;
    return { id: p.models[0].id, providerId };
  };

  // Subtitle shown on the active workspace tile.
  // In model mode we ALWAYS prefix the provider name (e.g. "Genfity ·
  // Claude Haiku 4.5") so the user can tell at a glance which provider
  // is dispatching — same model name across providers is ambiguous
  // otherwise (Kiro and Genfity both serve "Claude Haiku 4.5").
  const subtitle = (() => {
    if (currentCombo) return currentCombo.name;
    if (selection.mode === 'model') {
      const providerName = activeProvider?.name ?? 'Prometheus';
      const modelLabel = currentModel?.displayName ?? formatModelDisplay(selection.value);
      return `${providerName} · ${modelLabel}`;
    }
    return formatModelDisplay(workspace.fallbackModel);
  })();

  return (
    <div
      style={
        isActive
          ? {
              background: `linear-gradient(135deg, rgba(${accent.rgb} / 0.18) 0%, rgba(${accent.rgb} / 0.06) 100%)`,
              borderColor: `rgba(${accent.rgb} / 0.5)`,
              boxShadow: `0 0 0 1px rgba(${accent.rgb} / 0.3), 0 8px 32px -8px rgba(${accent.rgb} / 0.4)`,
            }
          : undefined
      }
      className={`group/ws rounded-xl border overflow-hidden hover-lift ${
        isActive
          ? ''
          : 'bg-surface-1 border-hairline hover:border-hairline-strong hover:bg-surface-2'
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate();
          }
        }}
        aria-label={`Switch to ${workspace.name} workspace`}
        aria-pressed={isActive}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-hairline-strong focus-visible:ring-inset"
      >
        <span
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-base"
          style={{
            background: `linear-gradient(135deg, rgba(${accent.rgb} / 0.25), rgba(${accent.rgb} / 0.1))`,
            border: `1px solid rgba(${accent.rgb} / ${isActive ? '0.5' : '0.25'})`,
            color: accent.bright,
          }}
        >
          {workspace.icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink truncate">{workspace.name}</p>
          {isActive && (
            <p className="text-[10px] truncate" style={{ color: accent.bright }}>
              {selection.mode === 'model' ? '• ' : ''}{subtitle}
            </p>
          )}
          {!isActive && (
            <p className="text-[10px] text-ink-subtle truncate">
              {workspace.description.split('.')[0]}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
          }}
          className="shrink-0 p-1 rounded hover:bg-surface-3 text-ink-subtle hover:text-ink transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hairline-strong"
          aria-label={expanded ? 'Hide selector' : 'Show selector'}
          aria-expanded={expanded}
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Inline selector — Combo / Model toggle + dropdown */}
      {expanded && (
        <div className="px-3 pb-3 -mt-0.5 space-y-2">
          {/*
            Mode toggle — surface-2 lift for the selected tab (per Linear
            pricing-tab-selected pattern). Mutually exclusive with the
            value selector below: switching mode resets the value to the
            first available option in the new mode.
          */}
          <div className="flex gap-1 bg-surface-2 border border-hairline rounded-md p-0.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (selection.mode === 'combo') return;
                const first = combos[0]?.slug ?? '';
                onSelectionChange({ mode: 'combo', value: first });
              }}
              className={`flex-1 px-2 py-1 text-[11px] font-medium rounded transition-all ${
                selection.mode === 'combo'
                  ? 'bg-surface-3 text-ink shadow-lift-1'
                  : 'text-ink-subtle hover:text-ink'
              }`}
            >
              Combo
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (selection.mode === 'model') return;
                // Pick the first available provider's first model. Falls
                // back to Prometheus + workspace fallback when no models
                // have loaded yet (rare race during initial mount).
                const firstProv = providers[0];
                const firstModel = firstProv?.models[0]?.id ?? workspace.fallbackModel;
                const firstId = firstProv?.id ?? '__prometheus__';
                onSelectionChange({ mode: 'model', providerId: firstId, value: firstModel });
              }}
              className={`flex-1 px-2 py-1 text-[11px] font-medium rounded transition-all ${
                selection.mode === 'model'
                  ? 'bg-surface-3 text-ink shadow-lift-1'
                  : 'text-ink-subtle hover:text-ink'
              }`}
            >
              Model
            </button>
          </div>

          {/* Combo dropdown */}
          {selection.mode === 'combo' && (
            <>
              <label className="sr-only" htmlFor={`combo-${workspace.id}`}>
                Combo for {workspace.name}
              </label>
              <select
                id={`combo-${workspace.id}`}
                value={selection.value}
                onChange={(e) => onSelectionChange({ mode: 'combo', value: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="w-full px-2 py-1.5 bg-canvas border border-hairline rounded-md text-xs text-ink focus:outline-none focus:border-hairline-strong focus:ring-2 focus:ring-accent/40"
              >
                {combos.length === 0 ? (
                  <option value="" disabled>
                    No combos in this category yet
                  </option>
                ) : (
                  combos.map((c) => (
                    <option key={c.id} value={c.slug}>
                      {c.icon} {c.name}
                    </option>
                  ))
                )}
              </select>
              {combos.length === 0 && (
                <p className="text-[10px] text-ink-subtle">
                  Switch to <span className="text-ink-muted font-medium">Model</span> tab, or add combos in <span className="text-ink-muted">Settings</span>
                </p>
              )}
            </>
          )}

          {/* Model selector — provider chips + filtered model dropdown */}
          {selection.mode === 'model' && (
            <>
              {/*
                Provider chips. Only render when user has 2+ providers
                (e.g. just Prometheus = chips redundant). Each chip filters
                the dropdown to that provider's models so the list stays
                short instead of becoming a 50-item scroll.
              */}
              {providers.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {providers.map((p) => {
                    const isActiveProvider = selection.providerId === p.id;
                    const isShared = p.shared === true;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isActiveProvider) return;
                          const next = firstModelOf(p.id);
                          if (next) {
                            onSelectionChange({
                              mode: 'model',
                              providerId: next.providerId,
                              value: next.id,
                            });
                          }
                        }}
                        disabled={p.models.length === 0}
                        className={`px-2 py-0.5 text-[11px] font-medium rounded-full border transition-all inline-flex items-center gap-1 ${
                          isActiveProvider
                            ? 'bg-accent text-white border-accent'
                            : 'bg-surface-2 text-ink-subtle border-hairline hover:text-ink hover:border-hairline-strong'
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                        title={
                          p.models.length === 0
                            ? 'No models — refresh in Settings'
                            : isShared
                              ? `Shared free tier — ${p.models.length} models`
                              : `${p.models.length} models`
                        }
                      >
                        <span>{p.name}</span>
                        {isShared && (
                          <span
                            className={`text-[9px] px-1 py-px rounded font-semibold uppercase tracking-wide ${
                              isActiveProvider
                                ? 'bg-white/20 text-white'
                                : 'bg-success/15 text-success'
                            }`}
                          >
                            free
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <label className="sr-only" htmlFor={`model-${workspace.id}`}>
                Model for {workspace.name}
              </label>
              <select
                id={`model-${workspace.id}`}
                value={selection.value}
                onChange={(e) =>
                  onSelectionChange({
                    mode: 'model',
                    providerId: selection.providerId,
                    value: e.target.value,
                  })
                }
                onClick={(e) => e.stopPropagation()}
                className="w-full px-2 py-1.5 bg-canvas border border-hairline rounded-md text-xs text-ink focus:outline-none focus:border-hairline-strong focus:ring-2 focus:ring-accent/40"
              >
                {(activeProvider?.models ?? []).length === 0 ? (
                  <option value={workspace.fallbackModel}>{formatModelDisplay(workspace.fallbackModel)}</option>
                ) : (
                  (activeProvider?.models ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName || formatModelDisplay(m.id)}
                    </option>
                  ))
                )}
              </select>
              <p className="text-[10px] text-ink-subtle">
                {providers.length > 1
                  ? `Direct model from ${activeProvider?.name ?? 'provider'} — no fallback chain`
                  : 'Direct model selection — no fallback chain'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
