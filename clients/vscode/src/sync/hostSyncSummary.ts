/**
 * The host's ports for `readSyncSummary`: the durable store's committed view, the live inference
 * mode, the account destination chats bind into, and the last pull the store recorded for it.
 * Reads only: no platform call, so the summary answers the same with the network denied.
 */

import { chatAccountDestination } from "../chatAccount";
import type { DurableLocalFirstStore } from "../durableLocalFirstStore";
import { platformInferenceMode } from "../platformPolicy";
import type { SyncSummaryPorts } from "./syncSummary";

export function hostSyncSummaryPorts(store: Pick<DurableLocalFirstStore, "view" | "read">): SyncSummaryPorts {
  return {
    facts: () => store.view(),
    mode: platformInferenceMode,
    destination: chatAccountDestination,
    lastPullAt: (destination) => store.read((tx) => tx.lastPullAt(destination)),
  };
}
