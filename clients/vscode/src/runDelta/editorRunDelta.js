/**
 * The run delta, assembled for the editor's host-owned runs (`brainRunHostPorts.ts`): what a run start hands the change set's
 * baseline (pre-images, the stat hint, the workspace folders), the `onFinalized` hook that starts the delta once the run has
 * settled, the finalize gate an autonomous run's terminal status waits on (`hold`, `runHoldGate.ts`, PRD 41 §12.5), the card
 * relay the chat panels attach to, and the `run-delta/get` read.
 *
 * The editor adapters (`runDeltaHost.ts` — knowledge store, folder SQLite) are loaded LAZILY, on the first run start: the run
 * host must not pull the knowledge host's module graph in at construction.
 */
import { getRunSnapshot } from "@seanhogg/builderforce-brain-embedded";
import { hostLog } from "../hostLog";
import { recordLocalAuditGate } from "../localAuditGate";
import { RUN_DELTA_BUDGET_MS, startRunDelta } from "./finalizeRunDelta";
import { runDeltaFile } from "./openCode";
import { createRunDeltaProgress, lastReplySince } from "./runDeltaProgress";
import { readRunDeltas } from "./runDeltaRecords";
import { readRunDeltaHistory } from "./runDeltaHistory";
import { createRunHoldGate } from "./runHoldGate";
import { withHolds } from "./runHoldState";
import { readRunPredictions, withPredicted } from "./runDeltaPredictions";
/** From hand-off, the gate waits the delta's own budget plus this: the lazy host load and the record's store. */
export const HANDOFF_GRACE_MS = 5_000;
/** From the run's settle until its change set hands off: finalization's own ceiling (git status, fingerprints, records). */
export const FINALIZE_CEILING_MS = 120_000;
const log = (what, error) => hostLog(`[run delta] ${what}: ${error instanceof Error ? error.message : String(error)}`);
export function editorRunDelta(args) {
    let host;
    const loadHost = () => (host ??= import("./runDeltaHost"));
    // The `run-delta/card` relay: every attached panel hears a stored delta (it shows it when it holds that chat).
    const sinks = new Set();
    // Pending → computed (or failed) cards, one lifecycle per run (`runDeltaProgress.ts`).
    const progress = createRunDeltaProgress((card) => {
        const message = { type: "run-delta/card", ...card };
        for (const sink of sinks) {
            try {
                sink.post(message);
            }
            catch { /* a disposed panel; its detach follows */ }
        }
    });
    const post = progress.post;
    // A delta stored with its analyzers pending lost its L3 phase with the last session: settle it (`interrupted`), re-post.
    void import("./analyzers/l3Recovery").then((m) => m.settleInterruptedDeltas(args.store, { post, onError: (error) => log("settle interrupted deltas", error) }))
        .catch((error) => log("settle interrupted deltas", error));
    const gate = createRunHoldGate({
        budgetMs: RUN_DELTA_BUDGET_MS + HANDOFF_GRACE_MS,
        finalizeCeilingMs: FINALIZE_CEILING_MS,
        onTimeout: (runId, ms, which) => log(`run ${runId}`, new Error(`run_hold_gate: ${which === "delta" ? "no settled delta" : "no change-set hand-off"} within ${ms} ms; the run is held unmeasured`)),
    });
    /** The stored cards (and a run's progress card), each with its run's hold as its execution says it and its `ok` predictions. */
    const cardsOf = async (query) => withPredicted(await withHolds(args.store, progress.withProgress(query, await readRunDeltas(args.store, query))), await readRunPredictions(args.store, query));
    // Extension shutdown stops the end-of-run recorders (`dispose`).
    const shutdown = new AbortController();
    /** The end-of-run recorders (`atRunEnd.ts`), loaded lazily like the host adapters. */
    const runEnd = () => import("./atRunEnd");
    const endDeps = (h, runId) => ({
        store: args.store, deviceId: args.deviceId, log: (what, error) => log(`${what} ${runId}`, error),
        enabled: h.naturalnessEnabled, preimages: (root) => h.preimageReaderFor(runId, root), signal: shutdown.signal,
    });
    const repost = async (runId) => {
        for (const card of await cardsOf({ runId }))
            post(card);
    };
    /** Each autonomous run's terminal write still to land: what a release (and the owning start) waits on. */
    const journaling = new Map();
    const landed = (runId) => {
        const pending = journaling.get(runId);
        journaling.delete(runId);
        pending?.land();
    };
    /** Each run's delta still computing (until its progress card is final): a hold's re-post waits for it. */
    const measuring = new Map();
    return {
        hold: {
            expect(runId) {
                gate.expect(runId);
                if (journaling.has(runId))
                    return;
                let land;
                const done = new Promise((resolve) => { land = resolve; });
                journaling.set(runId, { done, land });
            },
            beforeTerminal: gate.beforeTerminal,
            // An audit's run carries its hold on its audit-run record too, written before the start resolves (so the audit flow
            // reads it). Not an audit: nothing is written.
            async verdict(runId) {
                const hold = await gate.verdict(runId);
                if (hold)
                    await recordLocalAuditGate(args.store, {}, { runId, hold }).catch((error) => log(`audit hold ${runId}`, error));
                return hold;
            },
            forget(runId) {
                gate.forget(runId);
                landed(runId);
            },
            journaled({ runId, hold }) {
                landed(runId);
                // The hold is on the execution now: the run's cards (computed, or the failed one of an unmeasured run) read back
                // held, with Release — after its own measurement posted its last progress card.
                if (hold)
                    void (measuring.get(runId) ?? Promise.resolve()).then(() => repost(runId)).catch((error) => log(`held cards ${runId}`, error));
            },
            async whenJournaled(runId, ms) {
                const pending = journaling.get(runId);
                if (!pending)
                    return true;
                let timer;
                const late = new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); });
                try {
                    return await Promise.race([pending.done.then(() => true), late]);
                }
                finally {
                    if (timer)
                        clearTimeout(timer);
                }
            },
        },
        async capture(runId) {
            // `release` is the change set's exit that never reaches `onFinalized`: no delta will come, so the gate decides now.
            try {
                const h = await loadHost();
                return {
                    preimages: h.preimageSinkFor(runId),
                    hint: h.statHashHint(),
                    folders: args.workspaceFolders(),
                    onPreimageError: (error) => log("pre-images", error),
                    release: () => {
                        gate.port(runId).settled();
                        void h.releaseRun(runId).catch((error) => log("pre-image release", error));
                    },
                };
            }
            catch (error) {
                log("baseline adapters", error);
                return { folders: args.workspaceFolders(), release: () => gate.port(runId).settled() };
            }
        },
        onFinalized({ writes, ...run }) {
            return (closed) => {
                const written = writes?.();
                const hold = run.mode === "autonomous" ? gate.port(closed.runId) : undefined;
                // The hand-off: the gate's clock starts now, not when the run settled (finalization can take a large repo a while).
                hold?.begin(closed.committed.length > 0);
                // The reply the run produced anchors its card; the pending card is posted now, before anything is computed.
                const at = lastReplySince(getRunSnapshot(run.chatId).appended, closed.baseline.capturedAt);
                const progressOver = progress.begin({ chatId: run.chatId, runId: closed.runId, ...(at !== undefined ? { at } : {}), repos: closed.committed.length });
                let measuredDone;
                measuring.set(closed.runId, new Promise((resolve) => { measuredDone = resolve; }));
                const measured = () => {
                    progressOver();
                    measuring.delete(closed.runId);
                    measuredDone();
                };
                const settled = [];
                void loadHost().then((h) => startRunDelta({
                    store: args.store,
                    deviceId: args.deviceId,
                    sources: h.editorDeltaSources(args.secrets, log, closed.runId),
                    release: h.releasePreimages,
                    post,
                    telemetry: h.deltaTelemetry(hostLog),
                    onError: (error) => log(`run ${closed.runId}`, error),
                    l3: h.deltaL3,
                    // PRD 41 C6.2/C8.4: the optional dynamic tier (opted in or mandated by the project's policy; off by default).
                    // PRD 41 D9: benchmarks by the sign-test SPRT; the Thompson sampler once the repository's scheduling history allows.
                    dynamic: h.deltaDynamicTier((error) => log(`dynamic tier ${closed.runId}`, error), { store: args.store, deviceId: args.deviceId }),
                    // The pending card names the dynamic tier while it runs ("running dynamic checks, up to N min").
                    onDynamic: (runId, minutes) => progress.dynamic(runId, minutes),
                    // PRD 41 §D1: the run's features are frozen at run end, from its stored delta (detached, never fails the run).
                    onStored: (stored) => {
                        settled.push(stored);
                        void runEnd().then((m) => m.onDeltaStored(endDeps(h, closed.runId), stored), (error) => log("run outcome load", error));
                    },
                }, { ...run, closed, ...(at !== undefined ? { at } : {}), ...(written ? { writes: written } : {}), ...(hold ? { hold } : {}) }).finally(() => {
                    measured();
                    // PRD 41 §D6: once the WHOLE delta settled (never inside its budget), naturalness; its cards then re-post with it.
                    if (settled.length === 0)
                        return;
                    void runEnd().then((m) => m.atRunEnd(endDeps(h, closed.runId), settled)).then((shown) => (shown ? repost(closed.runId) : undefined))
                        .catch((error) => log(`run end ${closed.runId}`, error));
                }), (error) => {
                    log("load", error);
                    if (closed.committed.length > 0)
                        hold?.unmeasured(); // fail-closed: its changes were never measured
                    hold?.settled();
                    measured();
                });
            };
        },
        attach(sink) {
            sinks.add(sink);
            return () => { sinks.delete(sink); };
        },
        runDeltas: cardsOf,
        openFile: (request) => runDeltaFile(args.store, request),
        history: (query) => readRunDeltaHistory(args.store, query),
        repost,
        predictionShown(prediction) {
            void loadHost().then((h) => h.predictionShown(prediction), (error) => log("prediction shown", error));
        },
        dispose() {
            shutdown.abort();
        },
    };
}
//# sourceMappingURL=editorRunDelta.js.map