/**
 * predict/labels/revert.ts — the `reverted` label (PRD 41 §D1): inside 30 days after the run, a later commit reverts one
 * of the run's commits (git's `This reverts commit <sha>` trailer), or later commits delete more than half of the lines
 * the run added (blamed to the run's attributed commits). Pure.
 */

import { LABEL_WINDOW_DAYS, type RunOutcomeLabel } from '../contract.js';
import { runCommitIndex, type HistoryCommit, type RunCommits } from './history.js';
import { runLinesTouched } from './szz.js';
import { windowEnd, windowedLabel, within } from './window.js';

const REVERT_TRAILER = /This reverts commit ([0-9a-f]{7,64})/gi;

/** The shas a commit message says it reverts. */
export function revertedShas(message: string): string[] {
    return [...message.matchAll(REVERT_TRAILER)].map((m) => m[1]!.toLowerCase());
}

/** Share of the run's added lines that must be deleted for `reverted`. */
export const REVERT_DELETED_SHARE = 0.5;

export interface RevertInput {
    run: RunCommits;
    history: readonly HistoryCommit[];
    now: string;
}

export function labelReverted(input: RevertInput): RunOutcomeLabel {
    const index = runCommitIndex(input.run);
    const ends = windowEnd(input.run.finalizedAt, LABEL_WINDOW_DAYS.reverted);
    const added = input.run.attribution.reduce((n, a) => n + (a.addedLines ?? 0), 0);
    const later = [...input.history]
        .filter((c) => !index.shas.has(c.sha) && within(c.at, input.run.finalizedAt, ends) && Date.parse(c.at) <= Date.parse(input.now))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.sha.localeCompare(b.sha));
    let deleted = 0;
    for (const commit of later) {
        const named = revertedShas(commit.message).find((sha) => [...index.shas].some((own) => own.toLowerCase().startsWith(sha)));
        if (named) {
            return windowedLabel({ kind: 'reverted', windowEndsAt: ends, now: input.now, event: { at: commit.at, evidence: { commit: commit.sha, reverts: named, rule: 'message-revert' } } });
        }
        // A merge's changes are its branch's commits, counted on their own; a cosmetic change deletes no facts.
        if (!commit.merge) {
            for (const change of commit.changes) deleted += runLinesTouched(change, index, { commentLines: true });
        }
        if (added > 0 && deleted > added * REVERT_DELETED_SHARE) {
            return windowedLabel({ kind: 'reverted', windowEndsAt: ends, now: input.now, event: { at: commit.at, evidence: { commit: commit.sha, deleted, added, rule: 'lines-deleted' } } });
        }
    }
    return windowedLabel({ kind: 'reverted', windowEndsAt: ends, now: input.now });
}
