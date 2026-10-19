/**
 * Host wiring for the G27 packaged network-denial acceptance scenario
 * (ticket #5861, epic #5747).
 *
 * This is not a composition root. `extension.ts` does not import it, and it
 * does not import `extension.ts`, `localFirstStore`, or `installSyncCoordinator`.
 * Those modules are not on origin/main. The packaged host this scenario can
 * actually drive is `bootVsixHost` plus the fetch gate in `./platformPolicy`.
 *
 * The network boundary itself is not installed here. `./platformPolicy` captures
 * `globalThis.fetch` when that module is first evaluated, so the scenario
 * replaces fetch in a `vi.hoisted` block and only then imports this file.
 * `attemptPlatformSyncPush` is the platform call. A denied policy throws inside
 * `platformFetch` before that captured fetch runs, which is what "the network
 * was not opened" means.
 */

import * as os from "node:os";
import nodeFs from "node:fs";
import * as nodePath from "node:path";
import type * as vscode from "vscode";
import { platformFetch } from "./platformPolicy";

/** Message the boundary throws while the scenario is offline. */
export const DENIED_NETWORK_ERROR = "platform_network_denied";

/** Push endpoint. A configured platform origin, so the host guard classifies it. */
export const PLATFORM_SYNC_PUSH_URL = "https://api.builderforce.ai/api/sync/v1/push";

/** Non-platform probe. The guard must let this through so a dead boundary cannot fake a denial. */
export const NON_PLATFORM_PROBE_URL = "https://example.com/health";

/**
 * The fake socket. It records every attempt and refuses while offline, so a
 * test that reaches it during the denied phase fails loudly instead of
 * silently passing.
 */
export interface NetworkBoundary {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly attempts: readonly string[];
  isOnline(): boolean;
  setOnline(online: boolean): void;
  reset(): void;
}

/** The VSIX global storage directory, created fresh per run. */
export function createGlobalStorageDirectory(): string {
  return nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "bf-g27-global-storage-"));
}

export function removeGlobalStorageDirectory(directory: string): void {
  nodeFs.rmSync(directory, { recursive: true, force: true });
}

/** A host context with only the subscription list `bindPlatformPolicy` writes. */
export function createHostContext(): { context: vscode.ExtensionContext; dispose(): void } {
  const subscriptions: Array<{ dispose(): void }> = [];
  return {
    context: { subscriptions } as unknown as vscode.ExtensionContext,
    dispose() {
      while (subscriptions.length > 0) subscriptions.pop()?.dispose();
    },
  };
}

/**
 * The platform push a packaged host would make. Returns only after the policy
 * guard. A denied policy throws before `platformFetch` calls the captured
 * fetch, so the boundary's attempts stay empty of this URL.
 */
export function attemptPlatformSyncPush(): Promise<Response> {
  return platformFetch(
    PLATFORM_SYNC_PUSH_URL,
    { method: "POST", body: JSON.stringify({ events: [] }) },
    "synchronize",
  );
}
