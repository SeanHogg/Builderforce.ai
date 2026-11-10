/**
 * predict/labels/ci.ts — the `ci-red-after-merge` label (PRD 41 §D1): the FIRST concluded CI run on the merged commit,
 * within 7 days of the merge, fails in a job touching the changed area. A failing job with no declared paths counts as
 * touching it (no evidence it does not); a job whose path filters miss every changed path does not. Pure.
 */

import { matchGlob } from '@builderforce/agent-tools/glob';
import { LABEL_WINDOW_DAYS, type RunOutcomeLabel } from '../contract.js';
import { windowEnd, windowedLabel, within } from './window.js';

export interface CiRun {
    commitSha: string;
    at: string;
    conclusion: 'success' | 'failure' | 'cancelled' | 'pending';
    jobs?: ReadonlyArray<{ name: string; conclusion: string; paths?: readonly string[] }>;
}

export interface CiInput {
    /** Absent: not merged (yet), nothing to label. */
    merge?: { commitSha: string; mergedAt: string };
    ciRuns: readonly CiRun[];
    /** Root-relative POSIX paths the run changed. */
    changedPaths: readonly string[];
    now: string;
}

/** Whether a failing job touches the changed area: a path filter (agent-tools' ONE glob, `matchGlob`) matches a change. */
export function jobTouches(job: { paths?: readonly string[] }, changedPaths: readonly string[]): boolean {
    if (!job.paths || job.paths.length === 0) return true;
    return changedPaths.some((p) => job.paths!.some((glob) => matchGlob(p, glob)));
}

export function labelCiRedAfterMerge(input: CiInput): RunOutcomeLabel | undefined {
    if (!input.merge) return undefined;
    const { commitSha, mergedAt } = input.merge;
    const ends = windowEnd(mergedAt, LABEL_WINDOW_DAYS['ci-red-after-merge']);
    const first = input.ciRuns
        .filter((r) => r.commitSha === commitSha && (r.conclusion === 'success' || r.conclusion === 'failure'))
        .filter((r) => within(r.at, mergedAt, ends) && Date.parse(r.at) <= Date.parse(input.now))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
    if (first?.conclusion === 'failure') {
        const failing = (first.jobs ?? [{ name: '', conclusion: 'failure' }]).filter((j) => j.conclusion === 'failure');
        const touching = failing.filter((j) => jobTouches(j, input.changedPaths));
        if (failing.length === 0 || touching.length > 0) {
            return windowedLabel({
                kind: 'ci-red-after-merge', windowEndsAt: ends, now: input.now,
                event: { at: first.at, evidence: { commit: commitSha, jobs: touching.length || 1 } },
            });
        }
    }
    return windowedLabel({
        kind: 'ci-red-after-merge', windowEndsAt: ends, now: input.now,
        evidence: first ? { commit: commitSha, first: first.conclusion } : { commit: commitSha },
    });
}
