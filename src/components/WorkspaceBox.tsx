'use client';

/**
 * WorkspaceBox - sidebar tile representing a chat workspace.
 *
 * Each box has:
 *   - Icon + name header (clickable, starts a fresh chat in this workspace)
 *   - Combo dropdown (collapsed by default, click chevron to expand)
 *   - Active state styling when this is the current workspace
 *
 * Click on the body (not chevron) -> activate workspace + start new chat.
 * Click on chevron -> toggle combo selector inline.
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
  general: { rgb: '99 102 241', bright: 'hsl(240, 80%, 72%)' },
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

interface Props {
  workspace: WorkspaceDef;
  /** Combos available for this workspace (filtered to matching category) */
  combos: WorkspaceComboLike[];
  /** Currently selected combo slug for this workspace, '' = use raw model */
  selectedComboSlug: string;
  /** True if this workspace is the active one in chat */
  isActive: boolean;
  /** Called when user clicks the box (start fresh chat in this ws) */
  onActivate: () => void;
  /** Called when user picks a different combo for this workspace */
  onComboChange: (slug: string) => void;
}

export function WorkspaceBox({
  workspace,
  combos,
  selectedComboSlug,
  isActive,
  onActivate,
  onComboChange,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const currentCombo = combos.find((c) => c.slug === selectedComboSlug);
  const accent = WORKSPACE_ACCENT[workspace.id] ?? WORKSPACE_ACCENT.general;

  return (
    <div
      style={
        isActive
          ? {
              // Active state: gradient bg + glow shadow tinted by workspace color.
              // We compute styles inline because each workspace has its own accent
              // and Tailwind doesn't dynamically interpolate arbitrary color values.
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
      {/*
        Activate region uses a div with role=button instead of <button>
        because we nest a separate chevron button inside, and nested
        <button> is invalid HTML. Keyboard accessible via tabIndex + onKeyDown.
      */}
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
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-edge-hover/60 focus-visible:ring-inset"
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
          <p className="text-sm font-medium text-white truncate">{workspace.name}</p>
          {/* Only show combo subtitle when this workspace is active.
              Inactive workspaces just show the name - keeps the sidebar
              quiet so the active one stands out. */}
          {isActive && currentCombo && (
            <p className="text-[10px] truncate" style={{ color: accent.bright }}>
              {currentCombo.name}
            </p>
          )}
          {!isActive && (
            <p className="text-[10px] text-txt-faint truncate">
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
            // Prevent Space/Enter from bubbling to the parent activator
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
          }}
          className="shrink-0 p-1 rounded hover:bg-surface-3 text-txt-muted hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-edge-hover/60"
          aria-label={expanded ? 'Hide combo selector' : 'Show combo selector'}
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

      {/* Inline combo selector */}
      {expanded && (
        <div className="px-3 pb-2.5 -mt-0.5">
          <label className="sr-only" htmlFor={`combo-${workspace.id}`}>
            Combo for {workspace.name}
          </label>
          <select
            id={`combo-${workspace.id}`}
            value={selectedComboSlug}
            onChange={(e) => onComboChange(e.target.value)}
            className="w-full px-2 py-1.5 bg-surface-0 border border-edge rounded text-xs text-white focus:outline-none focus:border-edge-hover"
          >
            <option value="">{workspace.fallbackModel} (raw)</option>
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
            <p className="text-[10px] text-txt-faint mt-1">
              Add combos in <span className="text-txt-muted">Settings → Combos</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
