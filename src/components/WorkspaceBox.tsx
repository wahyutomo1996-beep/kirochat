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

  return (
    <div
      className={`group/ws rounded-xl border transition-all overflow-hidden ${
        isActive
          ? 'bg-surface-2 border-edge-hover shadow-sm'
          : 'bg-surface-1 border-edge hover:border-edge-hover hover:bg-surface-2'
      }`}
    >
      <button
        type="button"
        onClick={onActivate}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <span className="text-base shrink-0">{workspace.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{workspace.name}</p>
          <p className="text-[10px] text-txt-muted truncate">
            {currentCombo ? (
              <>
                <span className="text-purple-300/80">{currentCombo.name}</span>
              </>
            ) : (
              <span>No combo · raw model</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="shrink-0 p-1 rounded hover:bg-surface-3 text-txt-muted hover:text-white transition-colors"
          aria-label="Toggle combo selector"
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
      </button>

      {/* Inline combo selector */}
      {expanded && (
        <div className="px-3 pb-2.5 -mt-0.5">
          <select
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
