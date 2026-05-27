'use client';

/**
 * Inline share settings — collapsed by default per provider row.
 *
 * When admin clicks "Share", reveals a panel:
 *   - Toggle: "Share with all users" (isShared)
 *   - Multi-checkbox: pick which models to expose (sharedModels)
 *
 * Save patterns:
 *   - Toggle off: writes isShared=false (sharedModels untouched, kept
 *     for next time admin re-enables sharing).
 *   - Toggle on with empty selection: blocked locally (warns user).
 *     Server-side same constraint enforced via empty-array filter
 *     in /api/providers GET.
 *   - Selection change: optimistic local state, debounced save on close.
 *
 * Only owner sees this panel — the API rejects PUT from non-owners,
 * but we also hide the affordance on `shared:true` rows in the
 * settings provider list to avoid confusion.
 */

import { useState } from 'react';
import { Button } from '@/components/Button';
import { useAppDispatch } from '@/lib/store/hooks';
import { showToast } from '@/lib/store/slices/uiSlice';
import {
  useUpdateProviderMutation,
  type Provider,
} from '@/lib/store/api/providersApi';
import { formatModelDisplay } from '@/lib/format-model';

interface Props {
  provider: Provider;
}

export function ProviderShareSettings({ provider }: Props) {
  const dispatch = useAppDispatch();
  const [updateProvider, { isLoading }] = useUpdateProviderMutation();
  const [expanded, setExpanded] = useState(false);

  // Parse current state from provider row
  const allModels: string[] = (() => {
    try { return JSON.parse(provider.models || '[]'); } catch { return []; }
  })();
  const initialShared: string[] = (() => {
    try { return JSON.parse(provider.sharedModels || '[]'); } catch { return []; }
  })();

  const [isShared, setIsShared] = useState(provider.isShared ?? false);
  const [selected, setSelected] = useState<string[]>(initialShared);
  // Quick filter — provider lists can be 26+ models, suggesting :free
  // matches first since the typical share is a free-tier subset.
  const [filter, setFilter] = useState('');

  const filteredModels = allModels.filter((m) =>
    m.toLowerCase().includes(filter.toLowerCase()),
  );

  const sortedModels = filteredModels.slice().sort((a, b) => {
    // :free models float to the top — most common share use case
    const aFree = a.includes(':free') ? 0 : 1;
    const bFree = b.includes(':free') ? 0 : 1;
    if (aFree !== bFree) return aFree - bFree;
    return a.localeCompare(b);
  });

  const toggleModel = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectAllFree = () => {
    const freeOnly = allModels.filter((m) => m.includes(':free'));
    setSelected(freeOnly);
  };

  const clearAll = () => setSelected([]);

  const handleSave = async () => {
    if (isShared && selected.length === 0) {
      dispatch(showToast({
        type: 'error',
        message: 'Pick at least one model to share, or disable sharing first',
      }));
      return;
    }
    try {
      await updateProvider({
        id: provider.id,
        isShared,
        sharedModels: selected,
      }).unwrap();
      dispatch(showToast({
        type: 'success',
        message: isShared
          ? `Sharing ${selected.length} model${selected.length !== 1 ? 's' : ''} with all users`
          : 'Sharing disabled',
      }));
      setExpanded(false);
    } catch (err) {
      const msg = (err as { data?: { error?: string } })?.data?.error ?? 'Save failed';
      dispatch(showToast({ type: 'error', message: msg }));
    }
  };

  // Status pill above the affordance — at-a-glance state.
  const statusPill = provider.isShared && initialShared.length > 0 ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-success/15 text-success border border-success/40 rounded-full uppercase tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-success" />
      Shared · {initialShared.length}
    </span>
  ) : null;

  return (
    <div className="border-t border-hairline">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-2 flex items-center justify-between text-xs text-ink-subtle hover:text-ink hover:bg-surface-2 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span>Share with users</span>
          {statusPill}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-4 pt-2 space-y-3 bg-surface-2/50">
          {/* Master toggle */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-accent"
            />
            <div className="flex-1">
              <p className="text-sm text-ink font-medium">Share selected models with all approved users</p>
              <p className="text-[11px] text-ink-subtle mt-0.5 leading-relaxed">
                Other users will see these models under <span className="text-ink-muted">{provider.name}</span> in
                their workspace picker. Requests dispatch through your encrypted API key —
                <span className="text-amber-300"> your quota gets burned</span>.
                Pick free-tier models only unless you want to subsidize others.
              </p>
            </div>
          </label>

          {isShared && (
            <>
              {/* Quick actions */}
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter models…"
                  className="flex-1 min-w-[140px] px-2 py-1 bg-canvas border border-hairline rounded text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-hairline-strong focus:ring-2 focus:ring-accent/40"
                />
                <button
                  type="button"
                  onClick={selectAllFree}
                  className="text-[11px] px-2 py-1 rounded bg-success/10 hover:bg-success/20 text-success border border-success/30 font-medium transition-colors"
                  title="Select every model whose id contains ':free'"
                >
                  All :free
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-[11px] px-2 py-1 rounded bg-surface-3 hover:bg-surface-4 text-ink-subtle border border-hairline font-medium transition-colors"
                >
                  Clear
                </button>
                <span className="text-[11px] text-ink-subtle">
                  {selected.length} / {allModels.length} selected
                </span>
              </div>

              {/* Model list */}
              <div className="max-h-56 overflow-y-auto bg-canvas border border-hairline rounded-md p-2 space-y-0.5">
                {sortedModels.length === 0 ? (
                  <p className="text-xs text-ink-subtle text-center py-4">
                    No models match &ldquo;{filter}&rdquo;
                  </p>
                ) : (
                  sortedModels.map((m) => {
                    const isSelected = selected.includes(m);
                    const isFree = m.includes(':free');
                    return (
                      <label
                        key={m}
                        className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors ${
                          isSelected ? 'bg-accent/15' : 'hover:bg-surface-2'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleModel(m)}
                          className="w-3.5 h-3.5 accent-accent"
                        />
                        <span className="text-xs text-ink flex-1 truncate" title={m}>
                          {formatModelDisplay(m)}
                        </span>
                        {isFree && (
                          <span className="text-[9px] px-1 py-px rounded bg-success/15 text-success font-semibold uppercase tracking-wide">
                            free
                          </span>
                        )}
                        <span className="text-[10px] text-ink-subtle font-mono">{m}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </>
          )}

          <div className="flex items-center gap-2">
            <Button onClick={handleSave} loading={isLoading} variant="primary" size="sm">
              {isShared ? 'Save share settings' : 'Disable sharing'}
            </Button>
            <Button
              onClick={() => {
                setIsShared(provider.isShared ?? false);
                setSelected(initialShared);
                setFilter('');
                setExpanded(false);
              }}
              variant="ghost"
              size="sm"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
