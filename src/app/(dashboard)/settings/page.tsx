'use client';

/**
 * Settings page — showcases RTK Query integration.
 *
 * What changed vs the manual-fetch version:
 *   - Server data: `useListProvidersQuery`, `useListKiroAccountsQuery`,
 *     `useGetKiroUsageQuery`, `useGetApiKeyQuery` — automatic caching,
 *     deduping, refetch-on-focus, polling for live credit display.
 *   - Mutations: `useAddKiroAccountMutation`, `useDeleteKiroAccountMutation`,
 *     `useReactivateKiroAccountMutation`, etc — automatic tag invalidation
 *     so the list/stats refresh without manual refetch wiring.
 *   - User feedback: `dispatch(showToast(...))` instead of inline message
 *     state — toasts auto-dismiss and live in a single global container.
 *
 * Local state is still useState — form input, modal open/close, key visibility.
 * That's pure UI state with no server backing, so it doesn't belong in Redux.
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Badge } from '@/components/Badge';
import { LoadingState } from '@/components/LoadingState';
import { TokenDetector } from '@/components/TokenDetector';
import { ComboPanel } from '@/components/ComboPanel';
import { KiroUsageTracker } from '@/components/KiroUsageTracker';
import { useAppDispatch } from '@/lib/store/hooks';
import { showToast } from '@/lib/store/slices/uiSlice';
import {
  useListKiroAccountsQuery,
  useGetKiroUsageQuery,
  useAddKiroAccountMutation,
  useDeleteKiroAccountMutation,
  useReactivateKiroAccountMutation,
} from '@/lib/store/api/kiroAccountsApi';
import {
  useListProvidersQuery,
  useCreateProviderMutation,
  useDeleteProviderMutation,
  useUpdateProviderMutation,
  useRefreshProviderModelsMutation,
} from '@/lib/store/api/providersApi';
import {
  useGetApiKeyQuery,
  useRegenerateApiKeyMutation,
} from '@/lib/store/api/apiKeyApi';

const PRESETS = [
  { name: 'WIR Cloud', baseUrl: 'http://137.184.195.229:3000/v1' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { name: 'Together AI', baseUrl: 'https://api.together.xyz/v1' },
];

/** 1234 -> "1.2K", 1234567 -> "1.2M" */
function formatTokens(n: number): string {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '') + 'K';
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, '') + 'M';
}

export default function SettingsPage() {
  const dispatch = useAppDispatch();

  // ───────────────────────── server data via RTK Query ──────────────────────
  const { data: providersData, isLoading: providersLoading } = useListProvidersQuery();
  const { data: kiroData, isLoading: kiroLoading } = useListKiroAccountsQuery();
  // Poll usage every 30s for live credit display. Component-level config
  // beats a global polling interval — only this page needs it.
  const { data: usageData } = useGetKiroUsageQuery(undefined, { pollingInterval: 30_000 });
  const { data: apiKeyData, isLoading: apiKeyLoading } = useGetApiKeyQuery();

  const providers = providersData?.providers ?? [];
  const kiroAccounts = kiroData?.accounts ?? [];
  const kiroStats = usageData?.accounts ?? [];
  const kiroSummary = usageData?.summary ?? null;

  // The server only stores the SHA-256 hash of API keys, so plain key is
  // returned ONLY at first-mint or regenerate. We persist it in local
  // state across re-renders so Show/Copy keep working until the user
  // navigates away. This buffer is never written to disk.
  const [freshKey, setFreshKey] = useState<string | null>(null);

  // Capture the plain key on first-mint (when GET /api/api-key auto-mints
  // a new key for a user that doesn't have one yet). RTK Query will refetch
  // on focus and the server will return null next time, so we have to grab
  // it the moment we see it.
  useEffect(() => {
    if (apiKeyData?.apiKey && apiKeyData.isNew && !freshKey) {
      setFreshKey(apiKeyData.apiKey);
    }
  }, [apiKeyData?.apiKey, apiKeyData?.isNew, freshKey]);

  // Fall through priority: locally-cached fresh key, then any plain key
  // RTK Query happens to have (first-mint case before useEffect above runs).
  const apiKey = freshKey ?? apiKeyData?.apiKey ?? '';
  const hasStoredKey = Boolean(apiKey || apiKeyData?.hasKey);

  // ───────────────────────── mutations ──────────────────────────────────────
  const [addKiro, { isLoading: addingKiro }] = useAddKiroAccountMutation();
  const [deleteKiro] = useDeleteKiroAccountMutation();
  const [reactivateKiro] = useReactivateKiroAccountMutation();
  const [createProvider, { isLoading: creatingProvider }] = useCreateProviderMutation();
  const [deleteProvider] = useDeleteProviderMutation();
  const [updateProvider] = useUpdateProviderMutation();
  const [refreshModels] = useRefreshProviderModelsMutation();
  const [regenerateKey] = useRegenerateApiKeyMutation();

  // ───────────────────────── local UI state ─────────────────────────────────
  const [keyVisible, setKeyVisible] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showDetector, setShowDetector] = useState(false);
  const [showAddKiro, setShowAddKiro] = useState(false);
  const [kiroTokenInput, setKiroTokenInput] = useState('');
  const [form, setForm] = useState({ name: '', type: 'api_key', baseUrl: '', apiKey: '' });

  const initialLoad = providersLoading || kiroLoading || apiKeyLoading;
  if (initialLoad) return <LoadingState fullScreen />;

  // ───────────────────────── handlers ───────────────────────────────────────
  const handleRegenerateKey = async () => {
    if (!confirm('Regenerate your API key? All clients using the old key will stop working.')) return;
    try {
      const result = await regenerateKey().unwrap();
      if (result.apiKey) {
        // Stash the plain key in local state so Show/Copy keep working
        // even after the GET query refetches (server returns null after).
        setFreshKey(result.apiKey);
        setKeyVisible(true);
        dispatch(showToast({
          type: 'success',
          message: 'API key regenerated — copy it now, it won\u2019t be shown again',
          duration: 8000,
        }));
      }
    } catch {
      dispatch(showToast({ type: 'error', message: 'Failed to regenerate key' }));
    }
  };

  const handleCopy = async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      dispatch(showToast({ type: 'success', message: `${label} copied to clipboard` }));
    } catch {
      dispatch(showToast({ type: 'error', message: 'Failed to copy' }));
    }
  };

  const handleAddKiro = async () => {
    if (!kiroTokenInput.trim()) {
      dispatch(showToast({ type: 'error', message: 'Refresh token required' }));
      return;
    }
    try {
      const result = await addKiro({ refreshToken: kiroTokenInput.trim() }).unwrap();
      const parts: string[] = [];
      if (result.total > 0) parts.push(`Added ${result.total} account(s)`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} failed`);
      dispatch(
        showToast({
          type: result.total > 0 ? 'success' : 'error',
          message: parts.join(', ') || 'Done',
        }),
      );
      setKiroTokenInput('');
      setShowAddKiro(false);
    } catch (err) {
      const message =
        (err as { data?: { error?: string } })?.data?.error ?? 'Failed to add account';
      dispatch(showToast({ type: 'error', message }));
    }
  };

  const handleRemoveKiro = async (id: string) => {
    if (!confirm('Remove this Kiro account?')) return;
    try {
      await deleteKiro(id).unwrap();
      dispatch(showToast({ type: 'success', message: 'Account removed' }));
    } catch {
      dispatch(showToast({ type: 'error', message: 'Failed to remove account' }));
    }
  };

  const handleReactivate = async (id: string) => {
    try {
      await reactivateKiro(id).unwrap();
      dispatch(
        showToast({ type: 'success', message: 'Account revived — Kiro accepted the refresh token' }),
      );
    } catch (err) {
      const data = (err as { data?: { error?: string; detail?: string } })?.data;
      const message = data?.error
        ? `${data.error}${data.detail ? ` (${String(data.detail).slice(0, 120)})` : ''}`
        : 'Reactivation failed';
      dispatch(showToast({ type: 'error', message }));
    }
  };

  const handleAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await createProvider(form).unwrap();
      dispatch(
        showToast({
          type: 'success',
          message: result.message || 'Provider berhasil ditambahkan',
        }),
      );
      setForm({ name: '', type: 'api_key', baseUrl: '', apiKey: '' });
      setShowAdd(false);
    } catch (err) {
      const message =
        (err as { data?: { error?: string } })?.data?.error ?? 'Failed to add provider';
      dispatch(showToast({ type: 'error', message }));
    }
  };

  const handleRefreshModels = async (id: string) => {
    try {
      const result = await refreshModels(id).unwrap();
      dispatch(
        showToast({ type: 'success', message: `Refreshed: ${result.count} models detected` }),
      );
    } catch (err) {
      const message =
        (err as { data?: { error?: string } })?.data?.error ?? 'Failed to refresh models';
      dispatch(showToast({ type: 'error', message }));
    }
  };

  const handleDeleteProvider = async (id: string) => {
    if (!confirm('Hapus provider ini?')) return;
    try {
      await deleteProvider(id).unwrap();
      dispatch(showToast({ type: 'success', message: 'Provider deleted' }));
    } catch {
      dispatch(showToast({ type: 'error', message: 'Failed to delete' }));
    }
  };

  const handleSetDefault = (id: string) => {
    void updateProvider({ id, isDefault: true });
  };

  const handleToggleActive = (id: string, isActive: boolean) => {
    void updateProvider({ id, isActive: !isActive });
  };

  // ───────────────────────── derived data ───────────────────────────────────
  const activeAccounts = kiroAccounts.filter((a) => a.status === 'active').length;
  const exhaustedAccounts = kiroAccounts.filter((a) => a.status === 'exhausted').length;
  const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/v1` : '/v1';
  // We can only show the plain key at first-mint / regenerate. Otherwise just
  // the masked placeholder, because the server stores only the hash.
  const maskedKey = hasStoredKey
    ? `pmt-${'\u2022'.repeat(40)} (regenerate to view)`
    : 'No key';

  return (
    <div className="min-h-screen bg-surface-0">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-fade-in">
          <div>
            <h1 className="text-2xl font-semibold text-white">Settings</h1>
            <p className="text-txt-muted text-sm mt-1">
              Manage your AI providers, Kiro accounts, and API access
            </p>
          </div>
          <a href="/chat">
            <Button variant="secondary" size="sm">
              ← Back to Chat
            </Button>
          </a>
        </div>

        {/* API Key Section */}
        <div className="bg-surface-1 border border-edge rounded-xl overflow-hidden mb-6 animate-slide-up">
          <div className="px-5 py-4 border-b border-edge">
            <h2 className="text-base font-semibold text-white">Your API Key</h2>
            <p className="text-xs text-txt-muted mt-0.5">
              Use Prometheus as a provider in any OpenAI-compatible client
            </p>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-txt-muted mb-1.5 uppercase tracking-wider">
                Base URL
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-surface-2 border border-edge rounded-lg text-sm text-white font-mono break-all">
                  {baseUrl}
                </code>
                <Button onClick={() => handleCopy(baseUrl, 'Base URL')} variant="ghost" size="sm">
                  Copy
                </Button>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-txt-muted mb-1.5 uppercase tracking-wider">
                API Key
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-surface-2 border border-edge rounded-lg text-sm text-white font-mono break-all">
                  {keyVisible && apiKey ? apiKey : maskedKey}
                </code>
                <Button
                  onClick={() => setKeyVisible(!keyVisible)}
                  variant="ghost"
                  size="sm"
                  disabled={!apiKey}
                >
                  {keyVisible ? 'Hide' : 'Show'}
                </Button>
                <Button
                  onClick={() => handleCopy(apiKey, 'API key')}
                  variant="ghost"
                  size="sm"
                  disabled={!apiKey}
                >
                  Copy
                </Button>
                <Button onClick={handleRegenerateKey} variant="outline" size="sm">
                  Regenerate
                </Button>
              </div>
              <p className="text-[11px] text-txt-faint mt-2">
                {apiKey
                  ? 'Save this key now — for security, the server stores only a hash and cannot show it again.'
                  : 'Your API key is hashed at rest. Use the Regenerate button to mint a new plain key.'}
                {' '}Set <code className="text-txt-secondary">OPENAI_API_KEY</code>{' '}
                and <code className="text-txt-secondary">OPENAI_BASE_URL</code> in any OpenAI-compatible client.
              </p>
            </div>
            <details className="group/sample">
              <summary className="cursor-pointer text-xs text-txt-muted hover:text-white inline-flex items-center gap-1">
                <svg className="w-3 h-3 transition-transform group-open/sample:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Sample code (Python / curl)
              </summary>
              <div className="mt-3 space-y-2">
                <pre className="text-[11px] bg-surface-2 border border-edge rounded p-3 overflow-x-auto text-txt-secondary font-mono">
                  <code>{`# Python (openai SDK)
from openai import OpenAI
client = OpenAI(api_key="${apiKey || 'pmt-...'}", base_url="${baseUrl}")
r = client.chat.completions.create(
    model="kiro/claude-opus-4.7",
    messages=[{"role": "user", "content": "Hello"}],
)
print(r.choices[0].message.content)`}</code>
                </pre>
                <pre className="text-[11px] bg-surface-2 border border-edge rounded p-3 overflow-x-auto text-txt-secondary font-mono">
                  <code>{`# curl
curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${apiKey || 'pmt-...'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "kiro/claude-opus-4.7",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}</code>
                </pre>
              </div>
            </details>
          </div>
        </div>

        {/* Kiro Account Pool */}
        <div className="bg-surface-1 border border-edge rounded-xl overflow-hidden mb-6 animate-slide-up">
          <div className="px-5 py-4 border-b border-edge flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white inline-flex items-center gap-2">
                Kiro Account Pool
                <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/15 border border-purple-500/30 text-purple-300 rounded font-bold uppercase tracking-wider">
                  Powers Prometheus
                </span>
              </h2>
              <p className="text-xs text-txt-muted mt-0.5">
                {activeAccounts} active · {exhaustedAccounts} exhausted · {kiroAccounts.length} total
                {' · '}
                <span className="text-txt-faint">
                  paste Kiro refresh tokens here — the built-in Prometheus provider auto-rotates between them
                </span>
              </p>
            </div>
            <Button onClick={() => setShowAddKiro(!showAddKiro)} variant="primary" size="sm">
              {showAddKiro ? 'Cancel' : '+ Add Account'}
            </Button>
          </div>

          {/* Live quota tracker — auto-refresh every 30s + manual refresh.
              Pool-wide summary only here; per-account breakdown below in
              the account list keeps the UI from duplicating identical info. */}
          {kiroAccounts.length > 0 && (
            <div className="px-5 py-3 border-b border-edge">
              <KiroUsageTracker showPerAccount={false} />
            </div>
          )}

          {showAddKiro && (
            <div className="px-5 py-4 border-b border-edge bg-surface-2">
              <label className="block text-[11px] font-semibold text-txt-muted mb-1.5 uppercase tracking-wider">
                Refresh Token (one per line)
              </label>
              <textarea
                value={kiroTokenInput}
                onChange={(e) => setKiroTokenInput(e.target.value)}
                placeholder="aorAAAAA..."
                rows={3}
                className="w-full px-3 py-2 bg-surface-1 border border-edge rounded-lg text-sm text-white font-mono focus:outline-none focus:border-edge-hover transition-colors"
              />
              <div className="flex gap-2 mt-3">
                <Button onClick={handleAddKiro} loading={addingKiro} variant="primary" size="sm">
                  Add to Pool
                </Button>
                <Button
                  onClick={() => {
                    setShowAddKiro(false);
                    setKiroTokenInput('');
                  }}
                  variant="secondary"
                  size="sm"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {kiroAccounts.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-white text-sm font-medium">No Kiro accounts</p>
              <p className="text-txt-muted text-xs mt-1">
                Add at least one Kiro refresh token to use kiro/* models via the API
              </p>
            </div>
          ) : (
            <div className="divide-y divide-edge">
              {kiroAccounts.map((a) => {
                const stats = kiroStats.find((s) => s.id === a.id);
                return (
                  <div key={a.id} className="px-5 py-3 hover:bg-surface-2 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={a.status === 'active' ? 'success' : 'danger'}>{a.status}</Badge>
                          <span className="text-sm text-white truncate">{a.email || '(no email)'}</span>
                        </div>
                        <p className="text-[11px] text-txt-muted">
                          <code className="font-mono">{a.refreshTokenPreview}</code>
                          {a.lastUsed && ` · last used ${new Date(a.lastUsed).toLocaleString('id-ID')}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {a.status !== 'active' && (
                          <Button onClick={() => handleReactivate(a.id)} variant="ghost" size="xs">
                            Reactivate
                          </Button>
                        )}
                        <Button onClick={() => handleRemoveKiro(a.id)} variant="danger" size="xs">
                          Remove
                        </Button>
                      </div>
                    </div>

                    {stats && (
                      <div className="mt-2 grid grid-cols-4 gap-3 text-[11px]">
                        <div className="bg-surface-2 border border-edge rounded px-2 py-1.5">
                          <p className="text-[10px] text-txt-muted uppercase tracking-wider">Today</p>
                          <p className="text-white font-semibold tabular-nums">{formatTokens(stats.todayTokens)}</p>
                          <p className="text-txt-faint text-[10px]">{stats.todayRequests} req</p>
                        </div>
                        <div className="bg-surface-2 border border-edge rounded px-2 py-1.5">
                          <p className="text-[10px] text-txt-muted uppercase tracking-wider">7d</p>
                          <p className="text-white font-semibold tabular-nums">{formatTokens(stats.weekTokens)}</p>
                          <p className="text-txt-faint text-[10px]">{stats.weekRequests} req</p>
                        </div>
                        <div className="bg-surface-2 border border-edge rounded px-2 py-1.5">
                          <p className="text-[10px] text-txt-muted uppercase tracking-wider">Total</p>
                          <p className="text-white font-semibold tabular-nums">{formatTokens(stats.totalTokens)}</p>
                          <p className="text-txt-faint text-[10px]">{stats.totalRequests} req</p>
                        </div>
                        <div className="bg-surface-2 border border-edge rounded px-2 py-1.5">
                          <p className="text-[10px] text-txt-muted uppercase tracking-wider">In/Out</p>
                          <p className="text-white font-semibold tabular-nums text-[11px]">
                            {formatTokens(stats.totalPromptTokens)} / {formatTokens(stats.totalCompletionTokens)}
                          </p>
                          <p className="text-txt-faint text-[10px]">{stats.failedRequests} failed</p>
                        </div>
                      </div>
                    )}

                    {stats?.lastError && a.status === 'exhausted' && (
                      <div className="mt-2 px-2 py-1.5 bg-red-500/10 border border-red-500/30 rounded text-[11px] text-red-300/90">
                        <span className="font-medium">Exhausted</span>
                        {stats.exhaustedAt && (
                          <span className="text-red-400/70">
                            {' '}· {new Date(stats.exhaustedAt).toLocaleString('id-ID')}
                          </span>
                        )}
                        <span className="block mt-0.5 font-mono text-[10px] text-red-300/70 truncate">
                          {stats.lastError}
                        </span>
                      </div>
                    )}
                    {stats?.lastError && a.status === 'active' && (
                      <div className="mt-2 px-2 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded text-[11px] text-amber-300/90">
                        <span className="font-medium">Last error</span>
                        {stats.lastErrorAt && (
                          <span className="text-amber-400/70">
                            {' '}· {new Date(stats.lastErrorAt).toLocaleString('id-ID')}
                          </span>
                        )}
                        <span className="block mt-0.5 font-mono text-[10px] text-amber-300/70 truncate">
                          {stats.lastError}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Combos - ordered chains of (provider, model) with auto-fallback */}
        <ComboPanel providers={providers} />

        {/* Provider List */}
        <div className="bg-surface-1 border border-edge rounded-xl overflow-hidden mb-6 animate-slide-up">
          <div className="px-5 py-4 border-b border-edge flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">
                External Providers <span className="text-xs text-txt-muted font-normal">(optional)</span>
              </h2>
              <p className="text-xs text-txt-muted mt-0.5">
                Add OpenAI-compatible providers (WIR Cloud, OpenRouter, OpenAI, etc.) for use alongside the built-in Prometheus pool
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setShowDetector(!showDetector);
                  setShowAdd(false);
                }}
                variant={showDetector ? 'secondary' : 'outline'}
                size="sm"
              >
                {showDetector ? 'Cancel' : 'Auto-detect Kiro'}
              </Button>
              <Button
                onClick={() => {
                  setShowAdd(!showAdd);
                  setShowDetector(false);
                }}
                variant="primary"
                size="sm"
              >
                {showAdd ? 'Cancel' : '+ Add Manually'}
              </Button>
            </div>
          </div>

          {providers.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-white text-sm font-medium">No providers configured</p>
              <p className="text-txt-muted text-xs mt-1">
                Add an API key or Kiro refresh token to start chatting
              </p>
            </div>
          ) : (
            <div className="divide-y divide-edge">
              {providers
                .filter((p) => !p.builtin)
                .map((p) => {
                  const modelList = JSON.parse(p.models || '[]') as string[];
                  return (
                    <div key={p.id} className="px-5 py-4 hover:bg-surface-2 transition-colors">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-white truncate">{p.name}</span>
                            {p.isDefault && <Badge variant="info">DEFAULT</Badge>}
                            {!p.isActive && <Badge variant="danger">DISABLED</Badge>}
                            {modelList.length > 0 && <Badge variant="success">{modelList.length} models</Badge>}
                            {modelList.length === 0 && p.isActive && <Badge variant="warning">no models</Badge>}
                          </div>
                          <p className="text-xs text-txt-muted truncate">
                            {p.type === 'kiro_refresh_token' ? 'Kiro Refresh Token' : 'API Key'} ·{' '}
                            <span className="font-mono">{p.baseUrl || 'https://api.kiro.dev/v1'}</span>
                          </p>
                          {p.modelsLastFetched && (
                            <p className="text-[11px] text-txt-faint mt-1">
                              Models last fetched: {new Date(p.modelsLastFetched).toLocaleString('id-ID')}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button onClick={() => handleRefreshModels(p.id)} variant="ghost" size="xs" title="Re-fetch models">
                            ↻ Refresh
                          </Button>
                          {!p.isDefault && (
                            <Button onClick={() => handleSetDefault(p.id)} variant="ghost" size="xs">
                              Set Default
                            </Button>
                          )}
                          <Button
                            onClick={() => handleToggleActive(p.id, p.isActive)}
                            variant={p.isActive ? 'outline' : 'secondary'}
                            size="xs"
                          >
                            {p.isActive ? 'Disable' : 'Enable'}
                          </Button>
                          <Button onClick={() => handleDeleteProvider(p.id)} variant="danger" size="xs">
                            Delete
                          </Button>
                        </div>
                      </div>
                      {modelList.length > 0 && (
                        <details className="mt-3 group/models">
                          <summary className="cursor-pointer text-[11px] text-txt-muted hover:text-white inline-flex items-center gap-1">
                            <svg className="w-3 h-3 transition-transform group-open/models:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            Available models ({modelList.length})
                          </summary>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {modelList.map((m, i) => (
                              <code
                                key={i}
                                className="px-1.5 py-0.5 bg-surface-2 border border-edge rounded text-[10px] text-txt-secondary font-mono"
                              >
                                {m}
                              </code>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Token Detector */}
        {showDetector && (
          <div className="mb-6 animate-slide-up">
            <TokenDetector
              onTokenSelected={async (token, name) => {
                try {
                  const result = await createProvider({
                    name: name || 'Kiro Auto-detected',
                    type: 'kiro_refresh_token',
                    baseUrl: '',
                    apiKey: token,
                  }).unwrap();
                  dispatch(
                    showToast({
                      type: 'success',
                      message: result.message || 'Kiro provider berhasil ditambahkan',
                    }),
                  );
                  setShowDetector(false);
                } catch (err) {
                  const message =
                    (err as { data?: { error?: string } })?.data?.error ?? 'Failed to save token';
                  dispatch(showToast({ type: 'error', message }));
                }
              }}
            />
          </div>
        )}

        {/* Add Form */}
        {showAdd && (
          <div className="bg-surface-1 border border-edge rounded-xl p-6 animate-slide-up">
            <h3 className="text-base font-semibold text-white mb-4">New Provider</h3>

            <div className="mb-5">
              <label className="block text-[11px] font-semibold text-txt-muted mb-2 uppercase tracking-wider">
                Quick presets
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setForm({ ...form, name: 'Kiro', type: 'kiro_refresh_token', baseUrl: '' })
                  }
                  className="px-3 py-1.5 text-xs font-medium border border-purple-500/30 bg-purple-500/10 text-purple-300 rounded-md hover:bg-purple-500/20 hover:border-purple-500/50 transition-all"
                >
                  Kiro Refresh Token
                </button>
                {PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => setForm({ ...form, name: preset.name, type: 'api_key', baseUrl: preset.baseUrl })}
                    className="px-3 py-1.5 text-xs font-medium border border-edge text-txt-secondary rounded-md hover:text-white hover:border-edge-hover hover:bg-surface-2 transition-all"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-txt-faint mt-2 leading-relaxed">
                The built-in <span className="text-white font-medium">Prometheus</span> provider (powered by your Kiro Account Pool above) is the recommended way to chat. Add an external provider only if you want to use OpenAI, OpenRouter, or other vision-capable models.
              </p>
            </div>

            <form onSubmit={handleAddProvider} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Display Name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. My OpenRouter"
                  required
                />
                <div>
                  <label className="block text-[11px] font-semibold text-txt-muted mb-1.5 uppercase tracking-wider">
                    Type
                  </label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-surface-1 border border-edge rounded-lg text-white text-sm focus:outline-none focus:border-edge-hover transition-colors"
                  >
                    <option value="api_key">API Key (OpenAI-compatible)</option>
                    <option value="kiro_refresh_token">Kiro Refresh Token</option>
                  </select>
                </div>
              </div>

              <Input
                label="Base URL"
                type="text"
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
                required={form.type !== 'kiro_refresh_token'}
                hint={form.type === 'kiro_refresh_token' ? 'Optional. Defaults to Kiro API endpoint' : undefined}
              />

              <Input
                label={form.type === 'kiro_refresh_token' ? 'Refresh Token' : 'API Key'}
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder={form.type === 'kiro_refresh_token' ? 'Paste Kiro refresh token here' : 'sk-...'}
                required
                hint="Encrypted with AES-256-GCM before storage"
              />

              <div className="flex gap-2 pt-2">
                <Button type="submit" loading={creatingProvider} variant="primary">
                  Save Provider
                </Button>
                <Button type="button" onClick={() => setShowAdd(false)} variant="secondary">
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
