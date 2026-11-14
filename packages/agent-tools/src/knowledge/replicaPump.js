/**
 * knowledge/replicaPump.ts — syncs a linked root's dirty set to its project as ONE pack (PRD 41 A11).
 *
 * The review never waits for it and never sees its failures. One cycle:
 *   1. read the dirty set and the ack (`replicaQueue.ts`);
 *   2. with an ack, the DELTA path: the pack holds the current bodies of the dirty keys (and tombstones for
 *      keys with no row) and asserts `baseGeneration = ack.generation`;
 *      without one — a first sync, a lost set, a server that moved — the RECONCILE path: compare manifest
 *      trees (`replicaReconcile.ts`) and send exactly what differs; a full pack only when the server holds nothing;
 *   3. build the pack from the LOCAL store (`replicaPack.ts`), split it into ordered parts over 8 MB, send;
 *   4. on `{generation, digest}` the sent keys leave the set and the ack is stored.
 * It never sends per file: one pack per cycle, and the host starts a cycle when a review ends and at most once
 * a minute otherwise.
 *
 *   429 / 5xx / unreachable   the same request is retried after `Retry-After` (else an exponential backoff
 *                             capped at 60 s); progress is kept per part. It stops on `signal`, or, when
 *                             `maxTransientStreak` is set, after that many in a row (`paused: 'unreachable'`).
 *   401 / 403                 the work is KEPT and the pump pauses (`paused: 'auth'`): an expired token must
 *                             never lose the set. The next start resumes.
 *   409 body_conflict         another pack merged the same bodies at once: rebuild and resend now, at most 3 times;
 *   409                       `generation_mismatch` / `digest_mismatch`: reconcile; `prior_missing`: resend
 *                             without diffs; `extracted_missing`: resend with those bodies (and ask the next review to re-check hashes this store has no body for); at most 4 in a row.
 *   413 pack_too_large        the pack is cut in half (by files) and the rest stays dirty.
 *   422 / any other error     recorded in `failed`; the set is kept and the pump stops.
 *   side rows (notes, agent facts)  a 4xx is final: the rows leave the set and stay in `failed`; a 5xx or network
 *                             error keeps them dirty and ends this cycle (the next one retries).
 *
 * Before EVERY request the pump checks the set still belongs to its project (`projectId`) and waits out a
 * running review of the root (`idle`). `pumpReplica` never throws.
 */
import { MAX_PART_BYTES, splitParts } from '@seanhogg/builderforce-memory/knowledge/pack';
import { buildPack } from './replicaPack.js';
import { generationCheckDue, readServerGeneration } from './replicaGenerationCheck.js';
export { GENERATION_CHECK_INTERVAL_MS } from './replicaGenerationCheck.js';
import { planReconcile } from './replicaReconcile.js';
export const emptyReplicaState = () => ({ dirty: 0, sending: false, failed: [] });
const BACKOFF_START_MS = 1000;
const BACKOFF_CAP_MS = 60_000;
const MIN_WAIT_MS = 250;
const MAX_CONFLICTS = 4;
/** Recorded failures kept (the newest): they carry over between pumps, so a root failing every cycle must not grow them for ever. */
const MAX_FAILED_KEPT = 50;
/** Rebuilds after `body_conflict` (two packs of one project merged the same bodies at once). */
const MAX_BODY_CONFLICTS = 3;
/** Rows per side write: the single writer's bound. */
const SIDE_ROWS_CHUNK = 500;
/** The analysis snapshot the server takes (2 MB). */
const MAX_ANALYSIS_BYTES = 2 * 1024 * 1024;
const sleepFor = (ms, signal) => new Promise((resolve) => {
    if (signal.aborted) {
        resolve();
        return;
    }
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
});
const statusOf = (error) => {
    const status = error?.status;
    return typeof status === 'number' ? status : undefined;
};
const codeOf = (error) => {
    const code = error?.code;
    return typeof code === 'string' ? code : undefined;
};
const messageOf = (error) => (error instanceof Error ? error.message : String(error));
/**
 * Hashes whose bodies are missing (held back by the pack builder, or named by the server's `extracted_missing`): those this
 * store holds NO body for (`getExtracted` undefined: a legacy binary file the review never recorded, a file not extracted yet)
 * are asked of the next review through the store's re-check channel. The review reads just those files, stores `[]` for a
 * binary one and extracts a text one. A store without the channel is left as it was. Never throws.
 */
async function askRecheck(local, named) {
    if (!local.markRecheck || named.length === 0)
        return;
    try {
        const absent = [];
        for (const hash of new Set(named))
            if ((await local.getExtracted?.(hash)) === undefined)
                absent.push(hash);
        if (absent.length > 0)
            await local.markRecheck(absent);
    }
    catch {
        // Best effort: the pump's own handling is unchanged.
    }
}
/** Worth waiting for: rate limited, the server failing, or unreachable (the client reports that as status 0). */
const transient = (status) => status === 429 || status === 0 || (status !== undefined && status >= 500);
/**
 * The server's limit on one pack (`knowledgeSyncPorts.MAX_PACK_BYTES`): 24 MB of compressed parts in all (the codec's decoded
 * cap), in at most 8 parts. The builder cuts a pack at 16 MB / 150,000 rows decoded (`replicaPack`), which deflates to well
 * under it; this is the guard for the pack that does not.
 */
export const MAX_SYNC_PACK_BYTES = 24 * 1024 * 1024;
/** Thrown inside a cycle when the pump must stop (aborted, paused): unwinds to the loop. */
class Stop extends Error {
}
const newId = () => `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export async function pumpReplica(args) {
    const { queue, local, signal, rootId } = args;
    const sleep = args.sleep ?? sleepFor;
    const now = args.now ?? Date.now;
    const state = { ...emptyReplicaState(), ...(args.initial ?? {}), failed: [...(args.initial?.failed ?? [])], sending: false };
    delete state.waitingUntil;
    delete state.waitingFor;
    delete state.paused;
    delete state.pausedStatus;
    delete state.parts;
    delete state.awaitingReview;
    const emit = async () => {
        try {
            if (state.failed.length > MAX_FAILED_KEPT)
                state.failed.splice(0, state.failed.length - MAX_FAILED_KEPT);
            state.dirty = await queue.size();
            args.onState?.({ ...state, failed: [...state.failed] });
        }
        catch { /* reporting never stops the pump */ }
    };
    let attempt = 0, streak = 0;
    /** One request, retried through 429 / 5xx / unreachable; throws {@link Stop} when the pump must stop. */
    const request = async (fn) => {
        for (;;) {
            await args.idle?.(signal);
            if (signal.aborted)
                throw new Stop();
            if (args.projectId !== undefined && (await queue.projectId()) !== args.projectId) {
                state.paused = 'project';
                throw new Stop();
            }
            try {
                const value = await fn();
                state.generationCheckedAt = now(); // the server just answered: a quiet root need not ask again for a while
                delete state.waitingUntil;
                delete state.waitingFor;
                attempt = 0;
                streak = 0;
                return value;
            }
            catch (error) {
                const status = statusOf(error);
                if (status === 401 || status === 403) {
                    state.paused = 'auth';
                    state.pausedStatus = status;
                    throw new Stop();
                }
                if (!transient(status))
                    throw error;
                streak += 1;
                if (args.maxTransientStreak !== undefined && streak >= args.maxTransientStreak) {
                    state.paused = 'unreachable';
                    if (status !== undefined)
                        state.pausedStatus = status;
                    throw new Stop();
                }
                const asked = error.retryAfterMs;
                // A server's own wait is honoured, but never shorter than MIN_WAIT_MS (`Retry-After: 0` must not spin).
                const wait = typeof asked === 'number' && asked >= 0 ? Math.max(asked, MIN_WAIT_MS) : Math.min(BACKOFF_START_MS * 2 ** attempt, BACKOFF_CAP_MS);
                attempt += 1;
                state.sending = false;
                state.waitingUntil = now() + wait;
                state.waitingFor = status === 429 ? '429' : status === 0 ? 'network' : String(status);
                await emit();
                await sleep(wait, signal);
                state.sending = true;
                delete state.waitingUntil;
            }
        }
    };
    const guarded = {
        sync: (r, p) => request(() => args.client.sync(r, p)),
        syncHave: (r, p) => request(() => args.client.syncHave(r, p)),
        syncLeaves: (r, b) => request(() => args.client.syncLeaves(r, b)),
        syncManifest: (r) => request(() => args.client.syncManifest(r)),
        writeRows: (r, rows) => request(() => args.client.writeRows(r, rows)),
    };
    /** True when the server's generation for this root differs from `generation` (one generation read, rate limited, never retried). Never throws. */
    const serverMovedPast = async (generation) => {
        if (!generationCheckDue(state.generationCheckedAt, now()))
            return false;
        if (args.projectId !== undefined && (await queue.projectId()) !== args.projectId)
            return false;
        const server = await readServerGeneration(args.client, rootId);
        if (server === undefined)
            return false;
        state.generationCheckedAt = now();
        return server !== generation;
    };
    let conflicts = 0, bodyConflicts = 0, noDiff = false, maxFiles, force, lastFiles = 0;
    let owned;
    let hadFailure = false;
    /** A side write failed for a reason worth retrying: its rows stay dirty, and the NEXT cycle (not this loop) tries them again. */
    let retryNextCycle = false;
    try {
        await emit();
        while (!signal.aborted) {
            let snap = await queue.snapshot();
            if (snap.ack && snap.keys.length === 0 && !snap.analysis) {
                if (!(await serverMovedPast(snap.ack.generation)))
                    break;
                await queue.requestReconcile();
                continue;
            }
            state.sending = true;
            await emit();
            try {
                const sources = await args.sources();
                let baseGeneration = snap.ack?.generation ?? 0;
                let mode = 'delta';
                if (!snap.ack) {
                    // Deletes only what the dirty set names: a server-only leaf another host holds is never this store's to drop.
                    const plan = await planReconcile({ rootId, local, sources, client: guarded, dirty: snap.keys });
                    if (plan.kind === 'equal') {
                        await queue.settle(snap, plan.ack);
                        state.lastSyncAt = new Date(now()).toISOString();
                        continue;
                    }
                    // What differs IS the pending work (the rest is satisfied), so a pack cut by size or a retry keeps exactly
                    // it — and whatever was marked after this snapshot was read.
                    await queue.replaceDirty(plan.touched, snap);
                    snap = await queue.snapshot();
                    mode = plan.kind === 'full' ? 'full' : 'reconcile';
                    baseGeneration = plan.baseGeneration;
                    owned = plan.kind === 'delta' ? plan.owned : undefined;
                }
                // An analysis snapshot past what the server takes can never be sent: drop it and say so, rather than loop on it.
                if (snap.analysis && JSON.stringify(snap.analysis.snapshot).length > MAX_ANALYSIS_BYTES) {
                    queue.clearAnalysis();
                    state.failed.push({ reason: 'the code analysis snapshot is over 2 MB and was not sent', status: 413 });
                    hadFailure = true;
                    snap = await queue.snapshot();
                }
                const built = await buildPack({
                    rootId, local, sources, client: guarded, touched: snap.keys, baseGeneration, analysis: snap.analysis,
                    ...(maxFiles !== undefined ? { maxFiles } : {}), noDiff, ...(force ? { forceBodies: force } : {}), ...(owned ? { ownedKeys: owned } : {}),
                });
                lastFiles = built.files;
                if (built.waiting > 0) {
                    state.awaitingReview = built.waiting;
                    // Already known to be absent (the builder checked): no second lookup.
                    try {
                        await local.markRecheck?.(built.waitingHashes);
                    }
                    catch { /* best effort */ }
                    // Only held-back files remain (and no analysis to send): the rest of the root already landed.
                    if (built.sentKeys.length === 0 && !built.analysisSent)
                        break;
                }
                else
                    delete state.awaitingReview;
                const parts = splitParts(built.bytes, args.maxPartBytes ?? MAX_PART_BYTES);
                // What the server accepts: parts adding up to MAX_SYNC_PACK_BYTES (so at most 3 of the 8 MB parts, under its cap of 8).
                // A pack past it is cut in half by files BEFORE it is sent, the same way the server's 413 would have made it.
                if (built.bytes.length > (args.maxPackBytes ?? MAX_SYNC_PACK_BYTES) && lastFiles > 1) {
                    maxFiles = Math.floor(lastFiles / 2);
                    continue;
                }
                const syncId = parts.length > 1 ? (args.newSyncId?.() ?? newId()) : undefined;
                let ack;
                for (let i = 0; i < parts.length; i++) {
                    state.parts = { sent: i, total: parts.length };
                    await emit();
                    // A stalled host whose lock may already be another's sends nothing more: the other host pumps this queue now.
                    if (args.lockHeld && !args.lockHeld())
                        throw new Stop();
                    ack = await guarded.sync(rootId, { bytes: parts[i], ...(syncId ? { syncId, part: i, parts: parts.length } : {}) });
                }
                state.parts = { sent: parts.length, total: parts.length };
                if (!ack || !ack.applied)
                    throw new Error('the server did not apply the pack');
                // Rows a pack does not carry (a person's notes, an agent's facts) go through the single writer, in chunks of
                // 500. A key whose row could not be written stays dirty; the rest are settled.
                let sentKeys = built.sentKeys;
                const side = built.sideRows;
                if (side.keys.length > 0) {
                    try {
                        for (let i = 0; i < Math.max(side.facts.length, side.relations.length); i += SIDE_ROWS_CHUNK) {
                            await guarded.writeRows(rootId, { facts: side.facts.slice(i, i + SIDE_ROWS_CHUNK), relations: side.relations.slice(i, i + SIDE_ROWS_CHUNK) });
                        }
                    }
                    catch (error) {
                        if (error instanceof Stop)
                            throw error;
                        const status = statusOf(error);
                        hadFailure = true;
                        state.failed.push({ reason: messageOf(error), ...(status !== undefined ? { status } : {}) });
                        // A 4xx is the server's final answer about THESE rows (the writer refused them): retrying every cycle
                        // can never succeed, so they leave the dirty set and stay recorded in `failed`. Anything else is kept.
                        if (!(status !== undefined && status >= 400 && status < 500)) {
                            const unsent = new Set(side.keys);
                            sentKeys = sentKeys.filter((k) => !unsent.has(k));
                            retryNextCycle = true;
                        }
                    }
                }
                // `ack.reconcile`: the server invalidated leaves of this root while applying the pack (a healed body), so the ack is not
                // a base to build on: ONE queue operation drops the sent keys and stores no ack (the next cycle reconciles).
                await queue.settle(snap, { generation: ack.generation, digest: ack.digest }, sentKeys, built.analysisSent, ack.reconcile === true);
                // Rows the server would refuse (a control character in a path or key) were left out of the pack and settled: one
                // such file must not 422 the pack and stall the pump. They are recorded, never silent.
                for (const row of built.skipped) {
                    state.failed.push({ reason: row.reason });
                    hadFailure = true;
                }
                state.lastPack = {
                    bytes: built.bytes.length, jsonBytes: built.jsonBytes, files: built.files, parts: parts.length, mode,
                    percent: built.jsonBytes > 0 ? Math.round((built.bytes.length / built.jsonBytes) * 1000) / 10 : 0,
                };
                state.lastSyncAt = new Date(now()).toISOString();
                conflicts = 0;
                bodyConflicts = 0;
                noDiff = false;
                force = undefined;
                owned = undefined;
                // A cut that landed lets the next pack grow back (doubling, unlimited once a pack carried the rest), so one 413 never throttles the whole run.
                if (maxFiles !== undefined)
                    maxFiles = built.final ? undefined : maxFiles * 2;
                delete state.parts;
                if (retryNextCycle)
                    break;
            }
            catch (error) {
                if (error instanceof Stop)
                    break;
                const status = statusOf(error), code = codeOf(error);
                // Another pack changed the same bodies at the same moment: rebuild and resend now (no reconcile), at most 3 times.
                if (status === 409 && code === 'body_conflict' && bodyConflicts < MAX_BODY_CONFLICTS) {
                    bodyConflicts += 1;
                    continue;
                }
                // Past its 3 rebuilds a body_conflict is a failure, not a reconcile: another writer is hammering the same bodies.
                if (status === 409 && code !== 'body_conflict' && conflicts < MAX_CONFLICTS) {
                    conflicts += 1;
                    if (code === 'prior_missing')
                        noDiff = true;
                    else if (code === 'extracted_missing') {
                        const named = error.hashes ?? [];
                        force = new Set(named);
                        await askRecheck(local, named);
                    }
                    else if (code !== 'parts_missing')
                        await queue.requestReconcile();
                    continue;
                }
                if (status === 413 && code === 'pack_too_large' && lastFiles > 1) {
                    maxFiles = Math.floor(lastFiles / 2);
                    continue;
                }
                hadFailure = true;
                state.failed.push({ reason: messageOf(error), ...(status !== undefined ? { status } : {}) });
                break;
            }
        }
        if (!signal.aborted && !state.paused && !hadFailure && (await queue.size()) === 0)
            state.failed = [];
    }
    catch (error) {
        state.failed.push({ reason: `replica pump: ${messageOf(error)}` });
    }
    finally {
        state.sending = false;
        delete state.waitingUntil;
        delete state.waitingFor;
        delete state.parts;
        try {
            await queue.flush();
        }
        catch { /* durable on the next flush */ }
        await emit();
    }
    return state;
}
//# sourceMappingURL=replicaPump.js.map