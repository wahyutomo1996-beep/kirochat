/**
 * /api/telegram/webhook/[secret] — receives messages from Telegram.
 *
 * Telegram POSTs every incoming message here as a TgUpdate. We:
 *   1. Verify URL secret matches a configured bot
 *   2. Verify X-Telegram-Bot-Api-Secret-Token header (defense in depth)
 *   3. Verify sender's Telegram user ID is in the bot's whitelist
 *   4. Generate a chat reply via existing Kiro pool
 *   5. Send reply back to the same chat
 *
 * Always returns 200 OK to Telegram (even on errors) so they don't
 * retry-storm. Errors are logged + surfaced via lastError on the bot
 * config (visible in Settings).
 *
 * Streaming is NOT used here — Telegram doesn't support partial messages.
 * We collect the full Kiro response, then send it (split into chunks if
 * over 4000 chars).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { generateKiroChat } from '@/lib/kiro-chat';
import { findModel } from '@/lib/models';
import { recordKiroUsage } from '@/lib/kiro-pool';
import { resolveCombo } from '@/lib/combo-dispatch';
import { formatModelDisplay } from '@/lib/format-model';
import {
  sendMessage,
  sendTyping,
  parseAllowedUserIds,
  type TgUpdate,
} from '@/lib/telegram';

interface WorkspaceSelection {
  mode: 'combo' | 'model';
  value: string;
}

const DEFAULT_MODEL = 'kiro/claude-sonnet-4.6';

/**
 * System prompt the bot uses for every Telegram conversation. Gives it
 * a stable identity ("Prometheus") so users get consistent answers when
 * they ask "siapa lo?" or "what's your name". Kept short to not eat
 * Kiro context budget.
 *
 * Tone notes:
 *   - Indonesian-friendly default ("lo/gue") matches the rest of the app
 *   - No-pretense about underlying model — if user explicitly asks
 *     "model apa yang lo pake" the assistant can answer truthfully via
 *     the {{model}} placeholder we substitute below.
 *   - Keep concise so Telegram replies stay readable on mobile.
 */
const TELEGRAM_SYSTEM_PROMPT = (modelLabel: string) => [
  'Lo adalah Prometheus — AI assistant yang dijalanin lewat Telegram bot.',
  'Lo dibikin dengan hati oleh Wahyu Tomo.',
  'Lo dibikin buat bantu user dengan pertanyaan, brainstorming, debugging code, analisis trading, ataupun chat sehari-hari.',
  'Jawab dengan ringkas dan jelas — ini chat Telegram, bukan dokumentasi panjang.',
  'Pake bahasa yang sesuai sama user (Indonesia kalo dia pake Indo, English kalo English).',
  '',
  `Kalo ditanya nama, jawab "Prometheus". Kalo ditanya siapa yang bikin lo, jawab "Wahyu Tomo".`,
  `Kalo ditanya model AI yang dipake, jawab "${modelLabel}".`,
  'Jangan ngaku-ngaku jadi ChatGPT, Claude, atau brand lain.',
].join('\n');

/**
 * Always 200 to Telegram — they retry on non-200 which causes message
 * duplication. We surface real errors to the user via lastError in DB
 * + best-effort sendMessage.
 */
function ack() {
  return NextResponse.json({ ok: true });
}

/**
 * Parse stored defaultSelection JSON safely. Falls back to a raw model
 * dispatch on any parse error.
 */
function parseSelection(raw: string): WorkspaceSelection {
  if (!raw) return { mode: 'model', value: DEFAULT_MODEL };
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed && typeof parsed === 'object' &&
      (parsed.mode === 'combo' || parsed.mode === 'model') &&
      typeof parsed.value === 'string' && parsed.value
    ) {
      return parsed as WorkspaceSelection;
    }
  } catch { /* ignore */ }
  return { mode: 'model', value: DEFAULT_MODEL };
}

/**
 * Resolve the actual model id to dispatch.
 *   - mode 'model'  -> use value as-is
 *   - mode 'combo'  -> first step's model (Telegram doesnt support
 *                       fallback retries — too slow + confusing UX)
 */
async function resolveModel(
  userId: string,
  selection: WorkspaceSelection,
): Promise<string> {
  if (selection.mode === 'model') {
    return selection.value;
  }
  // combo
  const combo = await resolveCombo(userId, selection.value);
  if (combo && combo.steps.length > 0) {
    return combo.steps[0].model;
  }
  return DEFAULT_MODEL;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { secret: string } },
) {
  // 1. Find the bot by webhook secret
  const bot = await prisma.telegramBot.findFirst({
    where: { webhookSecret: params.secret },
  });
  if (!bot) {
    // 404 here is intentional — random scanners shouldn't get a 200.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // 2. Verify Telegram's secret header matches what we set during
  //    setWebhook. Stops mid-stream tampering by anyone who somehow
  //    sees the URL.
  const headerSecret = request.headers.get('x-telegram-bot-api-secret-token');
  if (headerSecret !== params.secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return ack(); // malformed body, swallow
  }

  const message = update.message ?? update.edited_message;
  if (!message || !message.from) {
    return ack(); // not a user message (channel post, edit, etc.)
  }

  // 3. Whitelist check — sender must be on the allowed list.
  const allowed = parseAllowedUserIds(bot.allowedUserIds);
  const fromId = String(message.from.id);
  if (!allowed.has(fromId)) {
    // Don't reply to randos — that just confirms the bot exists.
    return ack();
  }

  let plainToken: string;
  try {
    plainToken = decrypt(bot.token);
  } catch {
    await markError(bot.id, 'Cannot decrypt bot token. Re-save in Settings.');
    return ack();
  }

  const text = (message.text ?? message.caption ?? '').trim();
  if (!text) {
    // Photos are not supported yet. Tell the user politely.
    if (message.photo) {
      await sendMessage(plainToken, message.chat.id,
        'Image input is not supported via Telegram yet. Send a text message instead.',
        { replyToMessageId: message.message_id });
    }
    return ack();
  }

  // Slash-command shortcut: /start, /help — friendly intros so users
  // know what they're talking to.
  if (text === '/start' || text === '/help') {
    const selectionForHelp = parseSelection(bot.defaultSelection);
    const modelForHelp = await resolveModel(bot.userId, selectionForHelp);
    const modelLabel = formatModelDisplay(modelForHelp);
    await sendMessage(
      plainToken,
      message.chat.id,
      `Halo, gw Prometheus — AI assistant yang lo akses lewat Telegram.\n\n` +
      `Kirim pesan apa aja: pertanyaan, brainstorming, code, analisa trading, atau chat biasa.\n\n` +
      `Default model: ${modelLabel}\n` +
      `Image belum support disini, pake web buat vision: https://152-42-216-29.sslip.io/chat`,
      { replyToMessageId: message.message_id },
    );
    return ack();
  }

  // 4. Generate reply. Show typing indicator while we work.
  await sendTyping(plainToken, message.chat.id);

  const selection = parseSelection(bot.defaultSelection);
  const model = await resolveModel(bot.userId, selection);

  // Validate the model exists in our catalog. If not, fall back.
  const found = findModel(model);
  const finalModel = found ? model : DEFAULT_MODEL;
  const modelLabel = formatModelDisplay(finalModel);

  const startTime = Date.now();
  try {
    const result = await generateKiroChat(
      bot.userId,
      finalModel,
      [
        // System prompt establishes the bot's identity as "Prometheus".
        // Kiro folds this into history (treated as a prior user turn) so
        // the assistant carries the persona into the actual reply.
        { role: 'system', content: TELEGRAM_SYSTEM_PROMPT(modelLabel) },
        { role: 'user', content: text },
      ],
    );

    const reply = result.content?.trim() || '(empty reply from model)';
    await sendMessage(plainToken, message.chat.id, reply, {
      replyToMessageId: message.message_id,
    });

    // Record usage (best-effort — don't fail the request if logging
    // fails). We deliberately use a simplified accounting here:
    // promptTokens/completionTokens estimated by length / 4.
    const promptTokens = Math.ceil(text.length / 4);
    const completionTokens = Math.ceil(reply.length / 4);
    await prisma.usage.create({
      data: {
        userId: bot.userId,
        providerId: null,
        providerName: 'telegram',
        kiroAccountId: result.accountId,
        model: finalModel,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        latencyMs: Date.now() - startTime,
        cost: 0,
        success: true,
      },
    }).catch(() => {});
    if (result.accountId) {
      await recordKiroUsage(result.accountId, promptTokens, completionTokens).catch(() => {});
    }

    // Clear lastError if the bot was previously erroring.
    if (bot.lastError) {
      await prisma.telegramBot.update({
        where: { id: bot.id },
        data: { lastError: null, lastErrorAt: null, webhookActive: true },
      }).catch(() => {});
    }
  } catch (err) {
    const errMsg = (err as Error).message ?? 'Unknown error';
    await markError(bot.id, errMsg);
    // Tell the Telegram user something went wrong — silent failure
    // is worse than apologizing.
    await sendMessage(
      plainToken,
      message.chat.id,
      `Sorry, ada error: ${errMsg.slice(0, 200)}`,
      { replyToMessageId: message.message_id },
    ).catch(() => {});
  }

  return ack();
}

async function markError(botId: string, msg: string) {
  await prisma.telegramBot
    .update({
      where: { id: botId },
      data: { lastError: msg.slice(0, 500), lastErrorAt: new Date() },
    })
    .catch(() => {});
}
