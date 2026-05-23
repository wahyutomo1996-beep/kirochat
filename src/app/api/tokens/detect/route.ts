import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { scanFilesystem, parseTokenData, validateRefreshToken } from '@/lib/token-detector';
import { apiError } from '@/lib/http';

/**
 * GET /api/tokens/detect
 * Scan server filesystem for Kiro/AWS SSO tokens
 */
export async function GET() {
  try {
    await requireAuth();

    const tokens = await scanFilesystem();

    return NextResponse.json({
      tokens: tokens.map(t => ({
        source: t.source,
        type: t.type,
        preview: t.preview,
        expiresAt: t.expiresAt,
        startUrl: t.startUrl,
        region: t.region,
        // refreshToken NOT returned in list - only on explicit request
      })),
      count: tokens.length,
    });
  } catch (error: unknown) {
    return apiError(error);
  }
}

/**
 * POST /api/tokens/detect
 * Body: { source: string }     -> get full token from previously scanned source
 *   or  { fileContent: string } -> parse uploaded JSON content
 *   or  { refreshToken: string } -> validate manually entered token
 *
 * Returns: { refreshToken, valid, accessToken, expiresIn }
 */
export async function POST(request: NextRequest) {
  try {
    await requireAuth();
    const body = await request.json();

    let token: { refreshToken: string; type: string; source: string; expiresAt?: string; startUrl?: string } | null = null;

    if (body.fileContent) {
      // Parse uploaded file
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
      // Re-scan and find by source
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

    // Validate token
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
