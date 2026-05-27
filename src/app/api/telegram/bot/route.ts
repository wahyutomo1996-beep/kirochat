/**
 * /api/telegram/bot — manage the user's Telegram bot configuration.
 *
 * Endpoints:
 *   GET    -> current config (token masked, never returned plaintext)
 *   POST   -> create or update; validates token via getMe, captures bot
 *             username, encrypts token, registers webhook with Telegram
 *   DELETE -> remove config + un-register webhook
 *
 * Token security:
 *   - Plain token only ever lives in the request body (HTTPS-encrypted)
 *     and the encrypt() call. Stored encrypted in DB.
 *   - GET response only shows last 4 chars: `••••AbCd`.
 *   - On every save we generate a fresh webhookSecret so old leaked
 *     URLs become inert immediately.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/encryption';
import {
  getMe,
  setWebhook,
  deleteWebhook,
  parseAllowedUserIds,
  generateWebhookSecret,
} from '@/lib/telegram';
import { apiError } from '@/lib/http';

/** Mask a token for safe display: keep last 4 chars only. */
function maskToken(token: string): string {
  return `\u2022\u2022\u2022\u2022${token.slice(-4)}`;
}

/** Build the absolute webhook URL Telegram will POST to. */
function webhookUrl(req: NextRequest, secret: string): string {
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  return `${proto}://${host}/api/telegram/webhook/${secret}`;
}

export async function GET() {
  try {
    const session = await requireAuth();
    const bot = await prisma.telegramBot.findUnique({
      where: { userId: session.userId },
    });
    if (!bot) {
      return NextResponse.json({ bot: null });
    }
    let tokenPreview = '';
    try {
      tokenPreview = maskToken(decrypt(bot.token));
    } catch {
      tokenPreview = '\u2022\u2022\u2022\u2022????';
    }
    return NextResponse.json({
      bot: {
        id: bot.id,
        tokenPreview,
        botUsername: bot.botUsername,
        allowedUserIds: bot.allowedUserIds,
        defaultSelection: bot.defaultSelection,
        webhookActive: bot.webhookActive,
        lastError: bot.lastError,
        lastErrorAt: bot.lastErrorAt,
        createdAt: bot.createdAt,
        updatedAt: bot.updatedAt,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}

interface BotPayload {
  /** Plain bot token from BotFather. Required on create; optional on
   *  update — pass null/undefined to keep the existing token. */
  token?: string | null;
  /** Comma- or space-separated Telegram user IDs that may use the bot. */
  allowedUserIds?: string;
  /** JSON-stringified WorkspaceSelection or empty for default fallback. */
  defaultSelection?: string;
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth();
    const body = (await request.json()) as BotPayload;

    const existing = await prisma.telegramBot.findUnique({
      where: { userId: session.userId },
    });

    // Resolve the plain token: new from request, or decrypt the existing one.
    let plainToken: string;
    if (body.token && typeof body.token === 'string' && body.token.trim()) {
      plainToken = body.token.trim();
    } else if (existing) {
      try {
        plainToken = decrypt(existing.token);
      } catch {
        return NextResponse.json(
          { error: 'Stored token is corrupt. Please paste it again.' },
          { status: 400 },
        );
      }
    } else {
      return NextResponse.json(
        { error: 'token is required to create the bot' },
        { status: 400 },
      );
    }

    // Validate format BEFORE calling Telegram so we don't waste an
    // outbound HTTP request on obvious typos. Real tokens are
    // "<bot_id>:<35-char alpha-num>".
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(plainToken)) {
      return NextResponse.json(
        { error: 'Invalid token format. Should look like 1234567890:ABCdef...' },
        { status: 400 },
      );
    }

    // Verify token works + capture bot username
    const me = await getMe(plainToken);
    if (!me.ok) {
      return NextResponse.json(
        { error: `Telegram rejected token: ${me.error}` },
        { status: 400 },
      );
    }

    // Sanitize allowedUserIds — store the cleaned canonical form so
    // future reads + writes match.
    const allowedSet = parseAllowedUserIds(body.allowedUserIds ?? '');
    const allowedClean = Array.from(allowedSet).join(',');

    // Validate defaultSelection JSON if provided
    let defaultSelection = '';
    if (body.defaultSelection && typeof body.defaultSelection === 'string') {
      try {
        const parsed = JSON.parse(body.defaultSelection);
        if (
          parsed && typeof parsed === 'object' &&
          (parsed.mode === 'combo' || parsed.mode === 'model') &&
          typeof parsed.value === 'string'
        ) {
          defaultSelection = JSON.stringify(parsed);
        }
      } catch {
        /* ignore — keep empty so dispatcher uses general workspace fallback */
      }
    }

    // Generate fresh webhook secret on every save so old URLs die.
    const webhookSecret = generateWebhookSecret();
    const url = webhookUrl(request, webhookSecret);

    const hookResult = await setWebhook(plainToken, url, webhookSecret);
    const webhookActive = hookResult.ok;
    const errMsg = hookResult.ok ? null : hookResult.error;

    const data = {
      userId: session.userId,
      token: encrypt(plainToken),
      botUsername: me.result.username || null,
      allowedUserIds: allowedClean,
      defaultSelection,
      webhookSecret,
      webhookActive,
      lastError: errMsg,
      lastErrorAt: errMsg ? new Date() : null,
    };

    const saved = existing
      ? await prisma.telegramBot.update({ where: { userId: session.userId }, data })
      : await prisma.telegramBot.create({ data });

    return NextResponse.json({
      bot: {
        id: saved.id,
        tokenPreview: maskToken(plainToken),
        botUsername: saved.botUsername,
        allowedUserIds: saved.allowedUserIds,
        defaultSelection: saved.defaultSelection,
        webhookActive: saved.webhookActive,
        webhookUrl: webhookActive ? url : null,
        lastError: saved.lastError,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE() {
  try {
    const session = await requireAuth();
    const bot = await prisma.telegramBot.findUnique({
      where: { userId: session.userId },
    });
    if (!bot) {
      return NextResponse.json({ deleted: false });
    }
    // Best-effort un-register webhook with Telegram (don't fail the
    // delete if Telegram is unreachable — local cleanup is more
    // important than perfect remote state).
    try {
      const plain = decrypt(bot.token);
      await deleteWebhook(plain);
    } catch {
      /* ignore */
    }
    await prisma.telegramBot.delete({ where: { userId: session.userId } });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return apiError(err);
  }
}
