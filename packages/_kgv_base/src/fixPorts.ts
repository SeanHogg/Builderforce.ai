/**
 * The data of the staged fix flow and the simulation, as plain types the OPTIONAL ports of
 * `KnowledgeGraphSource` speak (`runFixChecks`, `previewFix`, `undoFix`, `markResolved`,
 * `recordedValues`, `applyFixKinds`). A host that does not implement a port simply leaves it
 * out, and the view then hands that step to the agent instead of drawing a dead button.
 */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';

/**
 * The four checks of a fix, in order (the mockup's): typecheck the touched packages, targeted
 * tests, re-scan ("the issue is gone"), and a review by the agent. A host answers the first three
 * (`HOST_CHECK_IDS`); the review is always the agent's, through the composer. Names are catalog
 * labels, never host text.
 */
export const FIX_CHECK_IDS = ['types', 'tests', 'rescan', 'review'] as const;
export type FixCheckId = (typeof FIX_CHECK_IDS)[number];
/** The checks a host runs; the last one (`review`) is the agent's. */
export const HOST_CHECK_IDS: readonly FixCheckId[] = ['types', 'tests', 'rescan'];

/**
 * `pending`, `running`, `error` (it never reported, or its run failed to start) and `agent` (sent
 * to the agent) are the view's; a host reports `pass`, `fail` or `skipped` (it has nothing to run).
 */
export type FixCheckStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skipped' | 'error' | 'agent';
export interface FixCheckResult { id: FixCheckId; status: 'pass' | 'fail' | 'skipped' | 'error'; detail?: string }
/** What a host reports while checks run: a check starting (`running`) or settling. */
export interface FixCheckUpdate { id: FixCheckId; status: FixCheckStatus; detail?: string }

/** What an applied fix left behind: the branch it landed on (when the host keeps one) and the changed paths. */
export interface AppliedFix {
    branch?: string;
    /** Why no branch was made (git refused), when the fix applied in place instead. */
    branchError?: string;
    changed: string[];
    /** What a host's undo takes (the host recorded what the fix wrote). Absent ⇒ the host keeps no undo record. */
    fixId?: string;
}

export interface FixStepRequest {
    finding: Finding;
    applied: AppliedFix;
    /** The test files (paths) of the files that usually change with the finding's (PRD 38 P4): the `tests` check runs them too. Absent ⇒ none known. */
    partnerTests?: string[];
    /** Aborted when the person leaves the finding or closes the view: a host stops the running check. */
    signal?: AbortSignal;
}

/** What a fix would change, before it is applied: files, and the lines it removes or adds when the host can tell. */
export interface FixPreview {
    files: { path: string; removed?: number; added?: number; lines?: string[] }[];
}

/** A failure a host port raises that the view words itself, by code (never host English). */
export type FixErrorCode = 'noRoot' | 'noRecord';
export class FixStepError extends Error {
    constructor(readonly code: FixErrorCode) {
        super(code);
        this.name = 'FixStepError';
    }
}

/** One value a host recorded at a stop of a path (a call's argument, or what it returned). */
export interface RecordedValue {
    stopId: string;
    /** The argument or result name (`amount`, `response`). */
    name: string;
    value: string;
    direction: 'in' | 'out';
    /** The size of the payload, when the host measured it. */
    bytes?: number;
}

/** A recorded run along a path, with optional named argument presets. */
export interface RecordedRun {
    values: RecordedValue[];
    presets?: { name: string; values: Record<string, string> }[];
}
