/**
 * SYNC ON ENABLE for the editor's chats (PRD 36 §36.4; local-first G15/G24, chat slice).
 *
 * Nothing here runs until the person turns sync on (`builderforce.platform.synchronize`
 * — the `synchronize` capability). Signing in alone binds a chat (title + project, see
 * `chatAccount.ts`); it never uploads a transcript. Once sync is granted and the editor
 * knows which workspace it acts as, ONE coordinator per device store
 * (`installSyncCoordinator`) is handed this device's chat history
 * (`bindChatHistoryForSync`): every offline chat, its messages and its local-model usage
 * go to the account once, as imports the server deduplicates on retry, and the sync
 * receipts write the chats' server mappings — the same binding the panel reads.
 *
 * Triggered by a change of the policy, a write to the store that left events pending,
 * and a slow heartbeat that retries what the server held back (`dependency_pending`).
 * Single-flight: a trigger during a pass runs one more pass after it, never two at once.
 */

import * as vscode from "vscode";
import {
  createDeviceStoreCoordinatorLease,
  createHttpSyncTransport,
} from "@builderforce/local-first";
import { bindChatHistoryForSync } from "@seanhogg/builderforce-brain-embedded";
import { getTenantJwt } from "./bfApi";
import { chatAccountDestination, invalidateServerChatSpend } from "./chatAccount";
import { getBaseUrl } from "./gateway";
import { installSyncCoordinator } from "./installSyncCoordinator";
import { localBrainApplication } from "./localFirstStore";
import { platformFetch, platformPolicy } from "./platformPolicy";

/** How often a granted editor retries what is still pending (and pulls receipts). */
const HEARTBEAT_MS = 5 * 60_000;
/** Writes arrive in bursts (a turn's messages, its usage rows); one pass covers them. */
const DEBOUNCE_MS = 2_000;
/** The entity types this slice of sync owns. */
const CHAT_SLICE: ReadonlySet<string> = new Set(["chat", "message", "usage"]);

function hostLog(line: string): void {
  void import("./errorReporter")
    .then(({ logLine }) => logLine(line))
    .catch((error: unknown) => console.warn(line, error));
}

export function installChatSync(ctx: vscode.ExtensionContext): vscode.Disposable {
  const local = localBrainApplication(ctx);
  const policy = platformPolicy();
  const lease = createDeviceStoreCoordinatorLease({ deviceStore: `vscode:${local.deviceId}`, now: Date.now, ttlMs: 30_000 });
  const transport = createHttpSyncTransport({
    baseUrl: getBaseUrl(),
    fetch: (url, init) => platformFetch(url, init, "synchronize"),
    headers: async (): Promise<Record<string, string>> => {
      const jwt = await getTenantJwt(ctx.secrets);
      return jwt ? { authorization: `Bearer ${jwt}` } : {};
    },
  });

  let running = false;
  let again = false;
  let disposed = false;

  const pass = async (): Promise<void> => {
    const destination = chatAccountDestination();
    if (!destination) return;
    const installed = installSyncCoordinator({
      synchronizeGranted: policy.allows("synchronize"),
      deviceId: local.deviceId,
      store: local.store,
      transport,
      policy,
      lease,
    });
    if (!installed.installed || !installed.started) return;
    await bindChatHistoryForSync(local.store, local.deviceId, destination);
    await installed.coordinator.synchronize(destination);
    // A receipt moved usage onto the platform: re-read its figure rather than serve the
    // cached one, which the device's own estimate no longer covers for those rows.
    invalidateServerChatSpend();
  };

  const run = async (): Promise<void> => {
    if (disposed) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await pass();
      } while (again && !disposed);
    } catch (error) {
      hostLog(`[chat sync] pass failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    if (disposed || policy.allows("synchronize") !== true) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, DEBOUNCE_MS);
  };

  // A write that left nothing to send (a pull's cursor, a receipt) triggers nothing — so
  // the sync's own writes cannot loop it. Unbound rows count only for the chat slice: the
  // pass moves those, while other offline records wait for their own binding.
  const onStoreChange = (): void => {
    if (running || policy.allows("synchronize") !== true) return;
    const destination = chatAccountDestination();
    if (!destination) return;
    void local.store.read(async (tx) =>
      (await tx.pending(destination)).length > 0
      || (await tx.pending({ kind: "unbound" })).some((event) => CHAT_SLICE.has(event.entityType)))
      .then((pending) => { if (pending) schedule(); })
      .catch(() => undefined);
  };

  const offStore = local.store.subscribe(onStoreChange);
  const offPolicy = policy.subscribe(() => schedule());
  const heartbeat = setInterval(schedule, HEARTBEAT_MS);
  schedule();

  return {
    dispose() {
      disposed = true;
      offStore();
      offPolicy();
      clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
    },
  };
}
