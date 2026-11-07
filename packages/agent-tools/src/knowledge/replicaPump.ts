/**
 * knowledge/replicaPump.ts — drains the replica queue to the linked project (PRD 41 A7).
 *
 * The review never waits for it and never sees its failures. The pump reads bodies from the LOCAL
 * store, sends them with the knowledge client's calls (`writeRows` ≤ 500 rows per op, the scope as
 * its own last op, `putExtracted`, `store.markStale`, `putAnalysis`), and reports a {@link ReplicaState}:
 *
 *   429 / 5xx / unreachable   the op stays queued; the pump waits `Retry-After` (else an exponential
 *                             backoff capped at 60 s) and tries again. Progress is per op, so a later
 *                             run resumes at the op that failed, not at the first one. It stops on
 *                             `signal`, or — when `maxTransientStreak` is set — after that many in a row
 *                             (`paused: 'unreachable'`).
 *   401 / 403                 the op is KEPT and the pump pauses (`paused: 'auth'`): an expired token
 *                             must never drain a queue. The next start resumes.
 *   413                       a write op is split in half and retried, down to one row; only a single
 *                             row the platform still refuses is skipped (its key recorded). Any other op
 *                             is skipped.
 *   any other error           the op is dropped as `failed` with its reason; the pump goes on.
 *
 * Before EVERY send the pump checks that the queue still belongs to its project (`projectId`), and waits
 * out a running review of the root (`idle`). `pumpReplica` never throws.
 */

import type { Extracted, KnowledgeStore, ScopeRecord, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import { relationKey, type ReplicaOp, type ReplicaQueue } from './replicaQueue.js';

/** The knowledge client's calls the pump uses (a `KnowledgeClient` satisfies it structurally). */
export interface ReplicaClient {
    store: Pick<KnowledgeStore, 'write' | 'markStale'>;
    putExtracted(hash: string, extracted: Extracted[]): Promise<void>;
    putAnalysis(sha: string, snapshot: never): Promise<void>;
    writeRows(rootId: string, rows: { facts: readonly StoredFact[]; relations: readonly StoredRelation[] }): Promise<void>;
    /** Uploads the client skipped instead of throwing (a 413 on `putExtracted`). */
    readonly skipped?: readonly unknown[];
}

export interface ReplicaFailure {
    op: ReplicaOp['op'];
    reason: string;
    /** The HTTP status, when the error had one. */
    status?: number;
}

export interface ReplicaState {
    /** Ops still to send. */
    queued: number;
    sending: boolean;
    /** Epoch ms the pump retries at, while it waits out a 429 or an outage. */
    waitingUntil?: number;
    /** Why it waits (`429`, `network`, or the server status). */
    waitingFor?: string;
    /** Why it stopped with work left: signed out (`auth`), the server unreachable, or the queue moved to another project. */
    paused?: 'auth' | 'unreachable' | 'project';
    pausedStatus?: number;
    skipped: number;
    /** What was skipped, by op kind (at most 50 kept). */
    skippedOps: { op: ReplicaOp['op']; key?: string }[];
    failed: ReplicaFailure[];
    /** ISO time of the last op that reached the server. */
    lastSyncAt?: string;
}

export const emptyReplicaState = (): ReplicaState => ({ queued: 0, sending: false, skipped: 0, skippedOps: [], failed: [] });

export interface PumpArgs {
    queue: ReplicaQueue;
    local: KnowledgeStore;
    client: ReplicaClient;
    signal: AbortSignal;
    /** The project the client talks to: the pump stops the moment the queue belongs to another. */
    projectId?: number;
    onState?(state: ReplicaState): void;
    /** Carry the counts of an earlier pump of this root forward. */
    initial?: ReplicaState;
    /** Ops read from the queue at a time (default 200). */
    batchSize?: number;
    /** Resolves when no review of the root is running; awaited before each send. */
    idle?(signal: AbortSignal): Promise<void>;
    /** Stop (`paused: 'unreachable'`) after this many transient failures in a row. Default: never. */
    maxTransientStreak?: number;
    /** Injected for tests. */
    sleep?(ms: number, signal: AbortSignal): Promise<void>;
    now?(): number;
}

const BACKOFF_START_MS = 1000;
const BACKOFF_CAP_MS = 60_000;
const MIN_WAIT_MS = 250;
const SKIPPED_KEPT = 50;

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
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
/** Worth waiting for: rate limited, the server failing, or unreachable (the client reports that as status 0). */
const transient = (status: number | undefined): boolean => status === 429 || status === 0 || (status !== undefined && status >= 500);

/** The local rows of a root, read once per batch. */
interface RowCache { facts: Map<string, StoredFact[]>; relations: Map<string, StoredRelation[]> }

/** Sends one op; resolves to how it ended. Throws what the client threw. */
async function send(op: ReplicaOp, local: KnowledgeStore, client: ReplicaClient, rows: RowCache): Promise<'sent' | 'nothing'> {
    switch (op.op) {
        case 'putExtracted': {
            const body = await local.getExtracted?.(op.hash);
            if (!body || body.length === 0) return 'nothing';
            await client.putExtracted(op.hash, body);
            return 'sent';
        }
        case 'markStale':
            await client.store.markStale({ rootId: op.rootId }, op.sourceRef as never, op.hash);
            return 'sent';
        case 'putAnalysis':
            await client.putAnalysis(op.sha, op.snapshot as never);
            return 'sent';
        case 'scope':
            await client.store.write({ scope: op.scope as ScopeRecord, facts: [], relations: [] });
            return 'sent';
        case 'write': {
            const scope = { rootId: op.rootId };
            if (!rows.facts.has(op.rootId)) rows.facts.set(op.rootId, await local.facts(scope));
            if (!rows.relations.has(op.rootId)) rows.relations.set(op.rootId, await local.relations(scope));
            const wantFacts = new Set(op.facts), wantRelations = new Set(op.relations);
            const facts = rows.facts.get(op.rootId)!.filter((f) => wantFacts.has(f.key));
            const relations = rows.relations.get(op.rootId)!.filter((r) => wantRelations.has(relationKey(r)));
            if (facts.length + relations.length === 0) return 'nothing';
            await client.writeRows(op.rootId, { facts, relations });
            return 'sent';
        }
    }
}

/** A write op cut in two (a 413): its rows in order, half and half. */
function halves(op: Extract<ReplicaOp, { op: 'write' }>): ReplicaOp[] {
    const rows = [...op.facts.map((k) => ({ fact: true, k })), ...op.relations.map((k) => ({ fact: false, k }))];
    const mid = Math.ceil(rows.length / 2);
    const part = (list: typeof rows): ReplicaOp => ({
        op: 'write', rootId: op.rootId, facts: list.filter((r) => r.fact).map((r) => r.k), relations: list.filter((r) => !r.fact).map((r) => r.k),
    });
    return [part(rows.slice(0, mid)), part(rows.slice(mid))];
}

export async function pumpReplica(args: PumpArgs): Promise<ReplicaState> {
    const { queue, local, client, signal } = args;
    const sleep = args.sleep ?? sleepFor;
    const now = args.now ?? Date.now;
    const batchSize = args.batchSize ?? 200;
    const state: ReplicaState = {
        ...emptyReplicaState(), ...(args.initial ?? {}),
        skippedOps: [...(args.initial?.skippedOps ?? [])], failed: [...(args.initial?.failed ?? [])], sending: false,
    };
    delete state.waitingUntil;
    delete state.waitingFor;
    delete state.paused;
    delete state.pausedStatus;
    const emit = async (): Promise<void> => {
        try {
            state.queued = await queue.size();
            args.onState?.({ ...state, skippedOps: [...state.skippedOps], failed: [...state.failed] });
        } catch { /* reporting never stops the pump */ }
    };
    const skip = (op: ReplicaOp['op'], key?: string): void => {
        state.skipped += 1;
        if (state.skippedOps.length < SKIPPED_KEPT) state.skippedOps.push({ op, ...(key ? { key } : {}) });
    };
    let attempt = 0, streak = 0, newFailures = 0;
    try {
        await emit();
        outer: while (!signal.aborted) {
            const rows: RowCache = { facts: new Map(), relations: new Map() };
            // Queue order is send order: a stale-marking queued after a write never reaches the server before it.
            const batch = await queue.peek(batchSize);
            if (batch.length === 0) break;
            state.sending = true;
            for (const op of batch) {
                // One op, retried until it is sent, skipped, split or failed (or the pump is stopped).
                for (;;) {
                    await args.idle?.(signal);
                    if (signal.aborted) break outer;
                    if (args.projectId !== undefined && (await queue.projectId()) !== args.projectId) { state.paused = 'project'; break outer; }
                    const skippedBefore = client.skipped?.length ?? 0;
                    try {
                        await emit();
                        const outcome = await send(op, local, client, rows);
                        if (outcome === 'sent') state.lastSyncAt = new Date(now()).toISOString();
                        for (let i = skippedBefore; i < (client.skipped?.length ?? 0); i++) skip(op.op, op.op === 'putExtracted' ? op.hash : undefined);
                        delete state.waitingUntil;
                        delete state.waitingFor;
                        attempt = 0; streak = 0;
                        await queue.remove([op]);
                        break;
                    } catch (error) {
                        const status = statusOf(error);
                        if (status === 413) {
                            if (op.op === 'write' && op.facts.length + op.relations.length > 1) { await queue.replace(op, halves(op)); break; }
                            skip(op.op, op.op === 'write' ? (op.facts[0] ?? op.relations[0]) : op.op === 'putExtracted' ? op.hash : undefined);
                            await queue.remove([op]);
                            break;
                        }
                        if (status === 401 || status === 403) {
                            // Signed out or refused: the work is not lost, it waits for the next start.
                            state.paused = 'auth'; state.pausedStatus = status;
                            break outer;
                        }
                        if (!transient(status)) {
                            newFailures += 1;
                            state.failed.push({ op: op.op, reason: messageOf(error), ...(status !== undefined ? { status } : {}) });
                            await queue.remove([op]);
                            break;
                        }
                        streak += 1;
                        if (args.maxTransientStreak !== undefined && streak >= args.maxTransientStreak) { state.paused = 'unreachable'; state.pausedStatus = status; break outer; }
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
            }
            await queue.flush();
        }
        // A run that emptied the queue without a new failure clears the old ones.
        if (!signal.aborted && !state.paused && newFailures === 0 && (await queue.size()) === 0) state.failed = [];
    } catch (error) {
        state.failed.push({ op: 'write', reason: `replica pump: ${messageOf(error)}` });
    } finally {
        state.sending = false;
        delete state.waitingUntil;
        delete state.waitingFor;
        try { await queue.flush(); } catch { /* durable on the next flush */ }
        await emit();
    }
    return state;
}
