/**
 * knowledge/historyPort.ts — the OPTIONAL history port of a review (PRD 38, Option B+
 * Contract 1: the `churn` badge). A host that can read version history supplies it; one
 * that cannot (the browser, a Worker) omits it and the graph simply carries no churn.
 * Pure types: the Node implementation lives behind `./node-git-history`.
 */

/** Days of history the `churn` badge counts. */
export const CHURN_DAYS = 90;

export interface HistoryPort {
    /**
     * Commits that touched each of `paths` (root-relative) in the last `sinceDays` days.
     * A path with no commit is absent from the map. Must not throw: a failure is an empty map.
     */
    commitsTouching(paths: string[], sinceDays: number): Promise<Map<string, number>>;
}
