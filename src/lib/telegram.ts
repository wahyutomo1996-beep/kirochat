/**
 * Telegram Bot API helpers.
 *
 * Thin wrapper around https://core.telegram.org/bots/api — only the
 * endpoints we actually use:
 *   - getMe         verify token validity + capture bot username
 *   - setWebhook    register our webhook URL with Telegram
 *   - deleteWebhook un-register before deleting the bot config
 *   - sendMessage   reply to a user's message
 *   - sendChatAction "typing..." indicator while we generate a reply
 *
 * All calls are non-streaming, JSON in/out, fire-and-forget for sends
 * (we don't care about message_id of our own replies).
 *
 * Errors return { ok: false, description } so the caller can surface
 * Telegram's diagnostic. We never throw; failures bubble up as falsy ok.
 */

const TG_BASE = 'https://api.telegram.org';

/** Standard Telegram API response envelope */
interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  language_code?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  username?: string;
  first_name?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  /**
   * Photo array if user sent an image. Each entry is a different
   * resolution; index `length-1` is highest. Use `file_id` to download
   * via getFile then resolve to a URL like
   * https://api.telegram.org/file/bot<TOKEN>/<file_path>.
   */
  photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  caption?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
}

export interface TgFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

/**
 * Call a Telegram Bot API method. Returns the parsed result or null on
 * failure (with the error logged for ops to see in `lastError`).
 */
async function call<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  if (!token) return { ok: false, error: 'No bot token configured' };

  try {
    const r = await fetch(`${TG_BASE}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await r.json()) as TgResponse<T>;
    if (data.ok && data.result !== undefined) {
      return { ok: true, result: data.result };
    }
    return { ok: false, error: data.description || `HTTP ${r.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Verify a token is valid + return the bot's identity.
 * Used in Settings UI "Test connection" button + during save validation.
 */
export async function getMe(token: string) {
  return call<TgUser>(token, 'getMe');
}

/**
 * Register our HTTPS webhook URL with Telegram. Telegram will POST every
 * incoming message there. The URL must include a random secret segment
 * so randos can't forge requests.
 *
 * Telegram's POST request also includes a header
 *   X-Telegram-Bot-Api-Secret-Token: <secret>
 * when you set `secret_token` here. We use BOTH for defense-in-depth
 * (URL secret stops trivial scans, header secret stops mid-stream
 * tampering).
 */
export async function setWebhook(
  token: string,
  url: string,
  secretToken: string,
) {
  return call<true>(token, 'setWebhook', {
    url,
    secret_token: secretToken,
    drop_pending_updates: true,
    allowed_updates: ['message', 'edited_message'],
    max_connections: 10,
  });
}

/** Un-register webhook (called when user deletes the bot config). */
export async function deleteWebhook(token: string) {
  return call<true>(token, 'deleteWebhook', { drop_pending_updates: true });
}

/**
 * Send a text message back to a Telegram chat.
 *
 * `chatId` is the chat where the user wrote — usually a private DM
 * (positive integer) when scoped to one user. We use Markdown V1 for
 * simplicity; reasonable safety since we control the rendered text.
 */
export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  opts?: { replyToMessageId?: number; parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML' },
) {
  // Telegram has a 4096-char limit per message. Split on paragraph
  // boundaries so multi-paragraph replies don't get cut mid-sentence.
  const MAX = 4000;
  if (text.length <= MAX) {
    return call<TgMessage>(token, 'sendMessage', {
      chat_id: chatId,
      text,
      reply_to_message_id: opts?.replyToMessageId,
      parse_mode: opts?.parseMode,
      disable_web_page_preview: true,
    });
  }

  // Split into chunks; send sequentially so order is preserved.
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const end = Math.min(cursor + MAX, text.length);
    // Try to break at a paragraph or newline
    let cut = text.lastIndexOf('\n\n', end);
    if (cut <= cursor) cut = text.lastIndexOf('\n', end);
    if (cut <= cursor) cut = end;
    chunks.push(text.slice(cursor, cut));
    cursor = cut;
  }
  let last: { ok: true; result: TgMessage } | { ok: false; error: string } | null = null;
  for (let i = 0; i < chunks.length; i++) {
    last = await call<TgMessage>(token, 'sendMessage', {
      chat_id: chatId,
      text: chunks[i],
      reply_to_message_id: i === 0 ? opts?.replyToMessageId : undefined,
      parse_mode: opts?.parseMode,
      disable_web_page_preview: true,
    });
    if (!last.ok) break;
  }
  return last ?? { ok: false as const, error: 'No chunks sent' };
}

/**
 * Show "typing..." in the chat while we generate the reply. Lasts ~5s
 * server-side; we re-call when generation takes longer.
 */
export async function sendTyping(token: string, chatId: number) {
  return call<true>(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
}

/**
 * Resolve a Telegram file_id to an absolute https URL we can fetch.
 * Used to bridge images: user sends photo to bot -> we resolve to URL ->
 * download, base64-encode -> feed to vision provider via existing
 * vision-bridge pipeline.
 */
export async function getFileUrl(token: string, fileId: string): Promise<string | null> {
  const r = await call<TgFile>(token, 'getFile', { file_id: fileId });
  if (!r.ok || !r.result.file_path) return null;
  return `${TG_BASE}/file/bot${token}/${r.result.file_path}`;
}

/**
 * Parse comma- or whitespace-separated allowed user IDs into a Set
 * of numeric strings. Defensive against extra whitespace, empty entries,
 * and non-numeric junk.
 */
export function parseAllowedUserIds(raw: string): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const part of raw.split(/[\s,]+/)) {
    const trimmed = part.trim();
    if (/^\d+$/.test(trimmed)) {
      out.add(trimmed);
    }
  }
  return out;
}

/**
 * Generate a cryptographically random webhook secret. 32 bytes hex
 * = 64 chars; sufficient entropy that a random URL scan won't hit it.
 */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  // crypto.getRandomValues works in both Node 18+ and edge runtime
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
