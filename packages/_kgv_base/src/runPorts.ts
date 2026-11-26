/**
 * The run ports of `KnowledgeGraphSource` (`types.ts`, which re-exports every name here): the host's
 * review runs (PRD 41 A8) with the replica queue they report, and its recorded agent runs (PRD 46).
 */

import type { ReviewFailure as MemoryReviewFailure, ReviewRun as MemoryReviewRun } from '@seanhogg/builderforce-memory/knowledge';
import type { AgentRunEvidenceNoteId } from './labels/surface.agentRuns';

/**
 * The queue of a linked root's writes still owed to the project (PRD 41 A7), as the host reports it
 * (restated from agent-tools' `ReplicaState`: the view never imports a host package).
 */
export type ReplicaState = {
    /** Dirty keys still to send (files, facts and relations changed since the server's last acknowledgement). */
    dirty: number;
    sending: boolean;
    /** Parts of the pack being sent: how many the server has, how many in all. */
    parts?: { sent: number; total: number };
    /** Epoch ms the host retries at, while it waits out a rate limit or an outage. */
    waitingUntil?: number;
    /** Why it waits: `429`, `network`, or a server status. */
    waitingFor?: string;
    /** Files held back from the packs because their extracted output is not there yet: they wait for a review, the rest was sent. */
    awaitingReview?: number;
    /** Why it stopped with work left: signed out, the server unreachable, or the queue moved to another project. */
    paused?: 'auth' | 'unreachable' | 'project';
    pausedStatus?: number;
    failed: { reason: string; status?: number }[];
    /** ISO time of the last pack the project acknowledged. */
    lastSyncAt?: string;
    /** The last pack that reached the project: compressed bytes, the bytes of the same rows as JSON, and the ratio. */
    lastPack?: { bytes: number; jsonBytes: number; percent: number; parts: number; files: number; mode: 'delta' | 'reconcile' | 'full' };
};

/**
 * A review run as the host records it (PRD 41 A8): memory's `ReviewRun` (phases, lanes, the last steps, every
 * failure, the outcome and report) plus where the replica queue stood when it ended.
 */
export type StoredReviewRun = Omit<MemoryReviewRun, 'outcome' | 'failures'> & {
    /** Every failure, oldest first (memory keeps them in chunks; the host sends them flat). */
    failures: MemoryReviewFailure[];
    /** `interrupted` is the host's word for a run left `running` by a window that closed. */
    outcome?: MemoryReviewRun['outcome'] | 'interrupted';
    replica?: ReplicaState;
    /** Why parallel extraction was unavailable (the run extracted on one thread). */
    poolDown?: string;
    /** Event-loop stall of the host during the run (ms); absent on older records. */
    hostLag?: { maxMs: number; p99Ms: number; meanMs: number };
    /** The slowest save of the run record to disk (ms). */
    saveMsMax?: number;
    /** On a live event `failures` holds only the latest; this is how many there are in all (`runs.get` returns every one). */
    failureCount?: number;
    /** Files owed judgement when the map was completed (the host sets it at `mapped`); a live run record carries no other owed total. */
    awaitingJudgeTotal?: number;
};

/** A run without its steps, lanes and failures: what the history list needs. */
export type ReviewRunSummary = Omit<StoredReviewRun, 'steps' | 'lanes' | 'failures'> & { failureCount: number };

/** The host's review runs (PRD 41 A8): the Run panel's live record, its history and Stop. (Retry is a review request: `ReviewRequest.retry`.) */
export interface ReviewRunsPort {
    /** Every run record the host posts while a review runs, newest state last. Returns the unsubscribe. */
    subscribe(cb: (run: StoredReviewRun) => void): () => void;
    /** The root's recent runs, newest first. */
    list(rootId: string): Promise<ReviewRunSummary[]>;
    /** One whole run, every failure included; null when the host no longer holds it. */
    get(runId: string): Promise<StoredReviewRun | null>;
    /** Stops a running run by its id. */
    stop(runId: string): Promise<void>;
}

// Agent-run findings (PRD 46 §3.3): consumer-owned. The host's detector returns a structurally identical type; the
// adapter is where the two meet and the compiler proves they match. This package never imports the detector.
export type AgentRunSeverity = 'info' | 'warn' | 'error';
export interface AgentRunSummary { id: string; title: string; startedAt: string; endedAt: string; models: readonly string[];
    turns: number; counts: Readonly<Record<AgentRunSeverity, number>> }
export type AgentRunTurnKind = 'read' | 'write' | 'forced' | 'text' | 'failed';
export interface AgentRunTurn { index: number; role: string; model: string; kind: AgentRunTurnKind; toolCalls: number;
    promptTokens: number; completionTokens: number; durationMs: number }
/** `note` names what the row measured (worded by `agentRuns.evidenceNotes`); `params` are its numbers. */
export interface AgentRunEvidence { step: number; turn?: number; label: string; path?: string; excerpt?: string;
    note?: AgentRunEvidenceNoteId; params?: Readonly<Record<string, number>> }
export interface AgentRunFinding { id: string; kind: string; severity: AgentRunSeverity;
    params: Readonly<Record<string, string | number>>; evidence: readonly AgentRunEvidence[] }
export interface AgentRunFile { path: string; writes: number; checked: boolean }
export interface AgentRunReport { summary: AgentRunSummary; turns: readonly AgentRunTurn[];
    findings: readonly AgentRunFinding[]; files: readonly AgentRunFile[];
    /** The absolute folder of the graph root named in `report(id, rootId)`, when the host knows it: an absolute file
     *  path is matched to the graph only under it. */
    root?: string }
/** The host's recorded agent runs and what each did wrong. Absent ⇒ no Agent runs drawer. */
export interface AgentRunsPort { list(): Promise<readonly AgentRunSummary[]>; report(id: string, rootId?: string): Promise<AgentRunReport | null> }
