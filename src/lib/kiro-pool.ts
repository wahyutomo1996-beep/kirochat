/**
 * Kiro Account Pool Manager
 *
 * Manages multiple Kiro refresh tokens. Auto-rotates between active accounts,
 * marks exhausted accounts, refreshes tokens before expiry, and lazily
 * resurrects exhausted accounts after a cooldown (Kiro free tier resets daily).
 */

import { prisma } from './prisma';
import { decrypt, encrypt } from './encryption';

const KIRO_AUTH_ENDPOINT = 'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken';
const KIRO_ACCOUNT_ENDPOINT = 'https://prod.us-east-1.auth.desktop.kiro.dev/account';

/**
 * How long to wait after `exhaustedAt` before probing an exhausted account
 * for resurrection. Default 6h - long enough to avoid hammering a quota wall,
 * short enough that a daily reset is picked up automatically. Configurable
 * via KIRO_REVIVE_COOLDOWN_HOURS env.
 */
const REVIVE_COOLDOWN_MS =
  Math.max(1, parseInt(process.env.KIRO_REVIVE_COOLDOWN_HOURS || '6', 10)) * 60 * 60 * 1000;

/**
 * Cap on how many exhausted accounts to probe per pickKiroAccount call.
 * Each probe makes a network call to Kiro auth, so this bounds latency
 * impact when many accounts are sitting in cooldown.
 */
const MAX_REVIVE_PROBES_PER_CALL = 3;

export interface KiroTokenResult {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  email?: string;
}

/**
 * Refresh a Kiro access token using a refresh token.
 * Returns new access + refresh tokens (Kiro rotates refresh tokens).
 */
export async function refreshKiroToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const response = await fetch(KIRO_AUTH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Prometheus/1.0',
    },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Kiro token refresh failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken || refreshToken,
    expiresIn: data.expiresIn || 3600,
  };
}

/**
 * Fetch account email from Kiro auth API.
 */
export async function fetchKiroAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(KIRO_ACCOUNT_ENDPOINT, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Prometheus/1.0',
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.email || data.userEmail || null;
  } catch {
    return null;
  }
}

/**
 * Probe exhausted accounts whose cooldown has elapsed and resurrect any whose
 * refresh token still works. Bounded by MAX_REVIVE_PROBES_PER_CALL so a single
 * pick doesn't pay for refreshing the entire dead pool.
 *
 * Resurrected accounts get fresh tokens written and status flipped to 'active',
 * so the very next call to pickKiroAccount can use them.
 *
 * Auth failures (401/403/invalid_grant) leave the account exhausted but bump
 * `exhaustedAt` so we don't re-probe immediately.
 */
async function reviveCandidateAccounts(userId: string): Promise<number> {
  const cutoff = new Date(Date.now() - REVIVE_COOLDOWN_MS);
  const candidates = await prisma.kiroAccount.findMany({
    where: {
      userId,
      status: 'exhausted',
      OR: [{ exhaustedAt: null }, { exhaustedAt: { lt: cutoff } }],
    },
    orderBy: { exhaustedAt: 'asc' },
    take: MAX_REVIVE_PROBES_PER_CALL,
  });

  if (candidates.length === 0) return 0;

  let revived = 0;
  for (const account of candidates) {
    try {
      const refreshToken = decrypt(account.refreshToken);
      const refreshed = await refreshKiroToken(refreshToken);
      const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
      await prisma.kiroAccount.update({
        where: { id: account.id },
        data: {
          status: 'active',
          accessToken: encrypt(refreshed.accessToken),
          refreshToken: encrypt(refreshed.refreshToken),
          tokenExpiresAt: newExpiresAt,
          exhaustedAt: null,
          // Keep lastError as historical record - it'll be overwritten on the
          // next failure. UI can clear it manually via reactivate if desired.
        },
      });
      revived += 1;
    } catch (err) {
      const msg = (err as Error).message || '';
      const isAuthFail =
        msg.includes('401') || msg.includes('403') || msg.includes('invalid_grant');
      // Either way, push exhaustedAt forward so we wait another cooldown window
      // before re-probing this account. For non-auth errors (network blip, 5xx)
      // we still rate-limit - a flaky probe shouldn't burn capacity.
      await prisma.kiroAccount
        .update({
          where: { id: account.id },
          data: {
            exhaustedAt: new Date(),
            lastError: msg.slice(0, 500),
            lastErrorAt: new Date(),
            ...(isAuthFail ? { failedRequests: { increment: 1 } } : {}),
          },
        })
        .catch(() => {});
    }
  }
  return revived;
}

/**
 * Pick the next available Kiro account for the user (round-robin among active).
 * Refreshes the access token if expired.
 * Marks account as exhausted on auth failure.
 *
 * If no active accounts exist, attempts to revive any exhausted accounts
 * whose cooldown has elapsed before giving up.
 */
export async function pickKiroAccount(userId: string): Promise<KiroTokenResult> {
  let accounts = await prisma.kiroAccount.findMany({
    where: { userId, status: 'active' },
    orderBy: [{ lastUsed: 'asc' }, { createdAt: 'asc' }],
  });

  // No active accounts - try to revive exhausted ones (Kiro resets daily).
  if (accounts.length === 0) {
    const revived = await reviveCandidateAccounts(userId);
    if (revived > 0) {
      accounts = await prisma.kiroAccount.findMany({
        where: { userId, status: 'active' },
        orderBy: [{ lastUsed: 'asc' }, { createdAt: 'asc' }],
      });
    }
  } else {
    // Background revival: opportunistically probe stale exhausted accounts
    // even when active ones exist, so the pool depth grows naturally over
    // time. Fire-and-forget — we don't wait for it.
    void reviveCandidateAccounts(userId).catch(() => {});
  }

  if (accounts.length === 0) {
    throw new Error('No active Kiro accounts. Add at least one Kiro refresh token in Settings.');
  }

  // Try each active account in order until one succeeds
  let lastError: Error | null = null;
  for (const account of accounts) {
    try {
      const refreshToken = decrypt(account.refreshToken);
      const now = new Date();
      const expiresAt = account.tokenExpiresAt ? new Date(account.tokenExpiresAt) : null;

      // Use cached access token if still valid (>60s buffer)
      if (account.accessToken && expiresAt && expiresAt.getTime() > now.getTime() + 60_000) {
        const accessToken = decrypt(account.accessToken);
        await prisma.kiroAccount.update({
          where: { id: account.id },
          data: { lastUsed: now, usageCount: { increment: 1 } },
        });
        return {
          accountId: account.id,
          accessToken,
          refreshToken,
          email: account.email || undefined,
        };
      }

      // Refresh the token
      const refreshed = await refreshKiroToken(refreshToken);
      const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);

      await prisma.kiroAccount.update({
        where: { id: account.id },
        data: {
          accessToken: encrypt(refreshed.accessToken),
          refreshToken: encrypt(refreshed.refreshToken),
          tokenExpiresAt: newExpiresAt,
          lastUsed: now,
          usageCount: { increment: 1 },
        },
      });

      return {
        accountId: account.id,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        email: account.email || undefined,
      };
    } catch (err) {
      lastError = err as Error;
      // Mark this account as exhausted if refresh failed with auth error
      const msg = (err as Error).message || '';
      if (msg.includes('401') || msg.includes('403') || msg.includes('invalid_grant')) {
        await prisma.kiroAccount.update({
          where: { id: account.id },
          data: {
            status: 'exhausted',
            exhaustedAt: new Date(),
            lastError: msg.slice(0, 500),
            lastErrorAt: new Date(),
          },
        });
      }
      // Try next account
      continue;
    }
  }

  throw lastError || new Error('All Kiro accounts failed');
}

/**
 * Mark an account as exhausted (called after a 429/quota error).
 * Stores the error message so the UI can show why it was marked.
 */
export async function markAccountExhausted(accountId: string, reason?: string): Promise<void> {
  await prisma.kiroAccount.update({
    where: { id: accountId },
    data: {
      status: 'exhausted',
      exhaustedAt: new Date(),
      lastError: reason?.slice(0, 500),
      lastErrorAt: new Date(),
      failedRequests: { increment: 1 },
    },
  });
}

/**
 * Record successful token usage on a specific account. Increments aggregate
 * counters used by the Settings UI to surface per-account credit consumption.
 */
export async function recordKiroUsage(
  accountId: string,
  promptTokens: number,
  completionTokens: number,
): Promise<void> {
  const total = promptTokens + completionTokens;
  await prisma.kiroAccount
    .update({
      where: { id: accountId },
      data: {
        totalRequests: { increment: 1 },
        totalPromptTokens: { increment: promptTokens },
        totalCompletionTokens: { increment: completionTokens },
        totalTokens: { increment: total },
      },
    })
    .catch(() => {
      /* account might have been deleted between request and finish - ignore */
    });
}

/**
 * Record a failed request on a specific account without exhausting it.
 * Used for transient errors that don't justify pulling the account from the pool.
 */
export async function recordKiroFailure(accountId: string, reason?: string): Promise<void> {
  await prisma.kiroAccount
    .update({
      where: { id: accountId },
      data: {
        failedRequests: { increment: 1 },
        lastError: reason?.slice(0, 500),
        lastErrorAt: new Date(),
      },
    })
    .catch(() => {});
}

/**
 * Validate a Kiro refresh token by attempting to refresh it.
 * Returns email if successful.
 */
export async function validateKiroToken(refreshToken: string): Promise<{
  valid: boolean;
  accessToken?: string;
  newRefreshToken?: string;
  email?: string;
  error?: string;
}> {
  try {
    const refreshed = await refreshKiroToken(refreshToken);
    const email = await fetchKiroAccountEmail(refreshed.accessToken);
    return {
      valid: true,
      accessToken: refreshed.accessToken,
      newRefreshToken: refreshed.refreshToken,
      email: email || undefined,
    };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

/**
 * Manually attempt to revive a single exhausted account, ignoring cooldown.
 * Used by the Settings reactivate button. Returns true if revived.
 */
export async function tryReviveAccount(accountId: string): Promise<{
  revived: boolean;
  error?: string;
}> {
  const account = await prisma.kiroAccount.findUnique({ where: { id: accountId } });
  if (!account) return { revived: false, error: 'Account not found' };

  try {
    const refreshToken = decrypt(account.refreshToken);
    const refreshed = await refreshKiroToken(refreshToken);
    const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
    await prisma.kiroAccount.update({
      where: { id: accountId },
      data: {
        status: 'active',
        accessToken: encrypt(refreshed.accessToken),
        refreshToken: encrypt(refreshed.refreshToken),
        tokenExpiresAt: newExpiresAt,
        exhaustedAt: null,
        lastError: null,
        lastErrorAt: null,
      },
    });
    return { revived: true };
  } catch (err) {
    const msg = (err as Error).message || '';
    await prisma.kiroAccount
      .update({
        where: { id: accountId },
        data: {
          lastError: msg.slice(0, 500),
          lastErrorAt: new Date(),
        },
      })
      .catch(() => {});
    return { revived: false, error: msg };
  }
}
