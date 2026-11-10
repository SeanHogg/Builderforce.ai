/**
 * knowledge/historyPort.ts — the OPTIONAL history port of a review (PRD 38, Option B+
 * Contract 1: the `churn` badge; P4: the `coChange` badge). A host that can read version
 * history supplies it; one that cannot (the browser, a Worker) omits it and the graph simply
 * carries no churn and no co-change. Pure: the Node implementation lives behind `./node-git-history`.
 *
 * ONE read of the history serves both badges: the port returns the root's commits with the
 * files each touched, and churn is counted from that list ({@link churnOf}), never from a
 * second `git log`. A port that fills its commit cap inside churn's window says so ({@link churnCapWarning}).
 */

import { COCHANGE_MAX_COMMITS } from '@seanhogg/builderforce-memory/knowledge';

/** Days of history the `churn` badge counts. */
export const CHURN_DAYS = 90;
/** Days of history a review reads (co-change association needs more than churn's window). */
export const HISTORY_DAYS = 365;
/** At most this many (newest) commits a review reads: all co-change counts. */
export const HISTORY_MAX_COMMITS = COCHANGE_MAX_COMMITS;

const DAY_MS = 86_400_000;

/** One commit touching the root. */
export interface HistoryCommit {
    /** ISO committer time (`%cI`). */
    at: string;
    /** Root-relative paths of the files it touched inside the root, distinct, `/`-separated. */
    paths: string[];
    /** Files the commit touched in the WHOLE repository (before any root filter): the bulk-change cut reads it. */
    fileCount: number;
}

export interface HistoryPort {
    /**
     * The commits touching the root in the last `sinceDays` days, newest first, at most
     * `maxCommits`. Must not throw: a failure is an empty list.
     */
    commits(sinceDays: number, maxCommits: number): Promise<HistoryCommit[]>;
}

/**
 * The warning a capped history earns: when `commits` (newest first) filled `maxCommits` and even the oldest of them is
 * inside churn's window, older commits in that window were cut, so churn is a lower bound. Undefined otherwise. Pure.
 */
export function churnCapWarning(commits: readonly HistoryCommit[], maxCommits: number, sinceDays: number = CHURN_DAYS, now: number = Date.now()): string | undefined {
    if (commits.length === 0 || commits.length < maxCommits) return undefined;
    const oldest = Date.parse(commits[commits.length - 1]!.at);
    if (!Number.isFinite(oldest) || oldest < now - sinceDays * DAY_MS) return undefined;
    return `git history hit the ${maxCommits}-commit cap inside the last ${sinceDays} days: churn is a lower bound, not the full count.`;
}

/**
 * Commits per path in the last `sinceDays` days before `now`, for `paths` only (a path with
 * no commit is absent). A commit whose time does not parse counts (git already bounded the
 * window it was read in). Pure.
 */
export function churnOf(commits: readonly HistoryCommit[], paths: Iterable<string>, sinceDays: number = CHURN_DAYS, now: number = Date.now()): Map<string, number> {
    const wanted = new Set(paths);
    const cutoff = now - sinceDays * DAY_MS;
    const counts = new Map<string, number>();
    for (const c of commits) {
        const t = Date.parse(c.at);
        if (Number.isFinite(t) && t < cutoff) continue;
        for (const path of new Set(c.paths)) {
            if (wanted.has(path)) counts.set(path, (counts.get(path) ?? 0) + 1);
        }
    }
    return counts;
}
