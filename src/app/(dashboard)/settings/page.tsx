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

const PRESETS = [
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
  const [showAdd, setShowAdd] = useState(false);
  const [showDetector, setShowDetector] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'api_key', baseUrl: '', apiKey: '' });
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { fetchProviders().finally(() => setInitialLoad(false)); }, []);

  const fetchProviders = async () => {
    const res = await fetch('/api/providers');
    if (res.ok) { const data = await res.json(); setProviders(data.providers); }
    else if (res.status === 401) window.location.href = '/login';
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

  return (
    <div className="min-h-screen bg-surface-0">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-fade-in">
          <div>
            <h1 className="text-2xl font-semibold text-white">Settings</h1>
            <p className="text-txt-muted text-sm mt-1">Manage your AI providers and API keys</p>
          </div>
          <a href="/chat">
            <Button variant="secondary" size="sm">← Back to Chat</Button>
          </a>
        </div>

        {message && (
          <div className="mb-4 animate-fade-in">
            <Alert type={message.type}>{message.text}</Alert>
          </div>
        )}

        {/* Provider List */}
        <div className="bg-surface-1 border border-edge rounded-xl overflow-hidden mb-6 animate-slide-up">
          <div className="px-5 py-4 border-b border-edge flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">API Providers</h2>
              <p className="text-xs text-txt-muted mt-0.5">Add Kiro tokens or any OpenAI-compatible provider</p>
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
                        {p.type === 'kiro_refresh_token' ? 'Kiro Refresh Token' : 'API Key'} · <span className="font-mono">{p.baseUrl || 'https://api.kiro.dev/v1'}</span>
                      </p>
                      {p.modelsLastFetched && (
                        <p className="text-[11px] text-txt-faint mt-1">
                          Models last fetched: {new Date(p.modelsLastFetched).toLocaleString('id-ID')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button onClick={() => refreshModels(p.id)} variant="ghost" size="xs" title="Re-fetch models">↻ Refresh</Button>
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
                  Kiro
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
