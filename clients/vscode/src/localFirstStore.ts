/**
 * The extension host's local-first application: ONE durable store per
 * `ExtensionContext`, its device id, and the chat persistence over it.
 *
 * The pieces live along their seams:
 *   - `durableLocalFirstStore.ts` — the journal-backed store (commit, reload, compaction)
 *   - `localFirstLock.ts`         — the cross-window file lock, with dead-holder reclaim
 *   - `localFirstJournalIo.ts`    — the journal file over `node:fs`
 *   - `localFirstSnapshotFile.ts` — the snapshot cache's classification
 *   - `localChatPersistence.ts`   — chat and message rows
 *
 * This module is the only one that touches `vscode`.
 */

import type * as vscode from "vscode";
import type { LocalFirstStore } from "@builderforce/local-first";
import { createDurableLocalFirstStore, type DurableLocalFirstStore } from "./durableLocalFirstStore";
import { createLocalChatPersistence, type LocalChatPersistence } from "./localChatPersistence";

/** The durable store over this extension's global storage. */
export function createVsCodeLocalFirstStore(
  ctx: Pick<vscode.ExtensionContext, "globalStorageUri">,
  beforeWrite: Promise<void> = Promise.resolve(),
): DurableLocalFirstStore {
  return createDurableLocalFirstStore(ctx.globalStorageUri.fsPath, { beforeWrite });
}

interface LocalApplication {
  store: LocalFirstStore;
  /** G03: the journal-backed store. The JSON snapshot is its cache, not its state. */
  durableStore: DurableLocalFirstStore;
  persistence: LocalChatPersistence;
}

const applications = new WeakMap<vscode.ExtensionContext, LocalApplication>();

export function localBrainApplication(ctx: vscode.ExtensionContext): LocalApplication {
  const existing = applications.get(ctx);
  if (existing) return existing;
  const deviceKey = "builderforce.localDeviceId";
  const storedDeviceId = ctx.globalState.get<string>(deviceKey);
  // G04: the id must be durable before any write stamps it. A crash between
  // minting and globalState.update used to mint a second device id on restart.
  const deviceId = storedDeviceId && storedDeviceId.length > 0 ? storedDeviceId : crypto.randomUUID();
  const devicePersisted = deviceId === storedDeviceId
    ? Promise.resolve()
    : Promise.resolve(ctx.globalState.update(deviceKey, deviceId)).then(() => undefined);
  // G03: one journal frame per committed transaction. The promise resolves
  // only after that frame is fsynced. `local-first-v1.json` is a cache.
  const store = createVsCodeLocalFirstStore(ctx, devicePersisted);
  const application = {
    store,
    durableStore: store,
    persistence: createLocalChatPersistence(store, deviceId),
  };
  applications.set(ctx, application);
  return application;
}
