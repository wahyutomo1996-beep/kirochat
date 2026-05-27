/**
 * Server status helpers for the Telegram bot.
 *
 * Two data sources:
 *   1. Docker Engine API via the mounted /var/run/docker.sock unix
 *      socket (read-only mount in docker-compose). Gives us host info,
 *      container list, container logs.
 *   2. Local /api/health endpoint via loopback fetch — same data the
 *      uptime monitor would see.
 *
 * Why use the Unix socket directly instead of pulling in dockerode?
 *   - Zero new deps (Next.js bundle stays small)
 *   - Edge runtime not needed; this only runs in the Telegram webhook
 *     handler which is Node runtime
 *   - Docker API is small + stable, the methods we need fit in <100 LOC
 *
 * Security: the socket is mounted read-only in docker-compose. Even if
 * code here calls a write endpoint, Docker would reject it.
 */

import http from 'node:http';
import os from 'node:os';

const SOCK = '/var/run/docker.sock';
const TIMEOUT_MS = 5000;

export interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Ports?: Array<{ PrivatePort: number; PublicPort?: number; Type: string; IP?: string }>;
}

export interface DockerInfo {
  Containers: number;
  ContainersRunning: number;
  ContainersStopped: number;
  ContainersPaused: number;
  Images: number;
  ServerVersion: string;
  KernelVersion: string;
  OperatingSystem: string;
  NCPU: number;
  MemTotal: number;
  Name: string;
}

/**
 * GET a Docker API path that returns JSON.
 */
function dockerGetJson<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: SOCK, path, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body) as T);
            } catch (e) {
              reject(new Error(`Bad JSON: ${(e as Error).message}`));
            }
          } else {
            reject(new Error(`Docker API ${res.statusCode}: ${body.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Docker API timeout')));
    req.end();
  });
}

/**
 * GET a Docker API path that returns raw bytes (used for logs, which
 * use a multiplexed binary stream when the container has no TTY).
 */
function dockerGetRaw(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: SOCK, path, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(Buffer.concat(chunks));
          } else {
            reject(new Error(`Docker API ${res.statusCode}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Docker API timeout')));
    req.end();
  });
}

export async function listContainers(): Promise<DockerContainer[]> {
  return dockerGetJson<DockerContainer[]>('/containers/json?all=true');
}

export async function getDockerInfo(): Promise<DockerInfo> {
  return dockerGetJson<DockerInfo>('/info');
}

/**
 * Parse Docker's multiplexed log frame format:
 *   [stream_type(1)] [padding(3)=0] [size(4)] [payload(size)]
 *   stream_type: 0=stdin, 1=stdout, 2=stderr
 *
 * If container ran with TTY (rare for compose), output is raw text.
 * We sniff the first byte: if it looks framed (type ≤ 2 + padding zero),
 * parse; otherwise return as utf-8 string.
 */
function parseLogs(buf: Buffer): string {
  if (buf.length === 0) return '';
  const looksFramed =
    buf.length >= 8 &&
    buf[0] <= 2 &&
    buf[1] === 0 &&
    buf[2] === 0 &&
    buf[3] === 0;
  if (!looksFramed) {
    return buf.toString('utf8');
  }
  const out: string[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    if (size === 0) {
      offset += 8;
      continue;
    }
    if (offset + 8 + size > buf.length) {
      // Truncated frame — emit remainder and stop
      out.push(buf.subarray(offset + 8).toString('utf8'));
      break;
    }
    out.push(buf.subarray(offset + 8, offset + 8 + size).toString('utf8'));
    offset += 8 + size;
  }
  return out.join('');
}

export async function getContainerLogs(name: string, tail = 30): Promise<string> {
  const path = `/containers/${encodeURIComponent(name)}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=0`;
  const buf = await dockerGetRaw(path);
  return parseLogs(buf);
}

export interface HealthInfo {
  status: string;
  uptimeSeconds: number;
  db?: { ok: boolean; latencyMs: number };
  version?: string;
}

/**
 * Hit our own /api/health via loopback. Works because we're in the
 * same network namespace as the Next.js process (PID 1 in container).
 */
export async function getLocalHealth(): Promise<HealthInfo | { error: string }> {
  try {
    const r = await fetch('http://localhost:3000/api/health', {
      // 3s timeout via AbortController
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return (await r.json()) as HealthInfo;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Format bytes as a short human-readable string. Used for memory and
 * log size displays. Telegram column width is narrow on mobile.
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Format uptime seconds as "5d 3h 22m" or "47m 12s". Skip zero
 * components from the left so output stays compact.
 */
export function formatUptime(seconds: number): string {
  const s = Math.floor(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

/**
 * Process-level info available without Docker socket. Used as a
 * fallback when the socket isn't reachable (e.g. local dev) so the
 * /status command still renders something.
 */
export function getProcessUptime(): number {
  return Math.floor(process.uptime());
}

export function getHostName(): string {
  return os.hostname();
}
