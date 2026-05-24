/**
 * Token detector endpoint.
 *
 * SECURITY: Admin-only. This scans the SERVER's filesystem for AWS SSO /
 * Kiro tokens, which is dangerous in multi-tenant deployments because the
 * server's home directory may contain tokens belonging to the operator
 * (e.g. an admin who used Kiro CLI on the host). Letting a normal user
 * trigger this would let them claim those tokens as their own.
 *
 * For local single-user dev, this is convenient (auto-detect the user's
 * own Kiro install). For 100+ user deployments, the recommended path is
 * paste-only: users provide their own refresh tokens via the UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { scanFilesystem, parseTokenData, validateRefreshToken } from '@/lib/token-detector';
import { apiError } from '@/lib/http';

/** Disable filesystem scanning entirely via env (recommended in prod). */
const SCAN_DISABLED = process.env.DISABLE_FILESYSTEM_TOKEN_SCAN === '1';

/**
 * GET /api/tokens/detect
 * Scan server filesystem for Kiro/AWS SSO tokens. ADMIN ONLY.
 */
export async function GET() {
  try {
    await requireAdmin();

    if (SCAN_DISABLED) {
      return NextResponse.json({
        tokens: [],
        count: 0,
        disabled: true,
        message:
          'Filesystem token scanning is disabled (DISABLE_FILESYSTEM_TOKEN_SCAN=1). ' +
          'Use paste-only token input instead.',
      });
    }

    const tokens = await scanFilesystem();

    return NextResponse.json({
      tokens: tokens.map(t => ({
        source: t.source,
        type: t.type,
        preview: t.preview,
        expiresAt: t.expiresAt,
        startUrl: t.startUrl,
        region: t.region,
      })),
      count: tokens.length,
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}

/**
 * POST /api/tokens/detect
 * Body: { source: string }     -> get full token from previously scanned source (admin only)
 *   or  { fileContent: string } -> parse uploaded JSON content (any approved user)
 *   or  { refreshToken: string } -> validate manually entered token (any approved user)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Filesystem path -> admin only. Paste/upload paths -> regular auth check
    // happens implicitly via middleware (route is matched in middleware.ts).
    if (body.source) {
      await requireAdmin();
      if (SCAN_DISABLED) {
        return NextResponse.json(
          { error: 'Filesystem scanning disabled. Paste the token directly instead.' },
          { status: 403 },
        );
      }
    }

    let token: { refreshToken: string; type: string; source: string; expiresAt?: string; startUrl?: string } | null = null;

    if (body.fileContent) {
      try {
        const data = JSON.parse(body.fileContent);
        const parsed = parseTokenData(data, 'uploaded');
        if (!parsed) {
          return NextResponse.json({ error: 'Tidak bisa parse token dari file. Format JSON tidak dikenali.' }, { status: 400 });
        }
        token = {
          refreshToken: parsed.refreshToken,
          type: parsed.type,
          source: 'uploaded file',
          expiresAt: parsed.expiresAt,
          startUrl: parsed.startUrl,
        };
      } catch {
        return NextResponse.json({ error: 'File bukan JSON valid' }, { status: 400 });
      }
    } else if (body.source) {
      const tokens = await scanFilesystem();
      const found = tokens.find(t => t.source === body.source);
      if (!found) {
        return NextResponse.json({ error: 'Token source tidak ditemukan. Mungkin file sudah berubah.' }, { status: 404 });
      }
      token = {
        refreshToken: found.refreshToken,
        type: found.type,
        source: found.source,
        expiresAt: found.expiresAt,
        startUrl: found.startUrl,
      };
    } else if (body.refreshToken) {
      token = {
        refreshToken: body.refreshToken,
        type: 'manual',
        source: 'manual entry',
      };
    } else {
      return NextResponse.json({ error: 'Provide source, fileContent, or refreshToken' }, { status: 400 });
    }

    const validation = await validateRefreshToken(token.refreshToken);

    return NextResponse.json({
      token: {
        refreshToken: token.refreshToken,
        type: token.type,
        source: token.source,
        expiresAt: token.expiresAt,
        startUrl: token.startUrl,
      },
      validation: {
        valid: validation.ok,
        endpoint: validation.endpoint,
        expiresIn: validation.expiresIn,
        error: validation.error,
      },
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}
