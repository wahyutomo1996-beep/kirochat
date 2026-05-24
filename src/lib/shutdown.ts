/**
 * Graceful shutdown handler.
 *
 * Why we need it:
 *   When Docker, Kubernetes, or PM2 restarts the app, they send SIGTERM and
 *   wait ~10s before sending SIGKILL. Without a handler, Node.js exits
 *   immediately on SIGTERM, killing in-flight requests:
 *     - Streaming chat responses get cut mid-token
 *     - Database writes mid-transaction can leave inconsistent state
 *     - Open Kiro refresh fetches abandon their tokens
 *
 * What we do:
 *   1. Register SIGTERM/SIGINT handlers that flip a `shuttingDown` flag.
 *   2. Stop accepting new HTTP requests (returns 503 instantly).
 *   3. Wait for in-flight requests to finish (or timeout after 25s, leaving
 *      a 5s margin before SIGKILL).
 *   4. Disconnect Prisma (flush any pending writes, close pool).
 *   5. Exit cleanly.
 *
 * How it integrates:
 *   This module is imported once at process start (via `instrumentation.ts`)
 *   and the middleware checks `isShuttingDown()` before processing.
 *
 * Note: Next.js 14 standalone server.js does not give us direct access to
 * the HTTP server, so we can't gracefully drain at the socket level. The
 * best we can do is reject new requests in middleware and let in-flight
 * ones finish naturally before exit.
 */

let shuttingDown = false;
let shutdownStartedAt = 0;
let inFlightRequests = 0;

const SHUTDOWN_TIMEOUT_MS = 25_000;

/**
 * Returns true if the process is in the middle of shutting down. Middleware
 * checks this and returns 503 to new requests.
 */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Track the start of an in-flight request. Pair with `endRequest()` in
 * a finally block so we can know when all requests have drained.
 */
export function beginRequest(): void {
  inFlightRequests++;
}

export function endRequest(): void {
  inFlightRequests = Math.max(0, inFlightRequests - 1);
}

/**
 * Initialize the shutdown handler. Idempotent — multiple calls are safe
 * (we keep a flag so handlers register only once).
 */
let initialized = false;
export function initShutdownHandler(): void {
  if (initialized) return;
  initialized = true;

  // Skip in dev — Next.js dev server has its own restart machinery and
  // we don't want our handlers fighting with HMR.
  if (process.env.NODE_ENV !== 'production') return;

  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const sig of signals) {
    process.on(sig, () => handleShutdown(sig));
  }
}

async function handleShutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return; // Already shutting down, ignore second signal
  shuttingDown = true;
  shutdownStartedAt = Date.now();

  // eslint-disable-next-line no-console
  console.log(`[shutdown] Received ${signal}, draining in-flight requests...`);

  // Wait for in-flight requests to drain, polling every 100ms
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  while (inFlightRequests > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }

  if (inFlightRequests > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[shutdown] ${inFlightRequests} requests still in flight after ${SHUTDOWN_TIMEOUT_MS}ms — proceeding anyway`,
    );
  }

  // Close Prisma connection pool. Lazy-import so this module stays light.
  try {
    const { prisma } = await import('./prisma');
    await prisma.$disconnect();
    // eslint-disable-next-line no-console
    console.log('[shutdown] Prisma disconnected');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[shutdown] Prisma disconnect failed:', err);
  }

  const elapsed = Date.now() - shutdownStartedAt;
  // eslint-disable-next-line no-console
  console.log(`[shutdown] Clean exit after ${elapsed}ms`);
  process.exit(0);
}
