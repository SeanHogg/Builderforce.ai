/**
 * A best-effort step's rejection, recorded with its reason and replaced by `fallback` — the
 * review still runs without the symbol index, the knowledge index or the platform's graph, and
 * a watcher that fails to close is reported rather than swallowed.
 */

import { logDebug } from "../../logger.js";

export function loggedFallback<T>(step: string, fallback: T): (error: unknown) => T {
  return (error) => {
    logDebug(`[knowledge] ${step} failed: ${String(error)}`);
    return fallback;
  };
}
