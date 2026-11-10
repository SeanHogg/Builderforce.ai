import { describe, expect, it } from 'vitest';
import type { CommitAttribution, RunOutcomeLabel } from '../contract.js';
import { labelCiRedAfterMerge } from './ci.js';
import { parseBlamePorcelain, parseLogPatch, parseRemovedLines, unquoteGitPath, type BlamedLine, type FileChange, type HistoryCommit, type RunCommits } from './history.js';
import { labelSupersedes, mergeLabels } from './merge.js';
import { labelReverted, revertedShas } from './revert.js';
import { labelFindingAction, labelReviewRejected } from './review.js';
import { isFixMessage, labelFollowupFix } from './szz.js';
import { finalizeCensored } from './window.js';

const RUN_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const FINALIZED = '2026-11-01T00:00:00.000Z';
const day = (n: number): string => new Date(Date.parse(FINALIZED) + n * 86_400_000).toISOString();

const attribution: CommitAttribution[] = [
    { commitSha: RUN_SHA, path: 'src/pay.ts', addedLines: 4, committedAt: FINALIZED, source: 'vscode-git' },
];
const run: RunCommits = { runId: 'run-1', finalizedAt: FINALIZED, attribution };

/** The file after the run (lines 1-4 are the run's; line 5 is a comment the run also wrote). */
const PARENT = [
    'export function total(a: number, b: number) {',
    '  const sum = a - b;',
    '  return sum;',
    '}',
    '// totals the cart',
].join('\n');

const blameAll = (sha: string): Map<number, BlamedLine> =>
    new Map([1, 2, 3, 4, 5].map((n) => [n, { sha, path: 'src/pay.ts' }] as const));

const change = (over: Partial<FileChange>): FileChange => ({
    path: 'src/pay.ts', parentText: PARENT, childText: PARENT, removedLines: [], blame: blameAll(RUN_SHA), ...over,
});

const commit = (over: Partial<HistoryCommit>): HistoryCommit => ({ sha: 'c'.repeat(40), at: day(3), message: 'fix: wrong sum', changes: [], ...over });

describe('SZZ followup-fix (PRD 41 §D1)', () => {
    it('labels the fix-inducing run when a later fix modifies its lines', () => {
        const fixed = PARENT.replace('a - b', 'a + b');
        const label = labelFollowupFix({ run, now: day(40), history: [commit({ changes: [change({ childText: fixed, removedLines: [2] })] })] });
        expect(label).toMatchObject({ kind: 'followup-fix', value: true, status: 'final', eventAt: day(3) });
        expect(label.evidence).toMatchObject({ commit: 'c'.repeat(40), lines: 1 });
    });

    it('does not label a comment-only later edit, even with a fix message', () => {
        const recommented = PARENT.replace('// totals the cart', '// totals the whole cart (fixed typo)');
        const label = labelFollowupFix({ run, now: day(40), history: [commit({ changes: [change({ childText: recommented, removedLines: [5] })] })] });
        expect(label).toMatchObject({ value: false, status: 'final' });
    });

    it('ignores a comment line inside an otherwise real change', () => {
        const both = PARENT.replace('// totals the cart', '// sum').replace('return sum;', 'return sum * 1;');
        const label = labelFollowupFix({ run, now: day(40), history: [commit({ changes: [change({ childText: both, removedLines: [5] })] })] });
        expect(label.value).toBe(false);
    });

    it('does not blame the run for lines another commit wrote', () => {
        const fixed = PARENT.replace('a - b', 'a + b');
        const label = labelFollowupFix({ run, now: day(40), history: [commit({ changes: [change({ childText: fixed, removedLines: [2], blame: blameAll(OTHER_SHA) })] })] });
        expect(label.value).toBe(false);
    });

    it('needs a fix: a refactor message does not label, a fix-with-agent run does', () => {
        const fixed = PARENT.replace('a - b', 'a + b');
        const changes = [change({ childText: fixed, removedLines: [2] })];
        expect(labelFollowupFix({ run, now: day(40), history: [commit({ message: 'refactor totals', changes })] }).value).toBe(false);
        expect(labelFollowupFix({ run, now: day(40), history: [commit({ message: 'refactor totals', fix: 'fix-with-agent', changes })] }).value).toBe(true);
    });

    it('is right-censored before the 30-day window ends: null, never false', () => {
        expect(labelFollowupFix({ run, now: day(10), history: [] })).toMatchObject({ value: null, status: 'censored', windowEndsAt: day(30) });
        const fixed = PARENT.replace('a - b', 'a + b');
        const early = labelFollowupFix({ run, now: day(10), history: [commit({ changes: [change({ childText: fixed, removedLines: [2] })] })] });
        expect(early).toMatchObject({ value: true, status: 'censored', eventAt: day(3) });
    });

    it('ignores a fix after the window and one not yet happened at `now`', () => {
        const fixed = PARENT.replace('a - b', 'a + b');
        const changes = [change({ childText: fixed, removedLines: [2] })];
        expect(labelFollowupFix({ run, now: day(60), history: [commit({ at: day(31), changes })] }).value).toBe(false);
        expect(labelFollowupFix({ run, now: day(2), history: [commit({ at: day(3), changes })] }).value).toBeNull();
    });

    it('reads fix messages from the subject', () => {
        expect(isFixMessage('fix(api): null check')).toBe(true);
        expect(isFixMessage('Hotfix the crash on save')).toBe(true);
        expect(isFixMessage('Add a prefix option\n\nfixes nothing')).toBe(false);
    });
});

describe('reverted', () => {
    it('labels a git revert of the run commit', () => {
        const label = labelReverted({ run, now: day(40), history: [commit({ message: `Revert "x"\n\nThis reverts commit ${RUN_SHA.slice(0, 12)}.` })] });
        expect(label).toMatchObject({ value: true, status: 'final', evidence: { rule: 'message-revert' } });
        expect(revertedShas(`This reverts commit ${RUN_SHA}.`)).toEqual([RUN_SHA]);
    });

    it('labels when more than half of the added lines are deleted, not at exactly half', () => {
        // The child really lacks the removed lines (a change whose two sides are equal is cosmetic and deletes nothing).
        const without = (n: number): string => PARENT.split('\n').slice(n).join('\n');
        const two = labelReverted({ run, now: day(40), history: [commit({ message: 'tidy', changes: [change({ childText: without(2), removedLines: [1, 2] })] })] });
        expect(two.value).toBe(false);
        const three = labelReverted({ run, now: day(40), history: [commit({ message: 'tidy', changes: [change({ childText: without(3), removedLines: [1, 2, 3] })] })] });
        expect(three).toMatchObject({ value: true, evidence: { rule: 'lines-deleted', deleted: 3, added: 4 } });
    });
});

describe('ci-red-after-merge', () => {
    const merge = { commitSha: 'm'.repeat(40), mergedAt: FINALIZED };
    it('is undefined until merged', () => {
        expect(labelCiRedAfterMerge({ ciRuns: [], changedPaths: [], now: day(1) })).toBeUndefined();
    });
    it('labels the first CI run failing in a job touching the changed area, within 7 days', () => {
        const label = labelCiRedAfterMerge({
            merge, changedPaths: ['src/pay.ts'], now: day(8),
            ciRuns: [{ commitSha: merge.commitSha, at: day(1), conclusion: 'failure', jobs: [{ name: 'api', conclusion: 'failure', paths: ['src/**'] }] }],
        });
        expect(label).toMatchObject({ kind: 'ci-red-after-merge', value: true, status: 'final', eventAt: day(1) });
    });
    it('does not label a failure in a job outside the area, or a failure after a green first run', () => {
        const outside = labelCiRedAfterMerge({
            merge, changedPaths: ['src/pay.ts'], now: day(8),
            ciRuns: [{ commitSha: merge.commitSha, at: day(1), conclusion: 'failure', jobs: [{ name: 'docs', conclusion: 'failure', paths: ['docs/**'] }] }],
        });
        expect(outside?.value).toBe(false);
        const green = labelCiRedAfterMerge({
            merge, changedPaths: ['src/pay.ts'], now: day(8),
            ciRuns: [
                { commitSha: merge.commitSha, at: day(1), conclusion: 'success' },
                { commitSha: merge.commitSha, at: day(2), conclusion: 'failure' },
            ],
        });
        expect(green?.value).toBe(false);
    });
    it('is censored inside the 7-day window and ignores a failure after it', () => {
        expect(labelCiRedAfterMerge({ merge, changedPaths: [], now: day(3), ciRuns: [] })).toMatchObject({ value: null, status: 'censored', windowEndsAt: day(7) });
        const late = labelCiRedAfterMerge({ merge, changedPaths: [], now: day(10), ciRuns: [{ commitSha: merge.commitSha, at: day(8), conclusion: 'failure' }] });
        expect(late).toMatchObject({ value: false, status: 'final' });
    });
});

describe('review and panel actions', () => {
    it('labels a changes-requested review; open-ended until the PR closes', () => {
        const open = labelReviewRejected({ pr: { number: 7 }, reviews: [{ state: 'changes_requested', at: day(1) }], now: day(2) });
        expect(open).toMatchObject({ value: true, status: 'censored' });
        expect(open?.windowEndsAt).toBeUndefined();
        const closed = labelReviewRejected({ pr: { number: 7, closedAt: day(3) }, reviews: [{ state: 'approved', at: day(1) }], now: day(4) });
        expect(closed).toMatchObject({ value: false, status: 'final' });
        expect(labelReviewRejected({ reviews: [], now: day(1) })).toBeUndefined();
    });
    it('a panel action is final at once', () => {
        expect(labelFindingAction('finding-marked-wrong', day(1), { ruleId: 'io-in-loop', lineage: 'x' })).toMatchObject({ value: true, status: 'final' });
    });
});

describe('censoring and precedence', () => {
    const censored: RunOutcomeLabel = { kind: 'reverted', value: null, status: 'censored', windowEndsAt: day(30), evidence: {}, labellerVersion: 1, computedAt: day(1) };
    it('finalizes a censored label to false only once its window ended', () => {
        expect(finalizeCensored(censored, day(29))).toBe(censored);
        expect(finalizeCensored(censored, day(30))).toMatchObject({ value: false, status: 'final', computedAt: day(30) });
        expect(finalizeCensored({ ...censored, value: true, eventAt: day(2) }, day(31))).toMatchObject({ value: true, status: 'final' });
    });
    it('never lets a censored label replace a final one', () => {
        const final = { ...censored, value: false, status: 'final' as const, computedAt: day(30) };
        expect(labelSupersedes(final, { ...censored, computedAt: day(40) })).toBe(false);
        expect(labelSupersedes(censored, final)).toBe(true);
        expect(mergeLabels([final], [{ ...censored, computedAt: day(40) }])).toEqual([final]);
    });
    it('regression (H1): an observed event is never overwritten by a later "no event" label', () => {
        const observed: RunOutcomeLabel = { ...censored, value: true, eventAt: day(3), evidence: { commit: 'x' }, computedAt: day(4) };
        // A later pass whose history missed the event (a shorter or rewritten history) says null, then false.
        expect(labelSupersedes(observed, { ...censored, computedAt: day(10) })).toBe(false);
        expect(mergeLabels([observed], [{ ...censored, computedAt: day(10) }])).toEqual([observed]);
        const closing: RunOutcomeLabel = { ...censored, value: false, status: 'final', evidence: {}, computedAt: day(31) };
        expect(mergeLabels([observed], [closing])).toEqual([{ ...closing, value: true, eventAt: day(3), evidence: { commit: 'x' } }]);
    });
});

describe('side-branch fixes (M-B: history is read without --first-parent)', () => {
    it('labels a fix made on a side branch; the merge that brings it in is never the fix', () => {
        const FIX = 'f'.repeat(40);
        const MERGE = 'e'.repeat(40);
        // `git log -p -U0` newest first: the merge (two parents, no diff), then the branch's fix commit.
        const out = [
            `\u001e${MERGE}\u001f${day(5)}\u001f${'1'.repeat(40)} ${FIX}\u001fMerge branch 'fix-sum'\u001e`,
            `\u001e${FIX}\u001f${day(4)}\u001f${RUN_SHA}\u001ffix: wrong sum\u001e`,
            'diff --git a/src/pay.ts b/src/pay.ts', '--- a/src/pay.ts', '+++ b/src/pay.ts', '@@ -2 +2 @@', '-  const sum = a - b;', '+  const sum = a + b;',
        ].join('\n');
        const history: HistoryCommit[] = parseLogPatch(out).reverse().map((c) => ({
            sha: c.sha, at: c.at, message: c.message, ...(c.merge ? { merge: true } : {}),
            changes: [...c.removed].map(([path, removedLines]) => change({ path, removedLines, childText: PARENT.replace('a - b', 'a + b') })),
        }));
        expect(history.map((c) => [c.sha, c.merge ?? false])).toEqual([[FIX, false], [MERGE, true]]);
        const label = labelFollowupFix({ run, now: day(40), history });
        expect(label).toMatchObject({ value: true, eventAt: day(4), evidence: { commit: FIX } });
    });
});

describe('merge commits (M5)', () => {
    it('a merge is never a fix and its changes never count as deletions', () => {
        const fixed = PARENT.replace('a - b', 'a + b');
        const merge = commit({ message: 'Merge branch fix-sum', merge: true, changes: [change({ childText: fixed, removedLines: [1, 2, 3, 4] })] });
        expect(labelFollowupFix({ run, now: day(40), history: [merge] }).value).toBe(false);
        expect(labelReverted({ run, now: day(40), history: [merge] }).value).toBe(false);
    });
    it('a cosmetic change deletes no facts for the revert rule', () => {
        const recommented = PARENT.replace('// totals the cart', '// totals');
        expect(labelReverted({ run, now: day(40), history: [commit({ message: 'tidy', changes: [change({ childText: recommented, removedLines: [1, 2, 3, 5] })] })] }).value).toBe(false);
    });
});

describe('git output parsers', () => {
    it('reads removed parent lines from a -U0 diff', () => {
        const diff = [
            'diff --git a/src/pay.ts b/src/pay.ts', '--- a/src/pay.ts', '+++ b/src/pay.ts', '@@ -2 +2 @@', '-x', '+y', '@@ -7,2 +6,0 @@',
            'diff --git a/new.ts b/new.ts', '--- /dev/null', '+++ b/new.ts', '@@ -0,0 +1 @@',
        ].join('\n');
        expect([...parseRemovedLines(diff)]).toEqual([['src/pay.ts', [2, 7, 8]]]);
    });
    it('regression (H3): a removed "-- note" SQL comment is a removed line, not a file header', () => {
        const diff = [
            'diff --git a/db/0001.sql b/db/0001.sql', '--- a/db/0001.sql', '+++ b/db/0001.sql',
            '@@ -3,2 +3 @@', '--- note: drop later', '-DROP TABLE x;', '+DROP TABLE y;',
        ].join('\n');
        expect([...parseRemovedLines(diff)]).toEqual([['db/0001.sql', [3, 4]]]);
    });
    it('reads a quoted path and a whole log -p stream with merges', () => {
        const out = [
            `\u001e${'c'.repeat(40)}\u001f${day(1)}\u001f${'p'.repeat(40)}\u001ffix: x\u001e`,
            'diff --git "a/src/caf\\303\\251.ts" "b/src/caf\\303\\251.ts"', '--- "a/src/caf\\303\\251.ts"', '+++ "b/src/caf\\303\\251.ts"', '@@ -1 +1 @@', '-a', '+b',
            `\u001e${'d'.repeat(40)}\u001f${day(2)}\u001f${'p'.repeat(40)} ${'q'.repeat(40)}\u001fMerge\u001e`,
        ].join('\n');
        const commits = parseLogPatch(out);
        expect(commits.map((c) => [c.message, c.merge, [...c.removed]])).toEqual([
            ['fix: x', false, [['src/café.ts', [1]]]],
            ['Merge', true, []],
        ]);
        expect(unquoteGitPath('"a/x\\ty"')).toBe('x\ty');
    });
    it('reads blame porcelain, reusing a commit filename', () => {
        const out = [`${RUN_SHA} 1 1 2`, 'author x', 'filename src/old.ts', '\tline1', `${RUN_SHA} 2 2`, '\tline2'].join('\n');
        expect([...parseBlamePorcelain(out, 'src/pay.ts')]).toEqual([
            [1, { sha: RUN_SHA, path: 'src/old.ts' }],
            [2, { sha: RUN_SHA, path: 'src/old.ts' }],
        ]);
    });
    it('reads SHA-256 object names in blame porcelain', () => {
        const sha256 = 'e'.repeat(64);
        expect([...parseBlamePorcelain([`${sha256} 1 1 1`, '\tline'].join('\n'), 'a/b.ts')]).toEqual([[1, { sha: sha256, path: 'a/b.ts' }]]);
    });
});
