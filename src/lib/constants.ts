/**
 * Synthetic provider id used for the built-in Prometheus virtual provider.
 *
 * The user's Kiro Account Pool powers this provider directly - no row in
 * the Provider table. The chat route detects this id and dispatches via
 * streamKiroChat instead of streamChat.
 */
export const PROMETHEUS_PROVIDER_ID = '__prometheus__';
