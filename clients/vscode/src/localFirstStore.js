/**
 * The extension host's local-first application: ONE durable store per
 * `ExtensionContext`, its device id, and the chat persistence over it.
 *
 * The pieces live along their seams:
 *   - `durableLocalFirstStore.ts` — the journal-backed store (delta commit, tail catch-up, compaction)
 *   - `localFirstMigration.ts`    — the one-time import from the v2 journal / JSON cache, orphan cleanup
 *   - `localFirstLock.ts`         — the cross-window file lock, with dead-holder reclaim
 *   - `localFirstJournalIo.ts`    — the v3 journal file over `node:fs`
 *   - `localFirstSnapshotFile.ts` — the snapshot cache's classification
 *   - brain-embedded `createLocalBrainPersistence` — chat and message rows: the SAME
 *     full Brain adapter the web runs on, so every method the webview proxies
 *     (`LOCAL_PERSISTENCE_METHODS`) exists here. A write-only twin of it
 *     (`localChatPersistence.ts`, deleted) had no `listChats`, and the panel opened on
 *     `s[i.method] is not a function`.
 *
 * This module is the only one that touches `vscode`.
 */
import * as vscode from "vscode";
import { createLocalBrainPersistence, createLocalChatIdentity, createRunUsageLedger, } from "@seanhogg/builderforce-brain-embedded";
import { createDurableLocalFirstStore } from "./durableLocalFirstStore";
import { chatAccountDestination, chatBindingPort, serverChatSpend, serverChatSpendCache } from "./chatAccount";
import { gatewaySummaryCompletion } from "./chatSummarizer";
import { pruneRailReadMarkOnDelete } from "./chatRail/refreshRail";
import { mergeLocalTicketSummaries } from "./chatRail/localTicketSummary";
import { hostLog } from "./hostLog";
/** The durable store over this extension's global storage. */
export function createVsCodeLocalFirstStore(ctx, beforeWrite = Promise.resolve()) {
    return createDurableLocalFirstStore(ctx.globalStorageUri.fsPath, {
        beforeWrite,
        onSlowCommit: (ms, frameBytes) => hostLog(`[local-first] slow commit: ${ms} ms, ${frameBytes} byte frame`),
        onBackgroundError: (error) => hostLog(`[local-first] ${error instanceof Error ? error.message : String(error)}`),
    });
}
const applications = new WeakMap();
export function localBrainApplication(ctx) {
    const existing = applications.get(ctx);
    if (existing)
        return existing;
    const deviceKey = "builderforce.localDeviceId";
    const storedDeviceId = ctx.globalState.get(deviceKey);
    // G04: the id must be durable before any write stamps it. A crash between
    // minting and globalState.update used to mint a second device id on restart.
    const deviceId = storedDeviceId && storedDeviceId.length > 0 ? storedDeviceId : crypto.randomUUID();
    const devicePersisted = deviceId === storedDeviceId
        ? Promise.resolve()
        : Promise.resolve(ctx.globalState.update(deviceKey, deviceId)).then(() => undefined);
    // G03: one journal frame (a delta of the rows changed) per committed transaction. The
    // promise resolves only after that frame is fsynced. `local-first-v1.json` is a cache.
    const store = createVsCodeLocalFirstStore(ctx, devicePersisted);
    const identity = createLocalChatIdentity({ store, deviceId, port: chatBindingPort(ctx.secrets) });
    const application = {
        store,
        durableStore: store,
        deviceId,
        // Deleting a chat also drops its rail read mark (`pruneRailReadMarkOnDelete`). Every chat row's
        // ticket summary is rolled up from the same tickets its rail shows (`mergeLocalTicketSummaries`).
        persistence: mergeLocalTicketSummaries(pruneRailReadMarkOnDelete(createLocalBrainPersistence({
            store,
            deviceId,
            summarizeUnavailable: vscode.l10n.t("Summarizing a chat needs a BuilderForce account. This conversation is only on this machine."),
            // "Consolidate" / "Fork" summarize through the run's own gateway route.
            summarize: gatewaySummaryCompletion(ctx.secrets),
            summarizeFailed: vscode.l10n.t("The chat could not be summarized right now. Try again in a moment."),
            accountDestination: chatAccountDestination,
            serverSpend: serverChatSpend(ctx.secrets),
            serverSpendSync: serverChatSpendCache,
            bindChat: (chatId) => identity.bind(chatId),
        }), store), store),
        identity,
        usage: createRunUsageLedger({ store, deviceId }),
    };
    applications.set(ctx, application);
    return application;
}
//# sourceMappingURL=localFirstStore.js.map