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
 *                             without diffs; `extracted_missing`: resend with those bodies; at most 4 in a row.
 *   413 pack_too_large        the pack is cut in half (by files) and the rest stays dirty.
 *   422 / any other error     recorded in `failed`; the set is kept and the pump stops.
 *   side rows (notes, agent facts)  a 4xx is final: the rows leave the set and stay in `failed`; a 5xx or network
 *                             error keeps them dirty and ends this cycle (the next one retries).
 *
 * Before EVERY request the pump checks the set still belongs to its project (`projectId`) and waits out a
 * running review of the root (`idle`). `pumpReplica` never throws.
 */

import type { KnowledgeStore, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import { MAX_PART_BYTES, splitParts } from '@seanhogg/builderforce-memory/knowledge/pack';
import { buildPack, type PackQueries, type ReplicaSource } from './replicaPack.js';
import type { ReplicaQueue } from './replicaQueue.js';
import { planReconcile, type ReconcileQueries } from './replicaReconcile.js';

/** The knowledge client's sync calls the pump uses (a `KnowledgeClient` satisfies it structurally). */
export interface ReplicaClient extends PackQueries, ReconcileQueries {
    sync(rootId: string, part: { bytes: Uint8Array; syncId?: string; part?: number; parts?: number }): Promise<
        { applied: true; generation: number; digest: string } | { applied: false; received: number; parts: number }>;
    /** The existing single writer (≤ 500 rows): the path for rows a pack does not carry. */
    writeRows(rootId: string, rows: { facts: readonly StoredFact[]; relations: readonly StoredRelation[] }): Promise<void>;
}

export interface ReplicaFailure {
    reason: string;
    /** The HTTP status, when the error had one. */
    status?: number;
}

/** The last pack that reached the server. */
export interface ReplicaPackStats {
    /** Compressed bytes sent (all parts). */
    bytes: number;
    /** The bytes the same rows would take as JSON. */
    jsonBytes: number;
    /** `bytes` as a percentage of `jsonBytes`. */
    percent: number;
    parts: number;
    files: number;
    mode: 'delta' | 'reconcile' | 'full';
}

export interface ReplicaState {
    /** Dirty keys still to send. */
    dirty: number;
    sending: boolean;
    /** Parts of the pack being sent: how many the server has, how many in all. */
    parts?: { sent: number; total: number };
    /** Epoch ms the pump retries at, while it waits out a 429 or an outage. */
    waitingUntil?: number;
    /** Why it waits (`429`, `network`, or the server status). */
    waitingFor?: string;
    /** Why it stopped with work left: signed out (`auth`), the server unreachable, or the set moved to another project. */
    paused?: 'auth' | 'unreachable' | 'project';
    pausedStatus?: number;
    failed: ReplicaFailure[];
    /** ISO time of the last pack the server acknowledged. */
    lastSyncAt?: string;
    lastPack?: ReplicaPackStats;
}

export const emptyReplicaState = (): ReplicaState => ({ dirty: 0, sending: false, failed: [] });

export interface PumpArgs {
    queue: ReplicaQueue;
    local: KnowledgeStore;
    client: ReplicaClient;
    signal: AbortSignal;
    rootId: string;
    /** The root's current sources (ref and content hash): the local truth the pack is built from. */
    sources(): Promise<ReplicaSource[]>;
    /** The project the client talks to: the pump stops the moment the set belongs to another. */
    projectId?: number;
    onState?(state: ReplicaState): void;
    /** Carry the last pack and failures of an earlier pump of this root forward. */
    initial?: ReplicaState;
    /** Resolves when no review of the root is running; awaited before each request. */
    idle?(signal: AbortSignal): Promise<void>;
    /** Stop (`paused: 'unreachable'`) after this many transient failures in a row. Default: never. */
    maxTransientStreak?: number;
    /** Compressed bytes per part (default 8 MB). */
    maxPartBytes?: number;
    /** Compressed bytes one pack may total before it is cut by files (default {@link MAX_SYNC_PACK_BYTES}: the server's cap). */
    maxPackBytes?: number;
    /** Names a multi-part pack. */
    newSyncId?(): string;
    /** Injected for tests. */
    sleep?(ms: number, signal: AbortSignal): Promise<void>;
    now?(): number;
}

const BACKOFF_START_MS = 1000;
const BACKOFF_CAP_MS = 60_000;
const MIN_WAIT_MS = 250;
const MAX_CONFLICTS = 4;
/** Rebuilds after `body_conflict` (two packs of one project merged the same bodies at once). */
const MAX_BODY_CONFLICTS = 3;
/** Rows per side write: the single writer's bound. */
const SIDE_ROWS_CHUNK = 500;
/** The analysis snapshot the server takes (2 MB). */
const MAX_ANALYSIS_BYTES = 2 * 1024 * 1024;

const sleepFor = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
        if (signal.aborted) { resolve(); return; }
        const done = (): void => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, ms);
        signal.addEventListener('abort', done, { once: true });
    });

const statusOf = (error: unknown): number | undefined => {
    const status = (error as { status?: unknown } | null)?.status;
    return typeof status === 'number' ? status : undefined;
};
const codeOf = (error: unknown): string | undefined => {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' ? code : undefined;
};
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
/** Worth waiting for: rate limited, the server failing, or unreachable (the client reports that as status 0). */
const transient = (status: number | undefined): boolean => status === 429 || status === 0 || (status !== undefined && status >= 500);

/**
 * The server's limit on one pack (`knowledgeSyncPorts.MAX_PACK_BYTES`): 24 MB of compressed parts in all (the codec's decoded
 * cap), in at most 8 parts. The builder cuts a pack at 16 MB / 150,000 rows decoded (`replicaPack`), which deflates to well
 * under it; this is the guard for the pack that does not.
 */
export const MAX_SYNC_PACK_BYTES = 24 * 1024 * 1024;

/** Thrown inside a cycle when the pump must stop (aborted, paused): unwinds to the loop. */
class Stop extends Error {}

const newId = (): string => `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function pumpReplica(args: PumpArgs): Promise<ReplicaState> {
    const { queue, local, signal, rootId } = args;
    const sleep = args.sleep ?? sleepFor;
    const now = args.now ?? Date.now;
    const state: ReplicaState = { ...emptyReplicaState(), ...(args.initial ?? {}), failed: [...(args.initial?.failed ?? [])], sending: false };
    delete state.waitingUntil; delete state.waitingFor; delete state.paused; delete state.pausedStatus; delete state.parts;
    const emit = async (): Promise<void> => {
        try {
            state.dirty = await queue.size();
            args.onState?.({ ...state, failed: [...state.failed] });
        } catch { /* reporting never stops the pump */ }
    };

    let attempt = 0, streak = 0;
    /** One request, retried through 429 / 5xx / unreachable; throws {@link Stop} when the pump must stop. */
    const request = async <T>(fn: () => Promise<T>): Promise<T> => {
        for (;;) {
            await args.idle?.(signal);
            if (signal.aborted) throw new Stop();
            if (args.projectId !== undefined && (await queue.projectId()) !== args.projectId) { state.paused = 'project'; throw new Stop(); }
            try {
                const value = await fn();
                delete state.waitingUntil; delete state.waitingFor;
                attempt = 0; streak = 0;
                return value;
            } catch (error) {
                const status = statusOf(error);
                if (status === 401 || status === 403) { state.paused = 'auth'; state.pausedStatus = status; throw new Stop(); }
                if (!transient(status)) throw error;
                streak += 1;
                if (args.maxTransientStreak !== undefined && streak >= args.maxTransientStreak) { state.paused = 'unreachable'; if (status !== undefined) state.pausedStatus = status; throw new Stop(); }
                const asked = (error as { retryAfterMs?: unknown }).retryAfterMs;
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
        sync: (r: string, p: Parameters<ReplicaClient['sync']>[1]) => request(() => args.client.sync(r, p)),
        syncHave: (r: string, p: Parameters<ReplicaClient['syncHave']>[1]) => request(() => args.client.syncHave(r, p)),
        syncLeaves: (r: string, b: readonly number[]) => request(() => args.client.syncLeaves(r, b)),
        syncManifest: (r: string) => request(() => args.client.syncManifest(r)),
        writeRows: (r: string, rows: { facts: readonly StoredFact[]; relations: readonly StoredRelation[] }) => request(() => args.client.writeRows(r, rows)),
    };

    let conflicts = 0, bodyConflicts = 0, noDiff = false, maxFiles: number | undefined, force: Set<string> | undefined, lastFiles = 0;
    let owned: Set<string> | undefined;
    let hadFailure = false;
    /** A side write failed for a reason worth retrying: its rows stay dirty, and the NEXT cycle (not this loop) tries them again. */
    let retryNextCycle = false;
    try {
        await emit();
        while (!signal.aborted) {
            let snap = await queue.snapshot();
            if (snap.ack && snap.keys.length === 0 && !snap.analysis) break;
            state.sending = true;
            await emit();
            try {
                const sources = await args.sources();
                let baseGeneration = snap.ack?.generation ?? 0;
                let mode: ReplicaPackStats['mode'] = 'delta';
                if (!snap.ack) {
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
                const parts = splitParts(built.bytes, args.maxPartBytes ?? MAX_PART_BYTES);
                // What the server accepts: parts adding up to MAX_SYNC_PACK_BYTES (so at most 3 of the 8 MB parts, under its cap of 8).
                // A pack past it is cut in half by files BEFORE it is sent, the same way the server's 413 would have made it.
                if (built.bytes.length > (args.maxPackBytes ?? MAX_SYNC_PACK_BYTES) && lastFiles > 1) { maxFiles = Math.floor(lastFiles / 2); continue; }
                const syncId = parts.length > 1 ? (args.newSyncId?.() ?? newId()) : undefined;
                let ack: Awaited<ReturnType<ReplicaClient['sync']>> | undefined;
                for (let i = 0; i < parts.length; i++) {
                    state.parts = { sent: i, total: parts.length };
                    await emit();
                    ack = await guarded.sync(rootId, { bytes: parts[i]!, ...(syncId ? { syncId, part: i, parts: parts.length } : {}) });
                }
                state.parts = { sent: parts.length, total: parts.length };
                if (!ack || !ack.applied) throw new Error('the server did not apply the pack');
                // Rows a pack does not carry (a person's notes, an agent's facts) go through the single writer, in chunks of
                // 500. A key whose row could not be written stays dirty; the rest are settled.
                let sentKeys = built.sentKeys;
                const side = built.sideRows;
                if (side.keys.length > 0) {
                    try {
                        for (let i = 0; i < Math.max(side.facts.length, side.relations.length); i += SIDE_ROWS_CHUNK) {
                            await guarded.writeRows(rootId, { facts: side.facts.slice(i, i + SIDE_ROWS_CHUNK), relations: side.relations.slice(i, i + SIDE_ROWS_CHUNK) });
                        }
                    } catch (error) {
                        if (error instanceof Stop) throw error;
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
                await queue.settle(snap, { generation: ack.generation, digest: ack.digest }, sentKeys, built.analysisSent);
                // Rows the server would refuse (a control character in a path or key) were left out of the pack and settled: one
                // such file must not 422 the pack and stall the pump. They are recorded, never silent.
                for (const row of built.skipped) { state.failed.push({ reason: row.reason }); hadFailure = true; }
                state.lastPack = {
                    bytes: built.bytes.length, jsonBytes: built.jsonBytes, files: built.files, parts: parts.length, mode,
                    percent: built.jsonBytes > 0 ? Math.round((built.bytes.length / built.jsonBytes) * 1000) / 10 : 0,
                };
                state.lastSyncAt = new Date(now()).toISOString();
                conflicts = 0; bodyConflicts = 0; noDiff = false; force = undefined; owned = undefined;
                delete state.parts;
                if (retryNextCycle) break;
            } catch (error) {
                if (error instanceof Stop) break;
                const status = statusOf(error), code = codeOf(error);
                // Another pack changed the same bodies at the same moment: rebuild and resend now (no reconcile), at most 3 times.
                if (status === 409 && code === 'body_conflict' && bodyConflicts < MAX_BODY_CONFLICTS) { bodyConflicts += 1; continue; }
                // Past its 3 rebuilds a body_conflict is a failure, not a reconcile: another writer is hammering the same bodies.
                if (status === 409 && code !== 'body_conflict' && conflicts < MAX_CONFLICTS) {
                    conflicts += 1;
                    if (code === 'prior_missing') noDiff = true;
                    else if (code === 'extracted_missing') force = new Set((error as { hashes?: string[] }).hashes ?? []);
                    else if (code !== 'parts_missing') await queue.requestReconcile();
                    continue;
                }
                if (status === 413 && code === 'pack_too_large' && lastFiles > 1) { maxFiles = Math.floor(lastFiles / 2); continue; }
                hadFailure = true;
                state.failed.push({ reason: messageOf(error), ...(status !== undefined ? { status } : {}) });
                break;
            }
        }
        if (!signal.aborted && !state.paused && !hadFailure && (await queue.size()) === 0) state.failed = [];
    } catch (error) {
        state.failed.push({ reason: `replica pump: ${messageOf(error)}` });
    } finally {
        state.sending = false;
        delete state.waitingUntil; delete state.waitingFor; delete state.parts;
        try { await queue.flush(); } catch { /* durable on the next flush */ }
        await emit();
    }
    return state;
}
