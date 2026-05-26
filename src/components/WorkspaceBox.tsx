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
 *   - mode 'model': value = model id (e.g. "kiro/claude-opus-4.7")
 */
export type WorkspaceSelection =
  | { mode: 'combo'; value: string }
  | { mode: 'model'; value: string };

interface Props {
  workspace: WorkspaceDef;
  /** Combos available for this workspace (filtered to matching category) */
  combos: WorkspaceComboLike[];
  /** All models available (used by the Model picker) */
  models: WorkspaceModelLike[];
  /** Current selection — combo slug or raw model id */
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
  models,
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
  const currentModel = selection.mode === 'model'
    ? models.find((m) => m.id === selection.value)
    : null;
  const subtitle = currentCombo?.name
    ?? currentModel?.displayName
    ?? workspace.fallbackModel;

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
                const first = models[0]?.id ?? workspace.fallbackModel;
                onSelectionChange({ mode: 'model', value: first });
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

          {/* Model dropdown */}
          {selection.mode === 'model' && (
            <>
              <label className="sr-only" htmlFor={`model-${workspace.id}`}>
                Model for {workspace.name}
              </label>
              <select
                id={`model-${workspace.id}`}
                value={selection.value}
                onChange={(e) => onSelectionChange({ mode: 'model', value: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="w-full px-2 py-1.5 bg-canvas border border-hairline rounded-md text-xs text-ink focus:outline-none focus:border-hairline-strong focus:ring-2 focus:ring-accent/40 font-mono"
              >
                {models.length === 0 ? (
                  <option value={workspace.fallbackModel}>{workspace.fallbackModel}</option>
                ) : (
                  models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName} ({m.id})
                    </option>
                  ))
                )}
              </select>
              <p className="text-[10px] text-ink-subtle">
                Direct model selection — no fallback chain
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
