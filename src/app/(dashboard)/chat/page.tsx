'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/Button';
import { LoadingState } from '@/components/LoadingState';
import { WorkspaceBox, type WorkspaceSelection, type WorkspaceModelLike, type ProviderCatalog } from '@/components/WorkspaceBox';
import { UserPill } from '@/components/UserPill';
import { isKiroBacked, pickVisionFallback, type ProviderLike } from '@/lib/vision';
import { WORKSPACES, findWorkspace, normalizeWorkspaceId } from '@/lib/workspaces';
import { formatModelDisplay } from '@/lib/format-model';
import { PROMETHEUS_PROVIDER_ID } from '@/lib/constants';

/*
 * Side panels are workspace-specific and lazy-loaded — no need to ship
 * highlight.js (CodingPanel ~150KB) or TradingView loader (TradingPanel)
 * into the chat bundle when the user is in General workspace. They get
 * fetched only when the user activates that workspace.
 *
 * ssr:false because both panels touch browser-only APIs (TradingView
 * window global, navigator.clipboard) — there's no value in pre-rendering
 * them on the server.
 */
const CodingPanel = dynamic(
  () => import('@/components/CodingPanel').then((m) => m.CodingPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-txt-muted text-xs">
        Loading code panel...
      </div>
    ),
  },
);
const TradingPanel = dynamic(
  () => import('@/components/TradingPanel').then((m) => m.TradingPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-txt-muted text-xs">
        Loading market view...
      </div>
    ),
  },
);

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images: string;
  model: string;
  /**
   * Provider display name captured at send time so the assistant footer
   * can show "Genfity · Claude Haiku 4.5" instead of just the model id.
   * Optional because messages loaded from the server (older history)
   * won't carry it.
   */
  providerName?: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  title: string;
  model: string;
  provider: string;
  workspace: string;
  updatedAt: string;
}

interface Provider {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  models: string;
  isDefault: boolean;
  isActive: boolean;
  builtin?: boolean;
  accountCount?: number;
  /** True when this is a shared provider from another user (e.g. admin
   *  shared free tier). The user can dispatch to it but only against the
   *  whitelisted models surfaced in the `models` JSON. */
  shared?: boolean;
}

interface ChatCombo {
  id: string;
  slug: string;
  name: string;
  category: string;
  icon: string;
  isActive: boolean;
  steps: Array<{ providerId: string; model: string; label?: string }>;
}

/**
 * localStorage key for per-workspace selection (combo or model).
 * v2 -> v3: Selection.model now carries `providerId` so we can route
 * "Claude Haiku 4.5 from Genfity" vs "Claude Haiku 4.5 from Kiro pool"
 * unambiguously. Old v2 entries (model mode without providerId) are
 * silently dropped; user re-picks once.
 */
const WORKSPACE_SELECTION_KEY = 'prometheus.workspace.selection.v3';

/** Read persisted per-workspace selections from localStorage */
function loadWorkspaceSelections(): Record<string, WorkspaceSelection> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(WORKSPACE_SELECTION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const out: Record<string, WorkspaceSelection> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (!v || typeof v !== 'object') continue;
        const sel = v as Record<string, unknown>;
        if (sel.mode === 'combo' && typeof sel.value === 'string') {
          out[k] = { mode: 'combo', value: sel.value };
        } else if (
          sel.mode === 'model' &&
          typeof sel.value === 'string' &&
          typeof sel.providerId === 'string'
        ) {
          out[k] = { mode: 'model', providerId: sel.providerId, value: sel.value };
        }
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function saveWorkspaceSelections(map: Record<string, WorkspaceSelection>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WORKSPACE_SELECTION_KEY, JSON.stringify(map));
  } catch {
    /* localStorage full or disabled - silently ignore */
  }
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConv, setCurrentConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [combos, setCombos] = useState<ChatCombo[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  /**
   * Provider + model captured at sendMessage time so we can show the
   * user "via Genfity / Claude Haiku 4.5" while the stream is in
   * flight, even before the first token lands. Cleared when streaming
   * ends.
   */
  const [streamingProviderName, setStreamingProviderName] = useState('');
  const [streamingModel, setStreamingModel] = useState('');
  const [routingNotice, setRoutingNotice] = useState<{ from: string; to: string; model: string } | null>(null);
  /**
   * Set when an attached image was auto-described by a vision provider
   * before being forwarded to the workspace's primary model. Shown as an
   * inline chip so the user knows extra round-trip happened.
   */
  const [bridgeNotice, setBridgeNotice] = useState<{
    providerName: string;
    imageCount: number;
    fromCacheCount: number;
    latencyMs: number;
    warning: string | null;
  } | null>(null);
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);

  /** Active workspace - drives Recent filter, default combo, system prompt */
  const [activeWorkspace, setActiveWorkspace] = useState<string>('general');
  /**
   * Per-workspace selection (combo OR specific model). Persisted to
   * localStorage v2 schema. Replaced the v1 `workspaceCombos` state which
   * had no way to express "I want a specific model, not a combo".
   */
  const [workspaceSelections, setWorkspaceSelections] = useState<Record<string, WorkspaceSelection>>({});
  /** All available models (used by the Model picker in WorkspaceBox) */
  const [models, setModels] = useState<WorkspaceModelLike[]>([]);
  /** Mobile sidebar drawer state - false by default on small screens */
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  /** Side panel toggle for tablet/foldable mode (between fold and lg breakpoints) */
  const [sidePanelOpen, setSidePanelOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Live AbortController for the in-flight chat request. We hang it on
   * a ref (not state) so the Stop button click handler reads the
   * current controller without forcing a re-render. Cleared in finally
   * so back-to-back stops don't reuse a stale controller.
   */
  const abortRef = useRef<AbortController | null>(null);

  // Initial bootstrap
  useEffect(() => {
    Promise.all([fetchUser(), fetchProviders(), fetchConversations(), fetchCombos(), fetchModels()])
      .finally(() => setInitialLoad(false));
    // Restore per-workspace selection overrides from localStorage v2
    setWorkspaceSelections(loadWorkspaceSelections());
  }, []);

  useEffect(() => { if (currentConv) fetchMessages(currentConv); }, [currentConv]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamContent]);

  /*
   * Reflect active workspace on the document body so global CSS can apply
   * workspace-specific accent colors (atmospheric bg, scrollbar, focus
   * ring, selection). Cleanup on unmount restores neutral.
   */
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.dataset.workspace = activeWorkspace;
    }
    return () => {
      if (typeof document !== 'undefined') {
        delete document.body.dataset.workspace;
      }
    };
  }, [activeWorkspace]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  const fetchUser = async () => {
    const res = await fetch('/api/auth/me');
    if (res.ok) { const data = await res.json(); setUser(data.user); }
    else { window.location.href = '/login'; }
  };

  const fetchProviders = async () => {
    const res = await fetch('/api/providers');
    if (!res.ok) return;
    const data = await res.json();
    setProviders(data.providers);
  };

  const fetchConversations = async () => {
    const res = await fetch('/api/conversations');
    if (res.ok) { const data = await res.json(); setConversations(data.conversations); }
  };

  /**
   * Fetch user's combos. Each combo has a category (coding/trading/research/general)
   * which is used by WorkspaceBox to filter relevant ones per workspace.
   */
  const fetchCombos = async () => {
    try {
      const res = await fetch('/api/combos');
      if (!res.ok) return;
      const data = await res.json();
      setCombos((data.combos as ChatCombo[]).filter((c) => c.isActive));
    } catch {
      /* combos optional */
    }
  };

  /**
   * Fetch full model catalog. Used by the Model picker in WorkspaceBox so
   * users can switch to any specific model (e.g. claude-opus-4.7,
   * deepseek-3.2, qwen3-coder) without having to first create a combo.
   * This fixes the "locked to one provider" UX bug.
   */
  const fetchModels = async () => {
    try {
      const res = await fetch('/api/models');
      if (!res.ok) return;
      const data = await res.json();
      setModels(
        (data.models as Array<{ id: string; displayName: string; tier: string }>)
          .map((m) => ({ id: m.id, displayName: m.displayName, tier: m.tier })),
      );
    } catch {
      /* models optional — selector falls back to workspace.fallbackModel */
    }
  };

  const fetchMessages = async (convId: string) => {
    const res = await fetch(`/api/conversations/${convId}`);
    if (res.ok) { const data = await res.json(); setMessages(data.conversation.messages); }
  };

  /**
   * Resolve the (providerId, model) to send to /api/chat for a workspace.
   *
   * Priority:
   *   1. User selection mode 'model' -> dispatch via the picked provider
   *      ('__prometheus__' for Kiro pool, or DB id for Genfity/etc).
   *      This is the line that fixes the 'Genfity ga kebaca' bug —
   *      previously we always routed to '__prometheus__'.
   *   2. User selection mode 'combo' -> resolved combo (chained fallback)
   *   3. Workspace's default combo if user has it instantiated
   *   4. First combo matching the workspace category
   *   5. Built-in Prometheus pool with workspace.fallbackModel
   *
   * Returns { providerId, model } that the chat backend understands.
   */
  const resolveWorkspaceModel = useCallback(
    (workspaceId: string): { providerId: string; model: string } => {
      const ws = findWorkspace(workspaceId);
      if (!ws) {
        return { providerId: PROMETHEUS_PROVIDER_ID, model: 'kiro/claude-sonnet-4.6' };
      }

      // 1+2. User explicit override (combo or model)
      const sel = workspaceSelections[workspaceId];
      if (sel) {
        if (sel.mode === 'model' && sel.value) {
          // Honor the picked provider — this is the bug fix.
          return { providerId: sel.providerId || PROMETHEUS_PROVIDER_ID, model: sel.value };
        }
        if (sel.mode === 'combo' && sel.value) {
          const found = combos.find((c) => c.slug === sel.value);
          if (found) return { providerId: 'combo', model: found.slug };
        }
      }

      // 3. Workspace's default combo if user instantiated it
      const defaultCombo = combos.find((c) => c.slug === ws.defaultComboSlug);
      if (defaultCombo) return { providerId: 'combo', model: defaultCombo.slug };

      // 4. Any combo matching this category
      const matchingCategory = combos.find((c) => c.category === workspaceId);
      if (matchingCategory) return { providerId: 'combo', model: matchingCategory.slug };

      // 5. Raw built-in fallback model
      return { providerId: PROMETHEUS_PROVIDER_ID, model: ws.fallbackModel };
    },
    [combos, workspaceSelections],
  );

  /** Combos available for a given workspace (matched by category) */
  const combosForWorkspace = useCallback(
    (workspaceId: string): ChatCombo[] => {
      return combos.filter((c) => c.category === workspaceId);
    },
    [combos],
  );

  /**
   * Build per-provider model catalogs for the WorkspaceBox picker.
   *
   * Combines:
   *   - Prometheus (built-in Kiro pool) — populated from /api/models
   *   - Each external provider from /api/providers — its own model list
   *     parsed from the JSON-encoded `models` column
   *
   * Each catalog renders as a chip in the picker; clicking a chip
   * filters the dropdown to just that provider's models. Memoized so
   * the WorkspaceBox doesn't re-render on every keystroke.
   *
   * Skips providers with zero models so empty chips don't clutter the UI.
   */
  const providerCatalogs = useMemo<ProviderCatalog[]>(() => {
    const out: ProviderCatalog[] = [];

    // 1. Prometheus pool — always first when models are available
    if (models.length > 0) {
      out.push({
        id: PROMETHEUS_PROVIDER_ID,
        name: 'Prometheus',
        models,
      });
    }

    // 2. External providers — Genfity, OpenRouter, etc. Includes shared
    //    providers from other users (e.g. admin's free tier) — those have
    //    `shared: true` so the UI can render a "free" badge.
    for (const p of providers) {
      if (p.id === PROMETHEUS_PROVIDER_ID) continue; // already added
      if (!p.isActive) continue;
      let modelIds: string[] = [];
      try { modelIds = JSON.parse(p.models || '[]'); } catch { modelIds = []; }
      if (modelIds.length === 0) continue;
      out.push({
        id: p.id,
        name: p.name,
        shared: p.shared === true,
        models: modelIds.map((id) => ({
          id,
          displayName: formatModelDisplay(id),
        })),
      });
    }

    return out;
  }, [models, providers]);

  /**
   * Compute the effective selection to display in WorkspaceBox.
   * Falls back through the same priority as resolveWorkspaceModel so the
   * UI always shows something useful, even when the user hasn't picked
   * anything explicitly yet.
   *
   * Also self-heals stale selections: if the user picked a model from a
   * provider that's since been deleted/disabled (its id no longer
   * appears in providerCatalogs), we fall back to the workspace default
   * instead of trying to dispatch to a phantom provider.
   */
  const effectiveSelection = useCallback(
    (workspaceId: string): WorkspaceSelection => {
      const sel = workspaceSelections[workspaceId];
      const ws = findWorkspace(workspaceId);
      const fallbackModel = ws?.fallbackModel ?? 'kiro/claude-sonnet-4.6';

      if (sel) {
        if (sel.mode === 'combo') return sel;
        // Validate that the picked provider still exists
        const providerStillThere = providerCatalogs.some((p) => p.id === sel.providerId);
        if (providerStillThere) return sel;
        // Provider gone — fall through to default
      }

      if (!ws) {
        return { mode: 'model', providerId: PROMETHEUS_PROVIDER_ID, value: fallbackModel };
      }
      // Show the default combo if it exists, else fall back to fallbackModel
      const hasDefaultCombo = combos.some((c) => c.slug === ws.defaultComboSlug);
      if (hasDefaultCombo) return { mode: 'combo', value: ws.defaultComboSlug };
      return { mode: 'model', providerId: PROMETHEUS_PROVIDER_ID, value: fallbackModel };
    },
    [combos, workspaceSelections, providerCatalogs],
  );

  /** User picks a different combo OR model for a workspace - persist to localStorage */
  const handleWorkspaceSelectionChange = (workspaceId: string, selection: WorkspaceSelection) => {
    const next = { ...workspaceSelections, [workspaceId]: selection };
    setWorkspaceSelections(next);
    saveWorkspaceSelections(next);
  };

  /** Activate a workspace + start a fresh chat in it */
  const activateWorkspace = (workspaceId: string) => {
    const normalized = normalizeWorkspaceId(workspaceId);
    setActiveWorkspace(normalized);
    setCurrentConv(null);
    setMessages([]);
    setStreamContent('');
    setRoutingNotice(null);
    setBridgeNotice(null);
    // Close mobile drawer after selection (UX: user wants to see chat)
    setMobileSidebarOpen(false);
    // Reset side panel for new workspace
    setSidePanelOpen(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      addImageFromFile(file);
    });
    e.target.value = '';
  };

  /**
   * Convert a File (image) into a base64 data URL and append to the
   * pending images list. Used by file picker, paste handler, and drag-drop.
   */
  const addImageFromFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) {
      alert(`Image ${file.name || 'pasted'} too large (max 5MB)`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImages((prev) => [...prev, reader.result as string]);
    reader.readAsDataURL(file);
  };

  /**
   * Capture image data on paste into the message textarea.
   * Supports screenshots from OS, copied images from browsers, etc.
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    let pastedAny = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          addImageFromFile(file);
          pastedAny = true;
        }
      }
    }
    if (pastedAny) {
      // Prevent default paste behavior so the binary garbage doesn't end up
      // as text in the textarea
      e.preventDefault();
    }
  };

  /**
   * Drag-and-drop image support on the input container.
   */
  const [dragActive, setDragActive] = useState(false);
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragActive) setDragActive(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = e.dataTransfer?.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (file.type.startsWith('image/')) addImageFromFile(file);
    });
  };

  const removeImage = (index: number) => setImages((prev) => prev.filter((_, i) => i !== index));

  const sendMessage = async () => {
    if ((!input.trim() && images.length === 0) || streaming) return;

    // Resolve provider+model from active workspace selection
    const { providerId, model } = resolveWorkspaceModel(activeWorkspace);

    // Compute the user-visible provider name for this dispatch so we
    // can show it in the streaming pill + assistant footer. Falls back
    // through: provider catalog (matched by id) -> 'Combo' for combo
    // mode -> 'Prometheus' as last resort.
    const dispatchProviderName: string =
      providerId === 'combo'
        ? 'Combo'
        : providerCatalogs.find((p) => p.id === providerId)?.name ?? 'Prometheus';

    const userMessage = input;
    const userImages = [...images];
    setInput(''); setImages([]); setStreaming(true); setStreamContent(''); setRoutingNotice(null); setBridgeNotice(null);
    setStreamingProviderName(dispatchProviderName);
    setStreamingModel(model);

    const tempMsg: Message = {
      id: 'temp-' + Date.now(),
      role: 'user',
      content: userMessage,
      images: JSON.stringify(userImages),
      model,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

    // Fresh AbortController for this turn. Stop button calls .abort()
    // which throws DOMException 'AbortError' from the fetch + reader.
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      // Read CSRF cookie to satisfy the middleware on POST
      const csrf = typeof document !== 'undefined'
        ? (document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/)?.[1] ?? '')
        : '';

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf) },
        body: JSON.stringify({
          conversationId: currentConv,
          message: userMessage,
          images: userImages,
          providerId,
          model,
          workspace: activeWorkspace,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Error sending message');
        setStreaming(false);
        return;
      }

      const convId = res.headers.get('X-Conversation-Id');
      if (convId && !currentConv) { setCurrentConv(convId); fetchConversations(); }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      while (reader) {
        // Reading is also abortable — when ctrl.abort() fires the
        // underlying body stream errors and read() rejects with
        // AbortError. We catch it below and treat the partial
        // fullContent as the final message.
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const p = JSON.parse(data);
            if (p.rerouted) {
              setRoutingNotice({ from: p.from, to: p.to, model: p.model });
              continue;
            }
            if (p.visionBridge) {
              setBridgeNotice({
                providerName: p.providerName,
                imageCount: p.imageCount,
                fromCacheCount: p.fromCacheCount,
                latencyMs: p.latencyMs,
                warning: p.warning,
              });
              continue;
            }
            if (p.comboFallback) {
              setRoutingNotice({
                from: p.comboName || 'combo step 1',
                to: p.winningProvider,
                model: p.winningModel,
              });
              continue;
            }
            if (p.content) {
              fullContent += p.content;
              setStreamContent(fullContent);
            }
          } catch { /* malformed chunk */ }
        }
      }

      if (fullContent) {
        setMessages((prev) => [...prev, {
          id: 'a-' + Date.now(),
          role: 'assistant',
          content: fullContent,
          images: '[]',
          model,
          providerName: dispatchProviderName,
          createdAt: new Date().toISOString(),
        }]);
      }
    } catch (err) {
      // AbortError is the user clicking Stop — keep what was already
      // streamed and present it as a complete (if truncated) message.
      const aborted = (err as { name?: string })?.name === 'AbortError';
      if (aborted) {
        const partial = streamContent;
        if (partial) {
          setMessages((prev) => [...prev, {
            id: 'a-' + Date.now(),
            role: 'assistant',
            content: partial + '\n\n_(stopped)_',
            images: '[]',
            model,
            providerName: dispatchProviderName,
            createdAt: new Date().toISOString(),
          }]);
        }
      } else {
        console.error(err);
        alert('Connection error');
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setStreamContent('');
      setStreamingProviderName('');
      setStreamingModel('');
      fetchConversations();
    }
  };

  /**
   * Stop the in-flight stream. Aborts both the fetch and the reader
   * via AbortController. Whatever was already streamed becomes the
   * final assistant message.
   */
  const stopStreaming = () => {
    abortRef.current?.abort();
  };

  /**
   * Edit a previously sent user message.
   *
   * Steps:
   *   1. Drop the edited message + every message after it from local
   *      state (so the chat looks like the conversation rewound to
   *      that point).
   *   2. Drop the same range server-side via DELETE /api/messages/[id]
   *      so the next /api/chat call doesn't have a stale tail in
   *      history.
   *   3. Pre-fill the input with the edited text + restore any images
   *      that were attached to the original. User tweaks + sends.
   *
   * If the message is a temp one (id starts with 'temp-') it never
   * persisted server-side, so we skip the DELETE call.
   */
  const editUserMessage = async (msgId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg || msg.role !== 'user') return;

    // Stop any in-flight reply first — we're about to rewind history
    // and don't want a partial response landing on top.
    if (streaming) stopStreaming();

    // Drop from this message onward in local state
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    setMessages((prev) => prev.slice(0, idx));

    // Restore the input with the message text + images so the user
    // can tweak before re-sending.
    setInput(msg.content);
    try {
      const imgs = JSON.parse(msg.images || '[]') as string[];
      setImages(imgs);
    } catch {
      setImages([]);
    }
    textareaRef.current?.focus();

    // Server-side cleanup for persisted messages only (skip temp ones).
    if (!msg.id.startsWith('temp-')) {
      const csrf = typeof document !== 'undefined'
        ? (document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/)?.[1] ?? '')
        : '';
      try {
        await fetch(`/api/messages/${msg.id}`, {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': decodeURIComponent(csrf) },
        });
      } catch {
        // Non-fatal — local state is already rewound; the next /api/chat
        // call will re-sync its own view. Worst case: server has stale
        // history that the dispatcher will re-include in the prompt.
      }
    }
  };

  const newChat = () => {
    setCurrentConv(null);
    setMessages([]);
    setStreamContent('');
    setRoutingNotice(null);
    setBridgeNotice(null);
  };

  const deleteConversation = async (convId: string) => {
    if (!confirm('Delete this conversation?')) return;
    const csrf = typeof document !== 'undefined'
      ? (document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/)?.[1] ?? '')
      : '';
    await fetch(`/api/conversations/${convId}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': decodeURIComponent(csrf) },
    });
    if (currentConv === convId) { setCurrentConv(null); setMessages([]); }
    fetchConversations();
  };

  const exportChat = () => {
    const content = messages.map((m) => `## ${m.role === 'user' ? 'You' : 'Assistant'}\n\n${m.content}`).join('\n\n---\n\n');
    const blob = new Blob([content], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat-${Date.now()}.md`;
    a.click();
  };

  /** When user clicks a Recent conversation, also switch to its workspace */
  const openConversation = (conv: Conversation) => {
    setCurrentConv(conv.id);
    if (conv.workspace) {
      setActiveWorkspace(normalizeWorkspaceId(conv.workspace));
    }
  };

  if (initialLoad) {
    return <LoadingState fullScreen message="Loading workspace..." />;
  }

  // Conversations filtered to the active workspace - sidebar Recent shows
  // only chats from this workspace so each scope stays clean.
  const recentConvs = conversations.filter(
    (c) => normalizeWorkspaceId(c.workspace) === activeWorkspace,
  );

  // Vision routing decision is based on the resolved model/provider for
  // this workspace (used to warn user before sending images).
  const { providerId: resolvedProviderId, model: resolvedModel } = resolveWorkspaceModel(activeWorkspace);
  const resolvedProviderObj = providers.find(p => p.id === resolvedProviderId);
  const resolvedIsKiroBacked = resolvedProviderId === 'combo'
    ? true  // combos primarily use built-in pool, treat as Kiro-backed for warning
    : resolvedProviderObj
      ? isKiroBacked(resolvedProviderObj as ProviderLike, Boolean(resolvedProviderObj.builtin))
      : true;
  const visionFallback = resolvedIsKiroBacked
    ? pickVisionFallback(providers.filter(p => !p.builtin) as ProviderLike[])
    : null;
  const imagesWillFail = images.length > 0 && resolvedIsKiroBacked && !visionFallback;
  const imagesWillReroute = images.length > 0 && resolvedIsKiroBacked && visionFallback;

  const activeWs = findWorkspace(activeWorkspace);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile drawer backdrop - tap to close. Hidden on lg+ where sidebar is permanent. */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — ChatGPT-style: New chat → Workspace boxes → Recent → User pill.
          Glass effect over the atmospheric background instead of solid color
          so the workspace accent gradient bleeds through subtly.

          Responsive behavior:
          - Mobile (<lg): Fixed drawer that slides in from left when open.
          - lg+:          Permanent sidebar in flow.
      */}
      <aside
        className={`
          fixed lg:relative inset-y-0 left-0 z-40 w-72 max-w-[85vw]
          bg-surface-1
          border-r border-hairline flex flex-col overflow-hidden shrink-0
          transition-transform duration-300 ease-out
          ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* New Chat (top) */}
        <div className="p-3">
          <button
            onClick={newChat}
            className="w-full py-2 px-3 border border-hairline bg-surface-1 rounded-lg text-ink text-sm font-medium hover:bg-surface-2 hover:border-hairline-strong hover-lift flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New chat
          </button>
        </div>

        {/* Workspace boxes */}
        <div className="px-3 pb-2 space-y-1.5">
          {WORKSPACES.map((ws) => (
            <WorkspaceBox
              key={ws.id}
              workspace={ws}
              combos={combosForWorkspace(ws.id)}
              providers={providerCatalogs}
              selection={effectiveSelection(ws.id)}
              isActive={activeWorkspace === ws.id}
              onActivate={() => activateWorkspace(ws.id)}
              onSelectionChange={(sel) => handleWorkspaceSelectionChange(ws.id, sel)}
            />
          ))}
        </div>

        {/* Recent (filtered to active workspace) */}
        <div className="flex-1 overflow-y-auto px-3 mt-1">
          <div className="flex items-center justify-between px-1 mb-1">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-txt-muted">
              Recent · <span className="ws-tint-text">{activeWs?.name ?? 'General'}</span>
            </p>
            <span className="text-[10px] text-txt-faint tabular-nums">{recentConvs.length}</span>
          </div>
          {recentConvs.length === 0 ? (
            <p className="text-center text-txt-faint text-xs py-4 px-2 leading-relaxed">
              No chats in this workspace yet
            </p>
          ) : (
            <div className="space-y-0.5">
              {recentConvs.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => openConversation(conv)}
                  style={
                    currentConv === conv.id
                      ? {
                          background: 'rgba(var(--ws-active-glow) / 0.12)',
                          borderLeft: '2px solid rgba(var(--ws-active-glow) / 0.7)',
                        }
                      : undefined
                  }
                  className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-all ${
                    currentConv === conv.id
                      ? 'text-ink pl-2'
                      : 'text-ink-muted hover:text-ink hover:bg-surface-2'
                  }`}
                >
                  <span className="text-[13px] truncate flex-1">{conv.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-txt-muted hover:text-red-400 transition-all shrink-0"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* User pill (bottom, animated menu) */}
        <div className="p-3 border-t border-hairline">
          {user && <UserPill username={user.username} role={user.role} />}
        </div>
      </aside>

      {/* Main area — splits into chat + side panel based on workspace.
          General workspace: chat-only, full width.
          Coding: chat | code panel (split 60/40).
          Trading: chat | market view (split 55/45). */}
      <div className="flex-1 flex min-w-0">
        <main className={`flex flex-col min-w-0 ${
          activeWorkspace === 'general' ? 'flex-1' : 'flex-[3]'
        }`}>
          {/* Header — minimal, just shows current workspace + export */}
          <header className="h-12 border-b border-hairline flex items-center px-3 lg:px-4 gap-2 lg:gap-3 shrink-0 bg-canvas">
            {/* Hamburger - only on mobile/tablet */}
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden text-txt-muted hover:text-white p-1 -ml-1 transition-colors btn-squash"
              aria-label="Open sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            <div className="flex items-center gap-2 min-w-0 flex-1">
            <span
              className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-base"
              style={{
                background: 'linear-gradient(135deg, rgba(var(--ws-active-glow) / 0.25), rgba(var(--ws-active-glow) / 0.1))',
                border: '1px solid rgba(var(--ws-active-glow) / 0.4)',
                color: 'var(--ws-active-bright)',
              }}
            >
              {activeWs?.icon}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{activeWs?.name ?? 'General'}</p>
              <p className="text-[10px] text-txt-muted truncate font-mono">
                {resolvedProviderId === 'combo' ? (
                  <>combo: <span className="ws-tint-text">{resolvedModel}</span></>
                ) : (
                  resolvedModel
                )}
              </p>
            </div>
          </div>

            <div className="flex items-center gap-1 ml-auto">
              {/* Side panel toggle - only show when there's a workspace panel + on tablet/foldable */}
              {(activeWorkspace === 'coding' || activeWorkspace === 'trading') && (
                <button
                  type="button"
                  onClick={() => setSidePanelOpen(!sidePanelOpen)}
                  className="lg:hidden text-ink-subtle hover:text-ink p-1.5 rounded-md hover:bg-surface-2 transition-all btn-squash"
                  aria-label={sidePanelOpen ? 'Close panel' : 'Open panel'}
                  title={activeWorkspace === 'coding' ? 'Code artifacts' : 'Market view'}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </button>
              )}
              {messages.length > 0 && (
                <Button variant="ghost" size="xs" onClick={exportChat}>
                  Export
                </Button>
              )}
            </div>
          </header>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            {messages.length === 0 && !streaming ? (
              <div className="flex items-center justify-center h-full px-3 fold:px-4 py-6">
                <div className="text-center max-w-md w-full animate-spring">
                  <div
                    className="w-14 h-14 fold:w-16 fold:h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 fold:mb-5 text-2xl fold:text-3xl"
                    style={{
                      background: 'linear-gradient(135deg, rgba(var(--ws-active-glow) / 0.2), rgba(var(--ws-active-glow) / 0.05))',
                      border: '1px solid rgba(var(--ws-active-glow) / 0.3)',
                      boxShadow: '0 8px 32px -8px rgba(var(--ws-active-glow) / 0.4)',
                    }}
                  >
                    {activeWs?.icon}
                  </div>
                  <p className="text-white text-base fold:text-lg font-semibold leading-tight">
                    {activeWs?.name === 'Coding' && 'Ready to build something?'}
                    {activeWs?.name === 'Trading' && 'What\u2019s the market saying?'}
                    {(activeWs?.name === 'General' || !activeWs) && 'How can I help today?'}
                  </p>
                  <p className="text-txt-muted text-xs fold:text-sm mt-1.5 leading-relaxed px-2">
                    {activeWs?.description ?? 'Type a message or upload an image'}
                  </p>

                  {/* Suggested prompts per workspace - clicking sets the input */}
                  <div className="mt-5 fold:mt-6 grid grid-cols-1 fold:grid-cols-2 gap-2">
                    {(activeWs?.name === 'Coding'
                      ? [
                          { icon: '\u{1F41B}', text: 'Why is my useEffect running infinitely?' },
                          { icon: '\u26A1', text: 'Optimize this SQL query for read-heavy load' },
                          { icon: '\u{1F9EA}', text: 'Write tests for this function' },
                          { icon: '\u{1F50D}', text: 'Review this PR for security issues' },
                        ]
                      : activeWs?.name === 'Trading'
                      ? [
                          { icon: '\u{1F4C8}', text: 'Read this BTC chart \u2014 what\u2019s the setup?' },
                          { icon: '\u{1F50D}', text: 'Explain the BTC dominance index' },
                          { icon: '\u26A0\uFE0F', text: 'Risk-manage a $10k portfolio for Q2' },
                          { icon: '\u{1F4F0}', text: 'Summarize today\u2019s key macro news' },
                        ]
                      : [
                          { icon: '\u270D\uFE0F', text: 'Help me draft an email to my team' },
                          { icon: '\u{1F4DA}', text: 'Explain quantum computing simply' },
                          { icon: '\u{1F4A1}', text: 'Brainstorm 5 names for a new product' },
                          { icon: '\u{1F30D}', text: 'Plan a 7-day trip to Bali' },
                        ]).map((p, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setInput(p.text);
                          textareaRef.current?.focus();
                        }}
                        className="text-left px-3 py-2.5 rounded-xl bg-surface-1 hover:bg-surface-2 border border-hairline hover:border-hairline-strong hover-lift text-xs text-ink-muted hover:text-ink flex items-start gap-2 group/sug transition-all"
                      >
                        <span className="shrink-0 text-base group-hover/sug:scale-110 transition-transform">{p.icon}</span>
                        <span className="leading-snug">{p.text}</span>
                      </button>
                    ))}
                  </div>

                  {resolvedProviderId === 'combo' && (
                    <p className="text-[11px] text-txt-faint mt-5 font-mono">
                      Using combo <span className="ws-tint-text">{resolvedModel}</span>
                    </p>
                  )}
                </div>
              </div>
            ) : (
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
              {messages.map((msg) => (
                <div key={msg.id} className="animate-fade-in">
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] group/usr">
                        {msg.images && JSON.parse(msg.images).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2 justify-end">
                            {JSON.parse(msg.images).map((img: string, i: number) => (
                              <img key={i} src={img} alt="" className="max-w-48 max-h-48 rounded-lg border border-edge" />
                            ))}
                          </div>
                        )}
                        <div className="bg-white text-black rounded-2xl rounded-br-md px-4 py-2.5">
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                        </div>
                        {/* Edit affordance — only on user turns, hidden until hover.
                            Disabled while streaming so we don't race the abort path. */}
                        <div className="flex justify-end mt-1.5 opacity-0 group-hover/usr:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => editUserMessage(msg.id)}
                            className="text-[11px] text-ink-subtle hover:text-ink inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-surface-2 transition-colors"
                            title="Edit & resend"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Edit
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-start">
                      <div className="max-w-[90%] w-full">
                        <div className="prose">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                        {/*
                          Footer shows "Provider · Model" when we know
                          the provider (newer messages tagged at send
                          time), else just the formatted model. Server-
                          loaded history won't have providerName so
                          formatModelDisplay alone is the fallback.
                        */}
                        <div className="mt-2 text-[11px] text-ink-subtle inline-flex items-center gap-1.5" title={msg.model}>
                          {msg.providerName && (
                            <>
                              <span className="font-medium text-ink-muted">{msg.providerName}</span>
                              <span className="text-ink-subtle/60">·</span>
                            </>
                          )}
                          <span>{formatModelDisplay(msg.model)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {routingNotice && (
                <div className="animate-fade-in mb-2">
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 text-xs text-blue-300 inline-flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    <span>
                      Image detected. {routingNotice.from} can&apos;t see images, so this message routes to{' '}
                      <span className="font-medium text-blue-200">{routingNotice.to}</span>
                      {' '}<span className="text-blue-400/60">({formatModelDisplay(routingNotice.model)})</span>
                    </span>
                  </div>
                </div>
              )}

              {bridgeNotice && (
                <div className="animate-fade-in mb-2">
                  {bridgeNotice.warning ? (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-xs text-amber-300 inline-flex items-start gap-2">
                      <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span>
                        <span className="font-medium">Vision bridge unavailable.</span>{' '}
                        {bridgeNotice.warning}
                      </span>
                    </div>
                  ) : (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 text-xs text-emerald-300 inline-flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      <span>
                        Vision bridge via{' '}
                        <span className="font-medium text-emerald-200">{bridgeNotice.providerName}</span>
                        {' · '}
                        <span className="tabular-nums">
                          {bridgeNotice.imageCount} image{bridgeNotice.imageCount !== 1 ? 's' : ''}
                        </span>
                        {bridgeNotice.fromCacheCount > 0 && (
                          <span className="text-emerald-400/70"> ({bridgeNotice.fromCacheCount} cached)</span>
                        )}
                        {bridgeNotice.latencyMs > 0 && (
                          <span className="text-emerald-400/60"> · {bridgeNotice.latencyMs}ms</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/*
                In-flight provider+model pill. Tells the user "Genfity ·
                Claude Haiku 4.5 is replying" the instant they hit
                send — no waiting for the first token to confirm where
                their request went.
              */}
              {streaming && streamingProviderName && (
                <div className="animate-fade-in">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-2 border border-hairline rounded-full text-[11px] text-ink-muted">
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgba(var(--ws-active-glow) / 0.9)' }}></span>
                    <span className="font-medium text-ink">{streamingProviderName}</span>
                    <span className="text-ink-subtle/60">·</span>
                    <span title={streamingModel}>{formatModelDisplay(streamingModel)}</span>
                  </div>
                </div>
              )}

              {streaming && streamContent && (
                <div className="animate-fade-in">
                  <div className="max-w-[90%] w-full">
                    <div className="prose">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamContent}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}

              {streaming && !streamContent && (
                <div className="flex gap-1.5 py-2 items-center">
                  <div
                    className="w-2 h-2 rounded-full animate-wave-dot"
                    style={{ background: 'rgba(var(--ws-active-glow) / 0.9)' }}
                  ></div>
                  <div
                    className="w-2 h-2 rounded-full animate-wave-dot"
                    style={{ background: 'rgba(var(--ws-active-glow) / 0.9)', animationDelay: '0.15s' }}
                  ></div>
                  <div
                    className="w-2 h-2 rounded-full animate-wave-dot"
                    style={{ background: 'rgba(var(--ws-active-glow) / 0.9)', animationDelay: '0.3s' }}
                  ></div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Image preview */}
        {images.length > 0 && (
          <div className="px-4 py-2.5 border-t border-edge max-w-3xl mx-auto w-full">
            <p className="text-[11px] text-txt-muted mb-2 uppercase tracking-wider">Attached images</p>
            <div className="flex gap-2 flex-wrap">
              {images.map((img, i) => (
                <div key={i} className="relative group">
                  <img src={img} alt="" className="w-16 h-16 object-cover rounded-lg border border-edge" />
                  <button onClick={() => removeImage(i)} className="absolute -top-1 -right-1 w-5 h-5 bg-surface-3 border border-edge-hover rounded-full flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/30 hover:border-red-500">x</button>
                </div>
              ))}
            </div>

            {imagesWillReroute && visionFallback && (
              <p className="mt-2 text-[11px] text-blue-300/90 leading-relaxed">
                <span className="font-medium">Heads up:</span> {activeWs?.name} workspace can&apos;t see images.
                This message will route to <span className="text-blue-200 font-medium">{visionFallback.provider.name}</span>{' '}
                <span className="text-blue-400/60">({formatModelDisplay(visionFallback.model)})</span> instead.
              </p>
            )}
            {imagesWillFail && (
              <p className="mt-2 text-[11px] text-amber-300/90 leading-relaxed">
                <span className="font-medium">Image will be ignored.</span> {activeWs?.name} workspace uses Kiro
                which can&apos;t see images, and you don&apos;t have a vision-capable provider configured.{' '}
                <a href="/settings" className="underline hover:text-amber-200">Add OpenAI or Gemini in Settings</a> to enable image analysis.
              </p>
            )}
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-edge">
          <div className="max-w-3xl mx-auto">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`flex items-end gap-2 bg-surface-1 border rounded-xl px-3 py-2 transition-all ${
                dragActive
                  ? 'border-white ring-2 ring-white/30 bg-surface-2'
                  : 'border-edge focus-within:border-edge-hover focus-within:ring-1 focus-within:ring-edge-hover/50'
              }`}
            >
              <button onClick={() => fileInputRef.current?.click()} className="text-txt-muted hover:text-white transition-colors p-1.5 shrink-0 self-end" title="Upload image">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                onPaste={handlePaste}
                placeholder={dragActive ? 'Drop image here…' : 'Message… (paste or drag image)'}
                className="flex-1 bg-transparent text-sm text-white placeholder:text-txt-ghost focus:outline-none resize-none max-h-40 leading-relaxed py-1.5"
                rows={1}
              />
              {/*
                Send / Stop toggle. While a stream is in flight, the
                send button morphs into a Stop button (red square icon)
                that calls AbortController.abort(). The user gets
                immediate cancel — no waiting for the model to finish.
              */}
              {streaming ? (
                <button
                  onClick={stopStreaming}
                  className="bg-red-500/90 hover:bg-red-500 text-white btn-squash p-1.5 rounded-md shrink-0 self-end transition-colors"
                  title="Stop generating"
                  aria-label="Stop generating"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() && images.length === 0}
                  style={
                    input.trim() || images.length > 0
                      ? {
                          background: `linear-gradient(135deg, var(--ws-active), var(--ws-active-bright))`,
                          boxShadow: `0 4px 16px -4px rgba(var(--ws-active-glow) / 0.6)`,
                        }
                      : undefined
                  }
                  className="text-white disabled:bg-surface-3 disabled:text-txt-faint disabled:cursor-not-allowed disabled:shadow-none btn-squash p-1.5 rounded-md shrink-0 self-end"
                  title="Send"
                  aria-label="Send"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </div>
            <p className="hidden fold:block text-[11px] text-txt-muted text-center mt-2">
              <kbd className="px-1.5 py-0.5 bg-surface-2 border border-edge rounded text-[10px]">Enter</kbd> send ·
              <kbd className="px-1.5 py-0.5 bg-surface-2 border border-edge rounded text-[10px]">Shift+Enter</kbd> new line ·
              <kbd className="px-1.5 py-0.5 bg-surface-2 border border-edge rounded text-[10px]">Ctrl+V</kbd> paste image
            </p>
          </div>
        </div>
        </main>

        {/*
         * Workspace-specific side panel.
         *
         * Responsive behavior:
         *   lg+ (≥1024px): Permanent right column, fills available space.
         *   Below lg:      Bottom sheet that slides up from bottom when
         *                  user taps the panel button in header. Backdrop
         *                  closes it. Only renders when sidePanelOpen.
         *
         * The same component renders in both modes - just wrapped differently.
         */}
        {(activeWorkspace === 'coding' || activeWorkspace === 'trading') && (
          <>
            {/* Desktop: permanent right column */}
            <div className="hidden lg:flex flex-[2] min-w-[320px] flex-col">
              {activeWorkspace === 'coding' ? (
                <CodingPanel messages={messages} />
              ) : (
                <TradingPanel messages={messages} />
              )}
            </div>

            {/* Tablet/foldable/phone: bottom sheet that slides up */}
            {sidePanelOpen && (
              <>
                {/* Backdrop */}
                <div
                  className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden animate-fade-in"
                  onClick={() => setSidePanelOpen(false)}
                  aria-hidden="true"
                />
                {/* Sheet - takes 80% viewport height, slides from bottom */}
                <div
                  className="fixed inset-x-0 bottom-0 z-40 lg:hidden bg-surface-1 border-t border-hairline-strong rounded-t-2xl shadow-2xl flex flex-col animate-sheet-up"
                  style={{ height: '85vh', maxHeight: '85vh' }}
                >
                  {/* Drag handle */}
                  <div className="flex justify-center py-2 shrink-0">
                    <div className="w-10 h-1 rounded-full bg-edge-hover/50"></div>
                  </div>
                  {/* Close button top right */}
                  <button
                    type="button"
                    onClick={() => setSidePanelOpen(false)}
                    className="absolute top-3 right-3 text-txt-muted hover:text-white p-1 rounded transition-colors"
                    aria-label="Close panel"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <div className="flex-1 min-h-0">
                    {activeWorkspace === 'coding' ? (
                      <CodingPanel messages={messages} />
                    ) : (
                      <TradingPanel messages={messages} />
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
