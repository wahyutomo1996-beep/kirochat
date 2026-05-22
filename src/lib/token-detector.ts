import fs from 'fs';
import path from 'path';
import os from 'os';

export interface DetectedToken {
  source: string;          // path file
  type: 'kiro' | 'aws_sso' | 'unknown';
  refreshToken: string;
  accessToken?: string;
  expiresAt?: string;
  startUrl?: string;
  region?: string;
  clientId?: string;
  preview: string;         // masked token preview
}

/**
 * Scan filesystem untuk Kiro/AWS SSO tokens.
 * Aman: hanya read file, ga modify apapun.
 */
export async function scanFilesystem(): Promise<DetectedToken[]> {
  const found: DetectedToken[] = [];
  const home = os.homedir();
  const platform = process.platform;

  // Standard search paths
  const searchPaths: string[] = [
    // AWS SSO cache (Kiro pake AWS Builder ID via SSO)
    path.join(home, '.aws', 'sso', 'cache'),

    // Kiro app data
    path.join(home, '.config', 'Kiro'),
    path.join(home, '.kiro'),

    // Linux/Mac app data
    path.join(home, '.local', 'share', 'Kiro'),
  ];

  // Windows specific
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    searchPaths.push(
      path.join(appData, 'Kiro'),
      path.join(localAppData, 'Kiro'),
      path.join(appData, 'kiro'),
    );
  }

  // Mac specific
  if (platform === 'darwin') {
    searchPaths.push(
      path.join(home, 'Library', 'Application Support', 'Kiro'),
      path.join(home, 'Library', 'Caches', 'Kiro'),
    );
  }

  for (const dir of searchPaths) {
    try {
      if (!fs.existsSync(dir)) continue;
      const stat = fs.statSync(dir);
      if (!stat.isDirectory()) continue;

      const files = await scanDirectory(dir);
      found.push(...files);
    } catch {
      // permission denied, skip
    }
  }

  // Deduplicate by refresh token
  const seen = new Set<string>();
  return found.filter(t => {
    if (seen.has(t.refreshToken)) return false;
    seen.add(t.refreshToken);
    return true;
  });
}

async function scanDirectory(dir: string, depth = 0): Promise<DetectedToken[]> {
  if (depth > 3) return []; // prevent infinite recursion
  const found: DetectedToken[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recurse only into likely token directories
        if (/cache|sso|auth|token|credentials/i.test(entry.name) || depth === 0) {
          found.push(...await scanDirectory(fullPath, depth + 1));
        }
      } else if (entry.isFile()) {
        // Only check JSON files
        if (entry.name.endsWith('.json') || entry.name === 'token' || entry.name === 'credentials') {
          const stat = fs.statSync(fullPath);
          // Skip files larger than 100KB
          if (stat.size > 100 * 1024) continue;

          const parsed = parseTokenFile(fullPath);
          if (parsed) found.push(parsed);
        }
      }
    }
  } catch {
    // skip
  }

  return found;
}

export function parseTokenFile(filePath: string): DetectedToken | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    return parseTokenData(data, filePath);
  } catch {
    return null;
  }
}

export function parseTokenData(data: Record<string, unknown>, source: string = 'uploaded'): DetectedToken | null {
  // AWS SSO cache format
  // { startUrl, region, accessToken, refreshToken, expiresAt, clientId, ... }
  if (typeof data.refreshToken === 'string' && (data.startUrl || data.accessToken)) {
    const startUrl = data.startUrl as string | undefined;
    return {
      source,
      type: startUrl?.includes('kiro') || startUrl?.includes('birdseye') || startUrl?.includes('codewhisperer') ? 'kiro' : 'aws_sso',
      refreshToken: data.refreshToken,
      accessToken: data.accessToken as string | undefined,
      expiresAt: data.expiresAt as string | undefined,
      startUrl,
      region: data.region as string | undefined,
      clientId: data.clientId as string | undefined,
      preview: maskToken(data.refreshToken),
    };
  }

  // Kiro custom format (guess - might have different keys)
  // Common variations
  const refreshKey = ['refresh_token', 'refreshToken', 'token'].find(k => typeof data[k] === 'string');
  if (refreshKey) {
    return {
      source,
      type: 'unknown',
      refreshToken: data[refreshKey] as string,
      accessToken: (data.access_token || data.accessToken) as string | undefined,
      expiresAt: (data.expires_at || data.expiresAt) as string | undefined,
      preview: maskToken(data[refreshKey] as string),
    };
  }

  // Nested format - search recursively
  for (const value of Object.values(data)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = parseTokenData(value as Record<string, unknown>, source);
      if (nested) return nested;
    }
  }

  return null;
}

export function maskToken(token: string): string {
  if (!token || token.length < 12) return '***';
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

/**
 * Validate token by trying to refresh it.
 * Returns access token if valid, throws if not.
 */
export async function validateRefreshToken(refreshToken: string, clientId: string = 'kiro-ide'): Promise<{
  ok: boolean;
  accessToken?: string;
  expiresIn?: number;
  error?: string;
  endpoint?: string;
}> {
  const endpoints = [
    'https://prod.us-east-1.birdseye.amazon.dev/oauth/token',
    'https://oidc.us-east-1.amazonaws.com/token',
    'https://authenticate.kiro.dev/oauth/token',
  ];

  let lastError = '';

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          ok: true,
          accessToken: data.access_token,
          expiresIn: data.expires_in,
          endpoint,
        };
      }

      const errText = await response.text();
      lastError = `${endpoint}: ${response.status} - ${errText.slice(0, 200)}`;
    } catch (err) {
      lastError = `${endpoint}: ${err instanceof Error ? err.message : 'unknown'}`;
    }
  }

  return { ok: false, error: lastError };
}
