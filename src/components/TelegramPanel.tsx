'use client';

/**
 * TelegramPanel — Settings section for the Telegram bot integration.
 *
 * Lets the user paste their bot token, set the allowed Telegram user
 * IDs, and pick a default model. Saving the form validates the token
 * with Telegram (getMe) and registers our webhook URL.
 *
 * Design rules:
 *   - Token never returned plaintext after save. We show '••••AbCd'
 *     and a "Replace" affordance to paste a new one.
 *   - Failed webhook registration shows lastError prominently — easiest
 *     to debug "why isn't my bot replying" with one read.
 *   - Single-bot-per-user: form is either Create (no bot yet) or
 *     Update (bot exists). No multi-bot UI complexity.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useAppDispatch } from '@/lib/store/hooks';
import { showToast } from '@/lib/store/slices/uiSlice';
import { useListModelsQuery } from '@/lib/store/api/modelsApi';
import { formatModelDisplay } from '@/lib/format-model';

interface TelegramBotConfig {
  id: string;
  tokenPreview: string;
  botUsername: string | null;
  allowedUserIds: string;
  defaultSelection: string;
  webhookActive: boolean;
  lastError: string | null;
  lastErrorAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export function TelegramPanel() {
  const dispatch = useAppDispatch();
  const { data: modelsData } = useListModelsQuery();

  const [bot, setBot] = useState<TelegramBotConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [token, setToken] = useState('');
  const [allowedUserIds, setAllowedUserIds] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [showToken, setShowToken] = useState(false);

  // Load existing config on mount
  useEffect(() => {
    fetchBot();
  }, []);

  const fetchBot = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/telegram/bot');
      if (res.ok) {
        const data = await res.json();
        setBot(data.bot);
        if (data.bot) {
          setAllowedUserIds(data.bot.allowedUserIds || '');
          // Try to extract default model from stored selection
          if (data.bot.defaultSelection) {
            try {
              const sel = JSON.parse(data.bot.defaultSelection);
              if (sel?.mode === 'model' && typeof sel.value === 'string') {
                setDefaultModel(sel.value);
              }
            } catch { /* ignore */ }
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!bot && !token.trim()) {
      dispatch(showToast({ type: 'error', message: 'Bot token required' }));
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        allowedUserIds,
        defaultSelection: defaultModel
          ? JSON.stringify({ mode: 'model', value: defaultModel })
          : '',
      };
      if (token.trim()) {
        body.token = token.trim();
      }
      const res = await fetch('/api/telegram/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Save failed');
      }
      setBot(data.bot);
      setToken('');
      dispatch(showToast({
        type: 'success',
        message: data.bot.webhookActive
          ? `Bot @${data.bot.botUsername || 'connected'} ready`
          : 'Saved, but webhook registration failed — see error below',
      }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: (err as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Disconnect Telegram bot? Webhook will be un-registered.')) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/telegram/bot', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Delete failed');
      }
      setBot(null);
      setToken('');
      setAllowedUserIds('');
      setDefaultModel('');
      dispatch(showToast({ type: 'success', message: 'Telegram bot disconnected' }));
    } catch (err) {
      dispatch(showToast({ type: 'error', message: (err as Error).message }));
    } finally {
      setDeleting(false);
    }
  };

  const isConfigured = !!bot;

  return (
    <div className="bg-surface-1 border border-hairline rounded-xl overflow-hidden mb-6 animate-slide-up">
      <div className="px-6 py-5 border-b border-hairline flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink inline-flex items-center gap-2">
            Telegram Bot
            {bot?.webhookActive && (
              <span className="status-pill text-success border-success/40 bg-success/10">
                <span className="w-1.5 h-1.5 rounded-full bg-success" /> active
              </span>
            )}
            {bot && !bot.webhookActive && (
              <span className="status-pill text-amber-400 border-amber-500/40 bg-amber-500/10">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> webhook error
              </span>
            )}
          </h2>
          <p className="text-xs text-ink-subtle mt-0.5">
            Chat with your Kiro pool from Telegram. Bot replies only to whitelisted user IDs.
          </p>
        </div>
        {isConfigured && (
          <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>
            Disconnect
          </Button>
        )}
      </div>

      <div className="p-6 space-y-4">
        {loading ? (
          <p className="text-sm text-ink-subtle">Loading…</p>
        ) : (
          <>
            {/* Existing bot info */}
            {bot && (
              <div className="bg-surface-2 border border-hairline rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-subtle">Bot username</span>
                  <span className="text-sm text-ink font-medium">
                    {bot.botUsername ? `@${bot.botUsername}` : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-subtle">Token</span>
                  <code className="text-sm text-ink font-mono">{bot.tokenPreview}</code>
                </div>
                {bot.lastError && (
                  <div className="mt-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-md">
                    <p className="text-[11px] uppercase tracking-wider font-semibold text-red-400 mb-1">
                      Last error
                    </p>
                    <p className="text-xs text-red-200 break-words">{bot.lastError}</p>
                  </div>
                )}
              </div>
            )}

            {/* Token input */}
            <div>
              <label className="block typo-eyebrow mb-1.5">
                {isConfigured ? 'Replace token (leave blank to keep)' : 'Bot token'}
              </label>
              <div className="flex gap-2">
                <Input
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={isConfigured ? 'Paste new token to replace' : '1234567890:ABCdefGHIjklMNOpqr...'}
                  className="flex-1 font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowToken((s) => !s)}
                >
                  {showToken ? 'Hide' : 'Show'}
                </Button>
              </div>
              <p className="text-[11px] text-ink-subtle mt-1.5 leading-relaxed">
                Get a bot token by chatting with{' '}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener"
                  className="text-accent-hover underline underline-offset-2"
                >@BotFather</a>{' '}
                → /newbot. Token is stored encrypted; only the last 4 chars shown after save.
              </p>
            </div>

            {/* Allowed user IDs */}
            <div>
              <label className="block typo-eyebrow mb-1.5">Allowed Telegram user IDs</label>
              <Input
                type="text"
                value={allowedUserIds}
                onChange={(e) => setAllowedUserIds(e.target.value)}
                placeholder="123456789, 987654321"
                className="font-mono"
              />
              <p className="text-[11px] text-ink-subtle mt-1.5 leading-relaxed">
                Comma-separated. Bot ignores messages from anyone not on this list. Get your ID from{' '}
                <a
                  href="https://t.me/userinfobot"
                  target="_blank"
                  rel="noopener"
                  className="text-accent-hover underline underline-offset-2"
                >@userinfobot</a>.
              </p>
            </div>

            {/* Default model */}
            <div>
              <label className="block typo-eyebrow mb-1.5">Default model</label>
              <select
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                className="w-full px-3 py-2 bg-canvas border border-hairline rounded-lg text-sm text-ink focus:outline-none focus:border-hairline-strong focus:ring-2 focus:ring-accent/40"
              >
                <option value="">— Use general fallback —</option>
                {modelsData?.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName || formatModelDisplay(m.id)}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-ink-subtle mt-1.5">
                Telegram replies use this model. Combos not supported here yet (Telegram needs a single answer fast).
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} loading={saving} variant="primary" size="md">
                {isConfigured ? 'Update' : 'Connect'}
              </Button>
              {isConfigured && bot.botUsername && (
                <a
                  href={`https://t.me/${bot.botUsername}`}
                  target="_blank"
                  rel="noopener"
                >
                  <Button type="button" variant="secondary" size="md">
                    Open in Telegram
                  </Button>
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
