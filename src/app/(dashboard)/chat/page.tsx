'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/Button';
import { LoadingState } from '@/components/LoadingState';

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
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConv, setCurrentConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initial bootstrap
  useEffect(() => {
    Promise.all([fetchUser(), fetchProviders(), fetchConversations()])
      .finally(() => setInitialLoad(false));
  }, []);

  useEffect(() => { if (currentConv) fetchMessages(currentConv); }, [currentConv]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamContent]);

  // Load models on provider change - cache aware
  useEffect(() => {
    if (!selectedProvider) return;
    const provider = providers.find(p => p.id === selectedProvider);
    if (!provider) return;
    const cached = JSON.parse(provider.models || '[]');
    if (cached.length > 0) {
      setModels(cached);
      if (!cached.includes(selectedModel)) setSelectedModel(cached[0]);
    } else {
      fetchModels(selectedProvider);
    }
  }, [selectedProvider, providers]);

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
    const defaultP = data.providers.find((p: Provider) => p.isDefault) || data.providers[0];
    if (defaultP) {
      setSelectedProvider(defaultP.id);
      const cached = JSON.parse(defaultP.models || '[]');
      if (cached.length > 0) { setModels(cached); setSelectedModel(cached[0]); }
    }
  };

  const fetchModels = useCallback(async (providerId: string) => {
    const res = await fetch(`/api/providers/${providerId}/models`);
    if (res.ok) {
      const data = await res.json();
      setModels(data.models);
      if (data.models.length > 0 && !data.models.includes(selectedModel)) setSelectedModel(data.models[0]);
    }
  }, [selectedModel]);

  const fetchConversations = async () => {
    const res = await fetch('/api/conversations');
    if (res.ok) { const data = await res.json(); setConversations(data.conversations); }
  };

  const fetchMessages = async (convId: string) => {
    const res = await fetch(`/api/conversations/${convId}`);
    if (res.ok) { const data = await res.json(); setMessages(data.conversation.messages); }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (file.size > 5 * 1024 * 1024) {
        alert(`Image ${file.name} too large (max 5MB)`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => setImages((prev) => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeImage = (index: number) => setImages((prev) => prev.filter((_, i) => i !== index));

  const sendMessage = async () => {
    if ((!input.trim() && images.length === 0) || streaming) return;
    if (!selectedProvider || !selectedModel) {
      alert('Pilih provider dan model dulu di Settings');
      return;
    }

    const userMessage = input;
    const userImages = [...images];
    setInput(''); setImages([]); setStreaming(true); setStreamContent('');

    const tempMsg: Message = { id: 'temp-' + Date.now(), role: 'user', content: userMessage, images: JSON.stringify(userImages), model: selectedModel, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, tempMsg]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: currentConv, message: userMessage, images: userImages, providerId: selectedProvider, model: selectedModel }),
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
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const p = JSON.parse(data);
              if (p.content) { fullContent += p.content; setStreamContent(fullContent); }
            } catch {}
          }
        }
      }

      if (fullContent) {
        setMessages((prev) => [...prev, { id: 'a-' + Date.now(), role: 'assistant', content: fullContent, images: '[]', model: selectedModel, createdAt: new Date().toISOString() }]);
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

  const newChat = () => { setCurrentConv(null); setMessages([]); };

  const deleteConversation = async (convId: string) => {
    if (!confirm('Delete this conversation?')) return;
    await fetch(`/api/conversations/${convId}`, { method: 'DELETE' });
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

  const logout = () => {
    document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.location.href = '/login';
  };

  if (initialLoad) {
    return <LoadingState fullScreen message="Loading workspace..." />;
  }

  return (
    <div className="flex h-screen bg-surface-0 overflow-hidden">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-0'} transition-all duration-200 bg-surface-1 border-r border-edge flex flex-col overflow-hidden shrink-0`}>
        <div className="p-3">
          <button onClick={newChat} className="w-full py-2 px-3 border border-edge rounded-lg text-white text-sm font-medium hover:bg-surface-2 hover:border-edge-hover transition-all flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {conversations.length === 0 ? (
            <p className="text-center text-txt-faint text-xs py-4">No conversations yet</p>
          ) : conversations.map((conv) => (
            <div key={conv.id} onClick={() => setCurrentConv(conv.id)}
              className={`group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-all ${
                currentConv === conv.id ? 'bg-surface-3 text-white' : 'text-txt-secondary hover:text-white hover:bg-surface-2'
              }`}>
              <span className="text-sm truncate flex-1">{conv.title}</span>
              <button onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }} className="opacity-0 group-hover:opacity-100 text-txt-muted hover:text-red-400 transition-all">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>

        <div className="p-2 border-t border-edge space-y-0.5">
          {user && (
            <div className="px-3 py-2 mb-1 border-b border-edge">
              <p className="text-xs text-txt-muted">Signed in as</p>
              <p className="text-sm text-white font-medium truncate">{user.username}</p>
            </div>
          )}
          <a href="/dashboard" className="flex items-center gap-2.5 px-3 py-2 text-txt-secondary hover:text-white rounded-md hover:bg-surface-2 transition-all text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            Dashboard
          </a>
          <a href="/settings" className="flex items-center gap-2.5 px-3 py-2 text-txt-secondary hover:text-white rounded-md hover:bg-surface-2 transition-all text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            Settings
          </a>
          {user?.role === 'admin' && (
            <a href="/admin" className="flex items-center gap-2.5 px-3 py-2 text-txt-secondary hover:text-white rounded-md hover:bg-surface-2 transition-all text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              Admin
            </a>
          )}
          <button onClick={logout} className="flex items-center gap-2.5 px-3 py-2 text-txt-secondary hover:text-white rounded-md hover:bg-surface-2 transition-all text-sm w-full">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-12 border-b border-edge flex items-center px-4 gap-3 shrink-0 bg-surface-0">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-txt-muted hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>

          <div className="flex items-center gap-2">
            <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value)}
              className="bg-surface-1 border border-edge text-white text-xs rounded-md px-2.5 py-1.5 focus:outline-none focus:border-edge-hover cursor-pointer hover:border-edge-hover transition-colors">
              <option value="">Select Provider</option>
              {providers.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>

            <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-surface-1 border border-edge text-white text-xs rounded-md px-2.5 py-1.5 focus:outline-none focus:border-edge-hover cursor-pointer hover:border-edge-hover transition-colors max-w-[220px]">
              <option value="">Select Model</option>
              {models.map((m) => (<option key={m} value={m}>{m}</option>))}
            </select>
          </div>

          {messages.length > 0 && (
            <Button variant="ghost" size="xs" onClick={exportChat} className="ml-auto">Export</Button>
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 && !streaming ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-12 h-12 rounded-xl bg-surface-1 border border-edge flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-txt-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                </div>
                <p className="text-white text-base font-medium">Start a conversation</p>
                <p className="text-txt-muted text-sm mt-1">Type a message or upload an image</p>
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
                <div className="flex gap-1.5 py-2">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse-dot"></div>
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse-dot" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse-dot" style={{ animationDelay: '0.4s' }}></div>
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
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-edge">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2 bg-surface-1 border border-edge rounded-xl px-3 py-2 focus-within:border-edge-hover focus-within:ring-1 focus-within:ring-edge-hover/50 transition-all">
              <button onClick={() => fileInputRef.current?.click()} className="text-txt-muted hover:text-white transition-colors p-1.5 shrink-0 self-end" title="Upload image">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Message..."
                className="flex-1 bg-transparent text-sm text-white placeholder:text-txt-ghost focus:outline-none resize-none max-h-40 leading-relaxed py-1.5"
                rows={1}
              />
              <button onClick={sendMessage} disabled={streaming || (!input.trim() && images.length === 0)}
                className="bg-white text-black hover:bg-brand-dim disabled:bg-surface-3 disabled:text-txt-faint disabled:cursor-not-allowed transition-colors p-1.5 rounded-md shrink-0 self-end">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
            </div>
            <p className="text-[11px] text-txt-muted text-center mt-2">Press <kbd className="px-1.5 py-0.5 bg-surface-2 border border-edge rounded text-[10px]">Enter</kbd> to send · <kbd className="px-1.5 py-0.5 bg-surface-2 border border-edge rounded text-[10px]">Shift+Enter</kbd> for new line</p>
          </div>
        </div>
      </main>
    </div>
  );
}
