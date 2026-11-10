/**
 * predict/labels/szz.ts — the `followup-fix` label by SZZ (Śliwerski, Zimmermann, Zeller; PRD 41 §D1):
 *
 *   1. For each later FIX commit inside the window, take the lines it modifies or deletes at its parent, with blame.
 *   2. A fix is a bug-type ticket or a run started from a delta finding's "Fix with agent" (the host sets
 *      `HistoryCommit.fix`), or a commit message matching the fix registry ({@link isFixMessage}).
 *   3. Cosmetic lines are ignored (B1 early cutoff): a file whose code with comments blanked and whitespace collapsed is
 *      the same on both sides changed no facts, so none of its lines count; nor does a parent line that is only a
 *      comment or blank.
 *   4. A blamed line is the run's when its commit and path are attributed to the run (`CommitAttribution`).
 *
 * The run's own commits never label the run. Pure: git history is input data, `now` is an input.
 */

import { codeLanguageOf, maskSource } from '@builderforce/agent-tools/code-mask';
import { LABEL_WINDOW_DAYS, type RunOutcomeLabel } from '../contract.js';
import { blamedToRun, runCommitIndex, type FileChange, type HistoryCommit, type RunCommits } from './history.js';
import { windowEnd, windowedLabel, within } from './window.js';

/** The fix registry's message rule: a conventional `fix:`/`fix(…)`, or a fix/bug/hotfix/regression word. */
export const FIX_MESSAGE_PATTERNS: readonly RegExp[] = [
    /^(fix|hotfix|bugfix)(\(.+\))?!?:/i,
    /\b(fix(e[sd])?|bug(fix)?|hotfix|regression|broke(n)?|crash(es|ed)?)\b/i,
];

export const isFixMessage = (message: string): boolean => {
    const subject = message.split('\n')[0] ?? '';
    return FIX_MESSAGE_PATTERNS.some((p) => p.test(subject));
};

/** A merge is never a fix (its changes are the merged branch's, already seen on their own commits). */
export const isFixCommit = (commit: HistoryCommit): boolean =>
    !commit.merge && (commit.fix !== undefined || isFixMessage(commit.message));

const codeLines = (path: string, text: string): string[] =>
    maskSource(text, codeLanguageOf(path)).code.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());

const stripped = (lines: readonly string[]): string => lines.filter((l) => l !== '').join('\n');

/** One change, masked ONCE: whether it is cosmetic, and the parent's code lines (comments blanked). */
export interface MaskedChange {
    cosmetic: boolean;
    parentCode?: string[];
}

export function maskChange(change: Pick<FileChange, 'path' | 'parentText' | 'childText'>): MaskedChange {
    const parentCode = change.parentText === undefined ? undefined : codeLines(change.path, change.parentText);
    if (parentCode === undefined || change.childText === undefined) return { cosmetic: false, ...(parentCode ? { parentCode } : {}) };
    return { cosmetic: stripped(parentCode) === stripped(codeLines(change.path, change.childText)), parentCode };
}

/** Whether a file change altered no facts: its code (comments blanked, whitespace collapsed) is equal on both sides. */
export const isCosmeticChange = (change: Pick<FileChange, 'path' | 'parentText' | 'childText'>): boolean => maskChange(change).cosmetic;

/**
 * The run's parent lines a change removes or modifies: blamed to the run, none in a cosmetic change, and — unless
 * `commentLines` — not a comment-only or blank line at the parent.
 */
export function runLinesTouched(
    change: FileChange, index: ReturnType<typeof runCommitIndex>, opts: { commentLines?: boolean } = {},
): number {
    const masked = maskChange(change);
    if (masked.cosmetic) return 0;
    let count = 0;
    for (const line of change.removedLines) {
        const blamed = change.blame.get(line);
        if (!blamed || !blamedToRun(index, blamed)) continue;
        if (!opts.commentLines && masked.parentCode && (masked.parentCode[line - 1] ?? '') === '') continue;
        count++;
    }
    return count;
}

export interface SzzInput {
    run: RunCommits;
    /** Commits after the run, any order. */
    history: readonly HistoryCommit[];
    now: string;
}

/** The run's `followup-fix` label at `now`. */
export function labelFollowupFix(input: SzzInput): RunOutcomeLabel {
    const index = runCommitIndex(input.run);
    const ends = windowEnd(input.run.finalizedAt, LABEL_WINDOW_DAYS['followup-fix']);
    const fixes = [...input.history]
        .filter((c) => !index.shas.has(c.sha) && within(c.at, input.run.finalizedAt, ends) && Date.parse(c.at) <= Date.parse(input.now))
        .filter(isFixCommit)
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.sha.localeCompare(b.sha));
    for (const fix of fixes) {
        const lines = fix.changes.reduce((n, change) => n + runLinesTouched(change, index), 0);
        if (lines === 0) continue;
        return windowedLabel({
            kind: 'followup-fix', windowEndsAt: ends, now: input.now,
            event: { at: fix.at, evidence: { commit: fix.sha, lines, rule: fix.fix ?? 'message' } },
        });
    }
    return windowedLabel({ kind: 'followup-fix', windowEndsAt: ends, now: input.now });
}
