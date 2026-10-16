/**
 * Synapse's native engine (`bfi serve`) announces where it listens — this reads that
 * announcement. Parse only: READING the file is the host's job (Node `fs` in the editor;
 * a browser extension has no disk and relies on the probe instead).
 *
 * `bfi serve` binds Ollama's port 11434 and walks upward when it is taken, so a fixed
 * default would be wrong exactly when both are installed. After binding it writes
 * `~/.builderforce/bfi.json` = `{ port, pid, version, token }` (user-only perms; path
 * overridable with `BFI_DISCOVERY`) and withdraws it on exit — see
 * `builderforce-inference/crates/bfi-server/src/discovery.rs`. The Synapse desktop app
 * additionally mirrors the endpoint into `desktop.json` (`models.endpoint`), which hosts
 * read first; this file is what makes a bare `bfi serve` (no desktop app) discoverable.
 */

import type { LocalEndpoint } from './runtimes.js';

/** Path of the announcement under the user's home directory. */
export const BFI_DISCOVERY_RELATIVE_PATH = '.builderforce/bfi.json';
/** Env var that overrides the announcement's full path (same name `bfi` reads). */
export const BFI_DISCOVERY_ENV = 'BFI_DISCOVERY';

/**
 * The endpoint a parsed `bfi.json` names, or null when it is not one. Loopback only —
 * the file carries no host, and `bfi serve` binds `127.0.0.1` unless told otherwise. An
 * empty `token` means the server was started without `--api-key`.
 */
export function parseBfiDiscovery(raw: unknown): LocalEndpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const { port, token } = raw as { port?: unknown; token?: unknown };
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65_535) return null;
  const bearer = typeof token === 'string' ? token.trim() : '';
  return { baseUrl: `http://127.0.0.1:${port}`, ...(bearer ? { token: bearer } : {}) };
}
