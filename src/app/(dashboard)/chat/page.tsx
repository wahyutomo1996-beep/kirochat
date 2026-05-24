'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/Button';
import { LoadingState } from '@/components/LoadingState';
import { WorkspaceBox } from '@/components/WorkspaceBox';
import { UserPill } from '@/components/UserPill';
import { isKiroBacked, pickVisionFallback, type ProviderLike } from '@/lib/vision';
import { WORKSPACES, findWorkspace, normalizeWorkspaceId } from '@/lib/workspaces';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images: string;
  model: string;
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

/** localStorage key for per-workspace combo override */
const WORKSPACE_COMBO_KEY = 'prometheus.workspace.combo';

/** Read persisted combo selections from localStorage */
function loadWorkspaceCombos(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(WORKSPACE_COMBO_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveWorkspaceCombos(map: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WORKSPACE_COMBO_KEY, JSON.stringify(map));
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
  const [routingNotice, setRoutingNotice] = useState<{ from: string; to: string; model: string } | null>(null);
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);

  /** Active workspace - drives Recent filter, default combo, system prompt */
  const [activeWorkspace, setActiveWorkspace] = useState<string>('general');
  /** Per-workspace combo selection (persisted to localStorage) */
  const [workspaceCombos, setWorkspaceCombos] = useState<Record<string, string>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initial bootstrap
  useEffect(() => {
    Promise.all([fetchUser(), fetchProviders(), fetchConversations(), fetchCombos()])
      .finally(() => setInitialLoad(false));
    // Restore per-workspace combo overrides from localStorage
    setWorkspaceCombos(loadWorkspaceCombos());
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

  const fetchMessages = async (convId: string) => {
    const res = await fetch(`/api/conversations/${convId}`);
    if (res.ok) { const data = await res.json(); setMessages(data.conversation.messages); }
  };

  /**
   * Resolve the (providerId, model) to send to /api/chat for a workspace.
   *
   * Priority:
   *   1. User-overridden combo for this workspace -> use it
   *   2. Default combo of the workspace, IF user has it instantiated
   *   3. First combo matching the workspace category (any other slug)
   *   4. Built-in Prometheus pool with workspace.fallbackModel
   *
   * Returns { providerId, model } that the chat backend understands.
   */
  const resolveWorkspaceModel = useCallback(
    (workspaceId: string): { providerId: string; model: string } => {
      const ws = findWorkspace(workspaceId);
      if (!ws) {
        return { providerId: '__prometheus__', model: 'kiro/claude-sonnet-4.6' };
      }

      // 1. User override for this workspace
      const overrideSlug = workspaceCombos[workspaceId];
      if (overrideSlug) {
        const found = combos.find((c) => c.slug === overrideSlug);
        if (found) return { providerId: 'combo', model: found.slug };
      }

      // 2. Workspace's default combo if user instantiated it
      const defaultCombo = combos.find((c) => c.slug === ws.defaultComboSlug);
      if (defaultCombo) return { providerId: 'combo', model: defaultCombo.slug };

      // 3. Any combo matching this category
      const matchingCategory = combos.find((c) => c.category === workspaceId);
      if (matchingCategory) return { providerId: 'combo', model: matchingCategory.slug };

      // 4. Raw built-in fallback model
      return { providerId: '__prometheus__', model: ws.fallbackModel };
    },
    [combos, workspaceCombos],
  );

  /** Combos available for a given workspace (matched by category) */
  const combosForWorkspace = useCallback(
    (workspaceId: string): ChatCombo[] => {
      return combos.filter((c) => c.category === workspaceId);
    },
    [combos],
  );

  /** User picks a different combo for a workspace - persist to localStorage */
  const handleWorkspaceComboChange = (workspaceId: string, slug: string) => {
    const next = { ...workspaceCombos, [workspaceId]: slug };
    if (!slug) delete next[workspaceId];
    setWorkspaceCombos(next);
    saveWorkspaceCombos(next);
  };

  /** Activate a workspace + start a fresh chat in it */
  const activateWorkspace = (workspaceId: string) => {
    const normalized = normalizeWorkspaceId(workspaceId);
    setActiveWorkspace(normalized);
    setCurrentConv(null);
    setMessages([]);
    setStreamContent('');
    setRoutingNotice(null);
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

    const userMessage = input;
    const userImages = [...images];
    setInput(''); setImages([]); setStreaming(true); setStreamContent(''); setRoutingNotice(null);

    const tempMsg: Message = {
      id: 'temp-' + Date.now(),
      role: 'user',
      content: userMessage,
      images: JSON.stringify(userImages),
      model,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMsg]);

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
          createdAt: new Date().toISOString(),
        }]);
      }
    } catch (err) {
      console.error(err);
      alert('Connection error');
    } finally {
      setStreaming(false);
      setStreamContent('');
      fetchConversations();
    }
  };

  const newChat = () => {
    setCurrentConv(null);
    setMessages([]);
    setStreamContent('');
    setRoutingNotice(null);
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
      {/* Sidebar — ChatGPT-style: New chat → Workspace boxes → Recent → User pill.
          Glass effect over the atmospheric background instead of solid color
          so the workspace accent gradient bleeds through subtly. */}
      <aside className="w-72 transition-all duration-200 bg-surface-1/40 backdrop-blur-xl border-r border-edge/60 flex flex-col overflow-hidden shrink-0">
        {/* New Chat (top) */}
        <div className="p-3">
          <button
            onClick={newChat}
            className="w-full py-2 px-3 border border-edge bg-surface-1/60 backdrop-blur-sm rounded-lg text-white text-sm font-medium hover:bg-surface-2/80 hover:border-edge-hover hover-lift flex items-center gap-2"
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
              selectedComboSlug={
                workspaceCombos[ws.id] ??
                (combos.find((c) => c.slug === ws.defaultComboSlug) ? ws.defaultComboSlug : '')
              }
              isActive={activeWorkspace === ws.id}
              onActivate={() => activateWorkspace(ws.id)}
              onComboChange={(slug) => handleWorkspaceComboChange(ws.id, slug)}
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
                      ? 'text-white pl-2'
                      : 'text-txt-secondary hover:text-white hover:bg-surface-2/60'
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
        <div className="p-3 border-t border-edge/60">
          {user && <UserPill username={user.username} role={user.role} />}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header — minimal, just shows current workspace + export */}
        <header className="h-12 border-b border-edge/60 flex items-center px-4 gap-3 shrink-0 bg-surface-0/40 backdrop-blur-xl">
          <div className="flex items-center gap-2 min-w-0">
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

          {messages.length > 0 && (
            <Button variant="ghost" size="xs" onClick={exportChat} className="ml-auto">
              Export
            </Button>
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 && !streaming ? (
            <div className="flex items-center justify-center h-full px-4">
              <div className="text-center max-w-md animate-spring">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 text-3xl"
                  style={{
                    background: 'linear-gradient(135deg, rgba(var(--ws-active-glow) / 0.2), rgba(var(--ws-active-glow) / 0.05))',
                    border: '1px solid rgba(var(--ws-active-glow) / 0.3)',
                    boxShadow: '0 8px 32px -8px rgba(var(--ws-active-glow) / 0.4)',
                  }}
                >
                  {activeWs?.icon}
                </div>
                <p className="text-white text-lg font-semibold">
                  {activeWs?.name === 'Coding' && 'Ready to build something?'}
                  {activeWs?.name === 'Trading' && 'What\u2019s the market saying?'}
                  {(activeWs?.name === 'General' || !activeWs) && 'How can I help today?'}
                </p>
                <p className="text-txt-muted text-sm mt-1.5 leading-relaxed">
                  {activeWs?.description ?? 'Type a message or upload an image'}
                </p>
                {resolvedProviderId === 'combo' && (
                  <p className="text-[11px] text-txt-faint mt-3 font-mono">
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
                      <div className="max-w-[80%]">
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
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-start">
                      <div className="max-w-[90%] w-full">
                        <div className="prose">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                        <div className="mt-2 text-[11px] text-txt-faint font-mono">{msg.model}</div>
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
                      {' '}<span className="text-blue-400/60">({routingNotice.model})</span>
                    </span>
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
                <span className="text-blue-400/60">({visionFallback.model})</span> instead.
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
              <button onClick={sendMessage} disabled={streaming || (!input.trim() && images.length === 0)}
                className="bg-white text-black hover:bg-brand-dim disabled:bg-surface-3 disabled:text-txt-faint disabled:cursor-not-allowed transition-colors p-1.5 rounded-md shrink-0 self-end">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
            </div>
            <p className="text-[11px] text-txt-muted text-center mt-2">
              <kbd className="px-1.5 py-0.5 bg-surface-2 border border-edge rounded text-[10px]">Enter</kbd> send ·
              <kbd className="px-1.5 py-0.5 bg-surface-2 border border-edge rounded text-[10px]">Shift+Enter</kbd> new line ·
              <kbd className="px-1.5 py-0.5 bg-surface-2 border border-edge rounded text-[10px]">Ctrl+V</kbd> paste image
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
