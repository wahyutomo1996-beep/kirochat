/**
 * Kiro Account Pool Manager
 *
 * Manages multiple Kiro refresh tokens. Auto-rotates between active accounts,
 * marks exhausted accounts, refreshes tokens before expiry.
 */

import { prisma } from './prisma';
import { decrypt, encrypt } from './encryption';

const KIRO_AUTH_ENDPOINT = 'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken';
const KIRO_ACCOUNT_ENDPOINT = 'https://prod.us-east-1.auth.desktop.kiro.dev/account';

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
 * Pick the next available Kiro account for the user (round-robin among active).
 * Refreshes the access token if expired.
 * Marks account as exhausted on auth failure.
 */
export async function pickKiroAccount(userId: string): Promise<KiroTokenResult> {
  const accounts = await prisma.kiroAccount.findMany({
    where: { userId, status: 'active' },
    orderBy: [{ lastUsed: 'asc' }, { createdAt: 'asc' }],
  });

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
          data: { status: 'exhausted', exhaustedAt: new Date() },
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
