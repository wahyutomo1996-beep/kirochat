/**
 * Next.js instrumentation hook — runs once at server startup.
 *
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * We use this to register process-level handlers (graceful shutdown) that
 * need to attach to the Node.js process before any request comes in.
 */

export async function register() {
  // Only register on the Node.js runtime (not Edge runtime, which has no
  // process signals).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initShutdownHandler } = await import('./lib/shutdown');
    initShutdownHandler();
  }
}
