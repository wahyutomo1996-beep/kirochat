'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Alert } from '@/components/Alert';
import { Badge } from '@/components/Badge';
import { LoadingState } from '@/components/LoadingState';
import { TokenDetector } from '@/components/TokenDetector';

interface Provider {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  models: string;
  modelsLastFetched: string | null;
  isDefault: boolean;
  isActive: boolean;
}

interface KiroAccount {
  id: string;
  email: string | null;
  status: string;
  usageCount: number;
  lastUsed: string | null;
  tokenExpiresAt: string | null;
  exhaustedAt: string | null;
  createdAt: string;
  refreshTokenPreview: string;
}

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

export default function SettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [kiroAccounts, setKiroAccounts] = useState<KiroAccount[]>([]);
  const [apiKey, setApiKey] = useState<string>('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showDetector, setShowDetector] = useState(false);
  const [showAddKiro, setShowAddKiro] = useState(false);
  const [kiroTokenInput, setKiroTokenInput] = useState('');
  const [form, setForm] = useState({ name: '', type: 'api_key', baseUrl: '', apiKey: '' });
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    Promise.all([fetchProviders(), fetchKiroAccounts(), fetchApiKey()])
      .finally(() => setInitialLoad(false));
  }, []);

  const fetchProviders = async () => {
    const res = await fetch('/api/providers');
    if (res.ok) { const data = await res.json(); setProviders(data.providers); }
    else if (res.status === 401) window.location.href = '/login';
  };

  const fetchKiroAccounts = async () => {
    const res = await fetch('/api/kiro-accounts');
    if (res.ok) { const data = await res.json(); setKiroAccounts(data.accounts || []); }
  };

  const fetchApiKey = async () => {
    const res = await fetch('/api/api-key');
    if (res.ok) { const data = await res.json(); setApiKey(data.apiKey || ''); }
  };

  const regenerateApiKey = async () => {
    if (!confirm('Regenerate your API key? All clients using the old key will stop working.')) return;
    const res = await fetch('/api/api-key', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      setApiKey(data.apiKey);
      setKeyVisible(true);
      setMessage({ type: 'success', text: 'API key regenerated' });
    }
  };

  const copyApiKey = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setMessage({ type: 'success', text: 'API key copied to clipboard' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to copy' });
    }
  };

  const copyBaseUrl = async () => {
    const baseUrl = `${window.location.origin}/v1`;
    try {
      await navigator.clipboard.writeText(baseUrl);
      setMessage({ type: 'success', text: 'Base URL copied' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to copy' });
    }
  };

  const addKiroAccount = async () => {
    if (!kiroTokenInput.trim()) {
      setMessage({ type: 'error', text: 'Refresh token required' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/kiro-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: kiroTokenInput.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        const parts = [];
        if (data.total > 0) parts.push(`Added ${data.total} account(s)`);
        if (data.errors?.length > 0) parts.push(`${data.errors.length} failed`);
        setMessage({ type: data.total > 0 ? 'success' : 'error', text: parts.join(', ') || 'Done' });
        setKiroTokenInput('');
        setShowAddKiro(false);
        fetchKiroAccounts();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to add account' });
      }
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message });
    }
    setLoading(false);
  };

  const removeKiroAccount = async (id: string) => {
    if (!confirm('Remove this Kiro account?')) return;
    await fetch(`/api/kiro-accounts/${id}`, { method: 'DELETE' });
    fetchKiroAccounts();
  };

  const reactivateAccount = async (id: string) => {
    await fetch(`/api/kiro-accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    fetchKiroAccounts();
  };

  const addProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setMessage(null);
    const res = await fetch('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const data = await res.json();
    if (res.ok) {
      setMessage({ type: 'success', text: data.message || 'Provider berhasil ditambahkan' });
      setForm({ name: '', type: 'api_key', baseUrl: '', apiKey: '' });
      setShowAdd(false);
      fetchProviders();
    } else {
      setMessage({ type: 'error', text: data.error || 'Failed to add provider' });
    }
    setLoading(false);
  };

  const refreshModels = async (id: string) => {
    setMessage(null);
    const res = await fetch(`/api/providers/${id}/models`);
    const data = await res.json();
    if (res.ok) {
      setMessage({ type: 'success', text: `Refreshed: ${data.count} models detected` });
      fetchProviders();
    } else {
      setMessage({ type: 'error', text: data.error || 'Failed to refresh models' });
    }
  };

  const deleteProvider = async (id: string) => {
    if (!confirm('Hapus provider ini?')) return;
    await fetch(`/api/providers/${id}`, { method: 'DELETE' });
    fetchProviders();
  };

  const setDefault = async (id: string) => {
    await fetch(`/api/providers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isDefault: true }) });
    fetchProviders();
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    await fetch(`/api/providers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !isActive }) });
    fetchProviders();
  };

  if (initialLoad) return <LoadingState fullScreen />;

  const activeAccounts = kiroAccounts.filter(a => a.status === 'active').length;
  const exhaustedAccounts = kiroAccounts.filter(a => a.status === 'exhausted').length;
  const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/v1` : '/v1';
  const maskedKey = apiKey ? `${apiKey.slice(0, 8)}${'\u2022'.repeat(32)}${apiKey.slice(-6)}` : 'No key';

  return (
    <div className="min-h-screen bg-surface-0">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-fade-in">
          <div>
            <h1 className="text-2xl font-semibold text-white">Settings</h1>
            <p className="text-txt-muted text-sm mt-1">Manage your AI providers, Kiro accounts, and API access</p>
          </div>
          <a href="/chat">
            <Button variant="secondary" size="sm">â† Back to Chat</Button>
          </a>
        </div>

        {message && (
          <div className="mb-4 animate-fade-in">
            <Alert type={message.type}>{message.text}</Alert>
          </div>
        )}

        {/* API Key Section - OpenAI-compatible access */}
        <div className="bg-surface-1 border border-edge rounded-xl overflow-hidden mb-6 animate-slide-up">
          <div className="px-5 py-4 border-b border-edge">
            <h2 className="text-base font-semibold text-white">Your API Key</h2>
            <p className="text-xs text-txt-muted mt-0.5">Use Prometheus as a provider in any OpenAI-compatible client</p>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-txt-muted mb-1.5 uppercase tracking-wider">Base URL</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-surface-2 border border-edge rounded-lg text-sm text-white font-mono break-all">{baseUrl}</code>
                <Button onClick={copyBaseUrl} variant="ghost" size="sm">Copy</Button>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-txt-muted mb-1.5 uppercase tracking-wider">API Key</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-surface-2 border border-edge rounded-lg text-sm text-white font-mono break-all">
                  {keyVisible ? apiKey : maskedKey}
                </code>
                <Button onClick={() => setKeyVisible(!keyVisible)} variant="ghost" size="sm">
                  {keyVisible ? 'Hide' : 'Show'}
                </Button>
                <Button onClick={copyApiKey} variant="ghost" size="sm">Copy</Button>
                <Button onClick={regenerateApiKey} variant="outline" size="sm">Regenerate</Button>
              </div>
              <p className="text-[11px] text-txt-faint mt-2">
                Use this key with any OpenAI SDK. Set <code className="text-txt-secondary">OPENAI_API_KEY</code> and <code className="text-txt-secondary">OPENAI_BASE_URL</code> to the values above.
              </p>
            </div>
            <details className="group/sample">
              <summary className="cursor-pointer text-xs text-txt-muted hover:text-white inline-flex items-center gap-1">
                <svg className="w-3 h-3 transition-transform group-open/sample:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                Sample code (Python / curl)
              </summary>
              <div className="mt-3 space-y-2">
                <pre className="text-[11px] bg-surface-2 border border-edge rounded p-3 overflow-x-auto text-txt-secondary font-mono"><code>{`# Python (openai SDK)
from openai import OpenAI
client = OpenAI(api_key="${apiKey || 'pmt-...'}", base_url="${baseUrl}")
r = client.chat.completions.create(
    model="kiro/claude-opus-4.7",
    messages=[{"role": "user", "content": "Hello"}],
)
print(r.choices[0].message.content)`}</code></pre>
                <pre className="text-[11px] bg-surface-2 border border-edge rounded p-3 overflow-x-auto text-txt-secondary font-mono"><code>{`# curl
curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${apiKey || 'pmt-...'}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "kiro/claude-opus-4.7",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}</code></pre>
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
                <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/15 border border-purple-500/30 text-purple-300 rounded font-bold uppercase tracking-wider">Powers Prometheus</span>
              </h2>
              <p className="text-xs text-txt-muted mt-0.5">
                {activeAccounts} active · {exhaustedAccounts} exhausted · {kiroAccounts.length} total
                {' · '}
                <span className="text-txt-faint">paste Kiro refresh tokens here — the built-in Prometheus provider auto-rotates between them</span>
              </p>
            </div>
            <Button onClick={() => setShowAddKiro(!showAddKiro)} variant="primary" size="sm">
              {showAddKiro ? 'Cancel' : '+ Add Account'}
            </Button>
          </div>

          {showAddKiro && (
            <div className="px-5 py-4 border-b border-edge bg-surface-2">
              <label className="block text-[11px] font-semibold text-txt-muted mb-1.5 uppercase tracking-wider">Refresh Token (one per line)</label>
              <textarea
                value={kiroTokenInput}
                onChange={(e) => setKiroTokenInput(e.target.value)}
                placeholder="aorAAAAA..."
                rows={3}
                className="w-full px-3 py-2 bg-surface-1 border border-edge rounded-lg text-sm text-white font-mono focus:outline-none focus:border-edge-hover transition-colors"
              />
              <div className="flex gap-2 mt-3">
                <Button onClick={addKiroAccount} loading={loading} variant="primary" size="sm">Add to Pool</Button>
                <Button onClick={() => { setShowAddKiro(false); setKiroTokenInput(''); }} variant="secondary" size="sm">Cancel</Button>
              </div>
            </div>
          )}

          {kiroAccounts.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-white text-sm font-medium">No Kiro accounts</p>
              <p className="text-txt-muted text-xs mt-1">Add at least one Kiro refresh token to use kiro/* models via the API</p>
            </div>
          ) : (
            <div className="divide-y divide-edge">
              {kiroAccounts.map((a) => (
                <div key={a.id} className="px-5 py-3 hover:bg-surface-2 transition-colors flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge variant={a.status === 'active' ? 'success' : 'danger'}>{a.status}</Badge>
                      <span className="text-sm text-white truncate">{a.email || '(no email)'}</span>
                    </div>
                    <p className="text-[11px] text-txt-muted">
                      <code className="font-mono">{a.refreshTokenPreview}</code> Â· used {a.usageCount} times
                      {a.lastUsed && ` Â· last ${new Date(a.lastUsed).toLocaleString('id-ID')}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.status !== 'active' && (
                      <Button onClick={() => reactivateAccount(a.id)} variant="ghost" size="xs">Reactivate</Button>
                    )}
                    <Button onClick={() => removeKiroAccount(a.id)} variant="danger" size="xs">Remove</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Provider List */}
        <div className="bg-surface-1 border border-edge rounded-xl overflow-hidden mb-6 animate-slide-up">
          <div className="px-5 py-4 border-b border-edge flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">External Providers <span className="text-xs text-txt-muted font-normal">(optional)</span></h2>
              <p className="text-xs text-txt-muted mt-0.5">Add OpenAI-compatible providers (WIR Cloud, OpenRouter, OpenAI, etc.) for use alongside the built-in Prometheus pool</p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => { setShowDetector(!showDetector); setShowAdd(false); }}
                variant={showDetector ? 'secondary' : 'outline'}
                size="sm"
              >
                {showDetector ? 'Cancel' : 'Auto-detect Kiro'}
              </Button>
              <Button
                onClick={() => { setShowAdd(!showAdd); setShowDetector(false); }}
                variant="primary"
                size="sm"
              >
                {showAdd ? 'Cancel' : '+ Add Manually'}
              </Button>
            </div>
          </div>

          {providers.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <div className="w-12 h-12 rounded-xl bg-surface-2 border border-edge flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-txt-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <p className="text-white text-sm font-medium">No providers configured</p>
              <p className="text-txt-muted text-xs mt-1">Add an API key or Kiro refresh token to start chatting</p>
            </div>
          ) : (
            <div className="divide-y divide-edge">
              {providers.map((p) => {
                const modelList = JSON.parse(p.models || '[]');
                return (
                <div key={p.id} className="px-5 py-4 hover:bg-surface-2 transition-colors">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-white truncate">{p.name}</span>
                        {p.isDefault && <Badge variant="info">DEFAULT</Badge>}
                        {!p.isActive && <Badge variant="danger">DISABLED</Badge>}
                        {modelList.length > 0 && (
                          <Badge variant="success">{modelList.length} models</Badge>
                        )}
                        {modelList.length === 0 && p.isActive && (
                          <Badge variant="warning">no models</Badge>
                        )}
                      </div>
                      <p className="text-xs text-txt-muted truncate">
                        {p.type === 'kiro_refresh_token' ? 'Kiro Refresh Token' : 'API Key'} Â· <span className="font-mono">{p.baseUrl || 'https://api.kiro.dev/v1'}</span>
                      </p>
                      {p.modelsLastFetched && (
                        <p className="text-[11px] text-txt-faint mt-1">
                          Models last fetched: {new Date(p.modelsLastFetched).toLocaleString('id-ID')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button onClick={() => refreshModels(p.id)} variant="ghost" size="xs" title="Re-fetch models">â†» Refresh</Button>
                      {!p.isDefault && (
                        <Button onClick={() => setDefault(p.id)} variant="ghost" size="xs">Set Default</Button>
                      )}
                      <Button onClick={() => toggleActive(p.id, p.isActive)} variant={p.isActive ? 'outline' : 'secondary'} size="xs">
                        {p.isActive ? 'Disable' : 'Enable'}
                      </Button>
                      <Button onClick={() => deleteProvider(p.id)} variant="danger" size="xs">Delete</Button>
                    </div>
                  </div>
                  {modelList.length > 0 && (
                    <details className="mt-3 group/models">
                      <summary className="cursor-pointer text-[11px] text-txt-muted hover:text-white inline-flex items-center gap-1">
                        <svg className="w-3 h-3 transition-transform group-open/models:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        Available models ({modelList.length})
                      </summary>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {modelList.map((m: string, i: number) => (
                          <code key={i} className="px-1.5 py-0.5 bg-surface-2 border border-edge rounded text-[10px] text-txt-secondary font-mono">{m}</code>
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
                setLoading(true);
                setMessage(null);
                const res = await fetch('/api/providers', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: name || 'Kiro Auto-detected',
                    type: 'kiro_refresh_token',
                    baseUrl: '',
                    apiKey: token,
                  }),
                });
                const data = await res.json();
                if (res.ok) {
                  setMessage({ type: 'success', text: data.message || 'Kiro provider berhasil ditambahkan' });
                  setShowDetector(false);
                  fetchProviders();
                } else {
                  setMessage({ type: 'error', text: data.error || 'Failed to save token' });
                }
                setLoading(false);
              }}
            />
          </div>
        )}

        {/* Add Form */}
        {showAdd && (
          <div className="bg-surface-1 border border-edge rounded-xl p-6 animate-slide-up">
            <h3 className="text-base font-semibold text-white mb-4">New Provider</h3>

            <div className="mb-5">
              <label className="block text-[11px] font-semibold text-txt-muted mb-2 uppercase tracking-wider">Quick presets</label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, name: 'Kiro', type: 'kiro_refresh_token', baseUrl: '' })}
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

            <form onSubmit={addProvider} className="space-y-4">
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
                  <label className="block text-[11px] font-semibold text-txt-muted mb-1.5 uppercase tracking-wider">Type</label>
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
                <Button type="submit" loading={loading} variant="primary">Save Provider</Button>
                <Button type="button" onClick={() => setShowAdd(false)} variant="secondary">Cancel</Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
