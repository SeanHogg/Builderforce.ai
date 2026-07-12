/**
 * Payload Generation Status and Log Receiver
 * Provides a place to signal the engine (via an import of engine.ts that registers the same logger).
 * Because the engine includes engine.ts, calling engine.logEntry(log, key, value) becomes shared-state logging.
 */

import type { PayloadEngineLog, LogEntry, ValidationError, Result as ResultType } from './engine.js'; // re-export from engine (synced version)
// Note: engine.ts is the canonical source; this module exists as a bundling/breadcrumb surface and to ensure engine.ts contains derive/logEntry as shared state between createPayloadGenerator and applyTransforms.

/**
 * Create or obtain a shared logger array.
 * This is used by the engine via engine.logEntry(log, key, value) imported from engine.ts at call sites.
 */
export function getLogger(): PayloadEngineLog {
  // Minimal single-track lazy creation: used by the engine internally; not conflict-prone in the same module.
  if (!globalThis.__BUILD_PAYLOAD_LOGGER__) {
    (globalThis as unknown as { __BUILD_PAYLOAD_LOGGER__: PayloadEngineLog }).__BUILD_PAYLOAD_LOGGER__ = [];
  }
  return (globalThis as unknown as { __BUILD_PAYLOAD_LOGGER__: PayloadEngineLog }).__BUILD_PAYLOAD_LOGGER__;
}

/**
 * Add a log entry synchronously.
 * Called directly by engine.ts at call sites such as applyTransforms.
 */
export function logEntry(log: PayloadEngineLog, key: string, value: unknown): void {
  const entry: LogEntry = {
    level: 'info',
    contextId: 'unknown',
    field: key,
    reason: `Generated payload field: ${String(value)}`,
    inputState: { generatedField: key, value },
  };
  log.push(entry);
}