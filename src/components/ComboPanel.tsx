'use client';

/**
 * ComboPanel - dropdown UI for managing model combos.
 *
 * Mounted as a section in Settings page. Users can:
 *   - Browse pre-built templates (coding-premium, trading-realtime, etc)
 *   - Instantiate templates into their own list
 *   - Create custom combos with picker (provider + model per step)
 *   - Edit / delete / activate-deactivate combos
 *
 * The picker pulls available providers + models from the providers list
 * (which already includes the built-in Prometheus virtual provider).
 */

import { useState } from 'react';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { useAppDispatch } from '@/lib/store/hooks';
import { showToast } from '@/lib/store/slices/uiSlice';
import {
  useListCombosQuery,
  useListComboTemplatesQuery,
  useInstantiateTemplateMutation,
  useDeleteComboMutation,
  useUpdateComboMutation,
  useCreateComboMutation,
  type Combo,
  type ComboStep,
  type ComboTemplate,
} from '@/lib/store/api/combosApi';
import type { Provider } from '@/lib/store/api/providersApi';

interface Props {
  /** All available providers including built-in Prometheus */
  providers: Provider[];
}

const CATEGORY_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'coding', label: '\u{1F4BB} Coding' },
  { value: 'trading', label: '\u{1F4C8} Trading' },
  { value: 'research', label: '\u{1F4DA} Research' },
  { value: 'general', label: '\u2728 General' },
];

export function ComboPanel({ providers }: Props) {
  const dispatch = useAppDispatch();

  const { data: combosData, isLoading: combosLoading } = useListCombosQuery();
  const { data: templatesData } = useListComboTemplatesQuery();

  const [instantiate] = useInstantiateTemplateMutation();
  const [deleteCombo] = useDeleteComboMutation();
  const [updateCombo] = useUpdateComboMutation();
  const [createCombo, { isLoading: creating }] = useCreateComboMutation();

  const [showTemplates, setShowTemplates] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');

  // Custom combo form state
  const [customForm, setCustomForm] = useState<{
    name: string;
    description: string;
    icon: string;
    category: string;
    steps: ComboStep[];
  }>({
    name: '',
    description: '',
    icon: '\u26A1',
    category: 'custom',
    steps: [{ providerId: '', model: '' }],
  });

  const combos = combosData?.combos ?? [];
  const templates = templatesData?.templates ?? [];
  const filteredTemplates =
    categoryFilter === 'all'
      ? templates
      : templates.filter((t) => t.category === categoryFilter);

  const handleInstantiate = async (slug: string) => {
    try {
      const result = await instantiate(slug).unwrap();
      dispatch(showToast({ type: 'success', message: `Added: ${result.combo.name}` }));
      setShowTemplates(false);
    } catch (err) {
      const data = (err as { data?: { error?: string } })?.data;
      dispatch(showToast({ type: 'error', message: data?.error ?? 'Failed to add combo' }));
    }
  };

  const handleDelete = async (combo: Combo) => {
    if (!confirm(`Delete combo "${combo.name}"?`)) return;
    try {
      await deleteCombo(combo.id).unwrap();
      dispatch(showToast({ type: 'success', message: 'Combo deleted' }));
    } catch {
      dispatch(showToast({ type: 'error', message: 'Delete failed' }));
    }
  };

  const handleToggleActive = async (combo: Combo) => {
    try {
      await updateCombo({ id: combo.id, isActive: !combo.isActive }).unwrap();
    } catch {
      dispatch(showToast({ type: 'error', message: 'Toggle failed' }));
    }
  };

  const handleCreateCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    const validSteps = customForm.steps.filter((s) => s.providerId && s.model);
    if (validSteps.length === 0) {
      dispatch(showToast({ type: 'error', message: 'Add at least one valid step' }));
      return;
    }
    if (!customForm.name.trim()) {
      dispatch(showToast({ type: 'error', message: 'Name required' }));
      return;
    }
    try {
      const result = await createCombo({
        name: customForm.name.trim(),
        description: customForm.description,
        icon: customForm.icon,
        category: customForm.category,
        steps: validSteps,
      }).unwrap();
      dispatch(showToast({ type: 'success', message: `Created: ${result.combo.name}` }));
      setShowCustom(false);
      setCustomForm({
        name: '',
        description: '',
        icon: '\u26A1',
        category: 'custom',
        steps: [{ providerId: '', model: '' }],
      });
    } catch (err) {
      const data = (err as { data?: { error?: string } })?.data;
      dispatch(showToast({ type: 'error', message: data?.error ?? 'Failed to create' }));
    }
  };

  const updateStep = (index: number, patch: Partial<ComboStep>) => {
    setCustomForm((f) => ({
      ...f,
      steps: f.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  };

  const addStep = () => {
    if (customForm.steps.length >= 10) return;
    setCustomForm((f) => ({ ...f, steps: [...f.steps, { providerId: '', model: '' }] }));
  };

  const removeStep = (index: number) => {
    setCustomForm((f) => ({
      ...f,
      steps: f.steps.length > 1 ? f.steps.filter((_, i) => i !== index) : f.steps,
    }));
  };

  // Models available per provider, used in step picker
  const getProviderModels = (providerId: string): string[] => {
    const p = providers.find((p) => p.id === providerId);
    if (!p) return [];
    try {
      return JSON.parse(p.models || '[]');
    } catch {
      return [];
    }
  };

  if (combosLoading) {
    return (
      <div className="bg-surface-1 border border-edge rounded-xl p-6 mb-6">
        <p className="text-txt-muted text-sm">Loading combos...</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-1 border border-edge rounded-xl overflow-hidden mb-6 animate-slide-up">
      {/* Header */}
      <div className="px-5 py-4 border-b border-edge flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white inline-flex items-center gap-2">
            Model Combos
            <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/15 border border-blue-500/30 text-blue-300 rounded font-bold uppercase tracking-wider">
              Auto-fallback
            </span>
          </h2>
          <p className="text-xs text-txt-muted mt-0.5">
            {combos.length} combos · ordered chains of (provider, model) tried in sequence with auto-fallback on rate-limit
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setShowTemplates(!showTemplates);
              setShowCustom(false);
            }}
            variant={showTemplates ? 'secondary' : 'outline'}
            size="sm"
          >
            {showTemplates ? 'Cancel' : 'From Template'}
          </Button>
          <Button
            onClick={() => {
              setShowCustom(!showCustom);
              setShowTemplates(false);
            }}
            variant="primary"
            size="sm"
          >
            {showCustom ? 'Cancel' : '+ Custom Combo'}
          </Button>
        </div>
      </div>

      {/* Template browser */}
      {showTemplates && (
        <div className="px-5 py-4 border-b border-edge bg-surface-2">
          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            {CATEGORY_FILTERS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategoryFilter(c.value)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
                  categoryFilter === c.value
                    ? 'bg-surface-2 text-ink border border-hairline-strong'
                    : 'text-ink-subtle hover:text-ink border border-hairline hover:border-hairline-strong'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {filteredTemplates.map((tpl: ComboTemplate) => (
              <div
                key={tpl.slug}
                className="bg-surface-1 border border-edge rounded-lg p-3 hover:border-edge-hover transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      <span className="mr-1.5">{tpl.icon}</span>
                      {tpl.name}
                    </p>
                    <p className="text-[11px] text-txt-muted mt-0.5 leading-snug">{tpl.description}</p>
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      {tpl.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 bg-surface-2 border border-edge rounded text-txt-faint"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button
                    onClick={() => handleInstantiate(tpl.slug)}
                    variant="ghost"
                    size="xs"
                  >
                    Add
                  </Button>
                </div>
                <details className="mt-2 group/steps">
                  <summary className="cursor-pointer text-[11px] text-txt-muted hover:text-white">
                    {tpl.steps.length} steps
                  </summary>
                  <ol className="mt-1 space-y-0.5 pl-3 list-decimal text-[11px] text-txt-secondary">
                    {tpl.steps.map((s, i) => (
                      <li key={i} className="font-mono truncate">
                        {s.label || s.model}
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Custom combo form */}
      {showCustom && (
        <div className="px-5 py-4 border-b border-edge bg-surface-2">
          <form onSubmit={handleCreateCustom} className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-txt-muted mb-1 uppercase tracking-wider">
                  Name
                </label>
                <input
                  type="text"
                  value={customForm.name}
                  onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                  placeholder="e.g. My Coding Stack"
                  required
                  className="w-full px-2.5 py-1.5 bg-surface-1 border border-edge rounded text-sm text-white focus:outline-none focus:border-edge-hover"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-txt-muted mb-1 uppercase tracking-wider">
                  Category
                </label>
                <select
                  value={customForm.category}
                  onChange={(e) => setCustomForm({ ...customForm, category: e.target.value })}
                  className="w-full px-2 py-1.5 bg-surface-1 border border-edge rounded text-sm text-white focus:outline-none focus:border-edge-hover"
                >
                  <option value="coding">Coding</option>
                  <option value="trading">Trading</option>
                  <option value="research">Research</option>
                  <option value="general">General</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-txt-muted mb-1 uppercase tracking-wider">
                Description (optional)
              </label>
              <input
                type="text"
                value={customForm.description}
                onChange={(e) => setCustomForm({ ...customForm, description: e.target.value })}
                placeholder="Quick fallback chain for daily Python work"
                className="w-full px-2.5 py-1.5 bg-surface-1 border border-edge rounded text-sm text-white focus:outline-none focus:border-edge-hover"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-txt-muted mb-1.5 uppercase tracking-wider">
                Steps (tried in order, falls back on rate-limit / quota)
              </label>
              <div className="space-y-1.5">
                {customForm.steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="text-[11px] text-txt-faint w-5 text-right">{i + 1}.</span>
                    <select
                      value={step.providerId}
                      onChange={(e) => updateStep(i, { providerId: e.target.value, model: '' })}
                      className="flex-1 px-2 py-1.5 bg-surface-1 border border-edge rounded text-sm text-white focus:outline-none focus:border-edge-hover"
                    >
                      <option value="">— Select provider —</option>
                      {providers
                        .filter((p) => p.isActive !== false)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}{p.builtin ? ' (built-in)' : ''}
                          </option>
                        ))}
                    </select>
                    <select
                      value={step.model}
                      onChange={(e) => updateStep(i, { model: e.target.value })}
                      disabled={!step.providerId}
                      className="flex-[2] px-2 py-1.5 bg-surface-1 border border-edge rounded text-sm text-white focus:outline-none focus:border-edge-hover disabled:opacity-40"
                    >
                      <option value="">— Select model —</option>
                      {getProviderModels(step.providerId).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      onClick={() => removeStep(i)}
                      variant="ghost"
                      size="xs"
                      disabled={customForm.steps.length === 1}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                onClick={addStep}
                variant="ghost"
                size="xs"
                disabled={customForm.steps.length >= 10}
                className="mt-1.5"
              >
                + Add step
              </Button>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="submit" loading={creating} variant="primary" size="sm">
                Save Combo
              </Button>
              <Button type="button" onClick={() => setShowCustom(false)} variant="secondary" size="sm">
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Combo list */}
      {combos.length === 0 && !showTemplates && !showCustom ? (
        <div className="px-5 py-12 text-center">
          <p className="text-white text-sm font-medium">No combos yet</p>
          <p className="text-txt-muted text-xs mt-1">
            Pick a template above to get started — or create a custom chain
          </p>
        </div>
      ) : (
        <div className="divide-y divide-edge">
          {combos.map((combo) => (
            <div key={combo.id} className="px-5 py-3 hover:bg-surface-2 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-base">{combo.icon}</span>
                    <span className="text-sm font-medium text-white truncate">{combo.name}</span>
                    <Badge variant={combo.isActive ? 'success' : 'default'}>
                      {combo.category}
                    </Badge>
                    {!combo.isActive && <Badge variant="danger">disabled</Badge>}
                  </div>
                  {combo.description && (
                    <p className="text-[11px] text-txt-muted leading-snug">{combo.description}</p>
                  )}
                  <p className="text-[10px] text-txt-faint mt-1 font-mono">slug: {combo.slug}</p>
                  <details className="mt-1 group/comb">
                    <summary className="cursor-pointer text-[11px] text-txt-muted hover:text-white">
                      {combo.steps.length} steps
                    </summary>
                    <ol className="mt-1 space-y-0.5 pl-3 list-decimal text-[11px] text-txt-secondary">
                      {combo.steps.map((s, i) => (
                        <li key={i} className="font-mono">
                          <span className="text-txt-faint">{s.providerId === '__prometheus__' ? 'Prometheus' : s.providerId.slice(0, 8)}</span>
                          {' / '}
                          <span className="text-white">{s.model}</span>
                          {s.label && <span className="text-txt-faint"> — {s.label}</span>}
                        </li>
                      ))}
                    </ol>
                  </details>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    onClick={() => handleToggleActive(combo)}
                    variant={combo.isActive ? 'outline' : 'secondary'}
                    size="xs"
                  >
                    {combo.isActive ? 'Disable' : 'Enable'}
                  </Button>
                  <Button onClick={() => handleDelete(combo)} variant="danger" size="xs">
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
