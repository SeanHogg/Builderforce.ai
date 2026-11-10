/**
 * SYNC ON ENABLE for the editor's chats (PRD 36 §36.4; local-first G15/G24, chat slice).
 *
 * Runs whenever the `synchronize` capability is granted: it follows the inference mode —
 * ON in the connected modes (Hybrid, Specific), OFF and locked in Local only — and an
 * explicit `builderforce.platform.synchronize: false` in user settings turns it off. Work
 * runs locally first; what it wrote reaches the account at the end, when connected
 * (chat #70776: sync was off by omission, 389 events queued and never pushed). Once sync
 * is granted and the editor knows which workspace it acts as, ONE coordinator per device store
 * (`installSyncCoordinator`) is handed this device's chat history
 * (`bindChatHistoryForSync`): every offline chat, its messages and its local-model usage
 * go to the account once, as imports the server deduplicates on retry, and the sync
 * receipts write the chats' server mappings — the same binding the panel reads.
 *
 * The same pass carries the WORK the agent filed locally (`bindWorkForSync`): projects and
 * tickets are written to the device store with no API call, and go up here as one batched
 * push (the coordinator sends up to 100 events / 512 KB per request), tickets after the
 * chat they were created in, which they link to on the server.
 *
 * Triggered by a change of the policy, a write to the store that left events pending,
 * and a slow heartbeat that retries what the server held back (`dependency_pending`).
 * Single-flight: a trigger during a pass runs one more pass after it, never two at once.
 */

import * as vscode from "vscode";
import {
  SCAN_STOP,
  SYNC_PASS_BIND_TYPES,
  bindWorkForSync,
  countLivePending,
  createDeviceStoreCoordinatorLease,
  createHttpSyncTransport,
  type LocalFirstChange,
  type SyncRateLimit,
} from "@builderforce/local-first";
import { bindChatHistoryForSync } from "@seanhogg/builderforce-brain-embedded";
import { getTenantJwt } from "./bfApi";
import { chatAccountDestination, invalidateServerChatSpend } from "./chatAccount";
import { getBaseUrl } from "./gateway";
import { hostLog } from "./hostLog";
import { installSyncCoordinator } from "./installSyncCoordinator";
import { drainSync } from "./syncDrain";
import { localBrainApplication } from "./localFirstStore";
import { platformFetch, platformPolicy } from "./platformPolicy";

/** How often a granted editor retries what is still pending (and pulls receipts). */
const HEARTBEAT_MS = 5 * 60_000;
/** Writes arrive in bursts (a turn's messages, its usage rows); one pass covers them. */
const DEBOUNCE_MS = 2_000;

export function installChatSync(ctx: vscode.ExtensionContext): vscode.Disposable {
  const local = localBrainApplication(ctx);
  const policy = platformPolicy();
  const lease = createDeviceStoreCoordinatorLease({ deviceStore: `vscode:${local.deviceId}`, now: Date.now, ttlMs: 30_000 });
  // The tenant's request budget as the server last reported it: the drain paces itself on it.
  let rateLimit: SyncRateLimit | undefined;
  const transport = createHttpSyncTransport({
    baseUrl: getBaseUrl(),
    fetch: (url, init) => platformFetch(url, init, "synchronize"),
    headers: async (): Promise<Record<string, string>> => {
      const jwt = await getTenantJwt(ctx.secrets);
      return jwt ? { authorization: `Bearer ${jwt}` } : {};
    },
    onRateLimit: (limit) => { rateLimit = limit; },
  });
  /** Set when a pass stopped with work left: when the next one may start (ms epoch). */
  let resumeAt: number | undefined;
  /** The last pass stopped short of an empty queue: the next one continues its drain. */
  let continuing = false;

  let running = false;
  let again = false;
  let disposed = false;

  const pass = async (): Promise<void> => {
    resumeAt = undefined;
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
    // Chats first: a ticket's import waits on the import of the chat it was created in.
    await bindChatHistoryForSync(local.store, local.deviceId, destination);
    await bindWorkForSync(local.store, local.deviceId, destination);
    // One synchronize pushes one batch; drain while there is work and budget (`syncDrain.ts`).
    const drained = await drainSync({
      round: ({ pull }) => installed.coordinator.synchronize(destination, { pull }),
      pending: () => local.store.read((tx) => countLivePending(tx, destination)),
      rateLimit: () => rateLimit,
    }, { pullFirst: !continuing });
    // Work left (the pass's time ran out, or the shared request bucket is at its reserve):
    // the next pass follows as soon as allowed, not at the 5-minute heartbeat — and continues
    // this drain rather than starting one (no second pull).
    continuing = drained.more;
    resumeAt = drained.more ? Date.now() + (drained.resumeAfterMs ?? 0) : undefined;
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
    if (resumeAt !== undefined) schedule();
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Debounced — and never before a rate-limited pass said the next may start. */
  const schedule = (): void => {
    if (disposed || policy.allows("synchronize") !== true) return;
    if (timer) clearTimeout(timer);
    const delay = Math.max(DEBOUNCE_MS, (resumeAt ?? 0) - Date.now());
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, delay);
  };

  // A write that left nothing to send (a pull's cursor, a receipt) triggers nothing — so
  // the sync's own writes cannot loop it. Unbound rows count only for the sync slice (chats
  // and the work beside them): the pass moves those, while other offline records wait for
  // their own binding. The commit's
  // change hint says whether the pending queue moved at all (an unknown change counts as
  // yes); only then is the queue scanned — without cloning an event.
  //
  // During a pass, bound events are the running drain's to send, so only UNBOUND sync-slice
  // work counts: a ticket filed mid-pass is past this pass's bind, so it asks for one more
  // pass (`again`) instead of waiting for the heartbeat.
  const onStoreChange = (change?: LocalFirstChange): void => {
    if (policy.allows("synchronize") !== true) return;
    if (change && !change.events) return;
    const destination = chatAccountDestination();
    if (!destination) return;
    const duringPass = running;
    void local.store.read(async (tx) => {
      let pending = false;
      if (!duringPass) {
        await tx.scanPending((event) => { if (!event.deadLetter) { pending = true; return SCAN_STOP; } }, destination);
      }
      if (!pending) {
        await tx.scanPending((event) => { if (!event.deadLetter && SYNC_PASS_BIND_TYPES.has(event.entityType)) { pending = true; return SCAN_STOP; } }, { kind: "unbound" });
      }
      return pending;
    })
      .then((pending) => {
        if (!pending) return;
        if (running) again = true;
        else schedule();
      })
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
