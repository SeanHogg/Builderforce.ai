/**
 * A numeric ascending sort of a Float64Array as idle steps: the array is cut into runs that are each sorted natively (one run
 * per step), then the runs are merged pairwise a bounded number of output values per step. The result is the array sorted IN
 * PLACE, equal to `values.sort()` (the values are plain numbers, so equal values are interchangeable). A single native sort of
 * 100k values blocks for ~70 ms; no step here is more than a few milliseconds.
 */

/** Values per natively-sorted run (one run per step). */
export const SORT_RUN = 16_384;
/** Values written per merge step. */
export const MERGE_BUDGET = 40_000;

export interface SortTask {
    /** Does one step of the sort; true once `values` is sorted. Safe to call again once done. */
    step(): boolean;
}

export function chunkedSort(values: Float64Array, run: number = SORT_RUN, budget: number = MERGE_BUDGET): SortTask {
    const n = values.length;
    let at = 0; // next run to sort
    let sortedRuns = false;
    let src = values;
    let dst: Float64Array | null = null;
    let width = run;
    // Merge cursor within the current round: the pair starting at `lo`, left `i..iEnd`, right `j..jEnd`, output `o`.
    let lo = 0, i = 0, iEnd = 0, j = 0, jEnd = 0, o = 0, inPair = false;
    let done = n <= 1;

    const sortRun = (): void => {
        values.subarray(at, Math.min(at + run, n)).sort();
        at += run;
        if (at >= n) sortedRuns = true;
    };

    const finishRound = (): boolean => {
        const swap = src; src = dst!; dst = swap;
        width *= 2;
        lo = 0;
        if (width < n) return false;
        if (src !== values) values.set(src);
        return true;
    };

    const mergeStep = (): boolean => {
        dst ??= new Float64Array(n);
        let made = 0;
        while (lo < n) {
            if (!inPair) { i = lo; iEnd = Math.min(lo + width, n); j = iEnd; jEnd = Math.min(lo + 2 * width, n); o = lo; inPair = true; }
            while (made < budget && (i < iEnd || j < jEnd)) {
                dst[o++] = j >= jEnd || (i < iEnd && src[i]! <= src[j]!) ? src[i++]! : src[j++]!;
                made++;
            }
            if (i < iEnd || j < jEnd) return false;
            inPair = false;
            lo += 2 * width;
        }
        return finishRound();
    };

    return {
        step() {
            if (done) return true;
            if (!sortedRuns) { sortRun(); done = sortedRuns && n <= run; } else done = mergeStep();
            return done;
        },
    };
}

/** How many steps {@link chunkedSort} takes for `n` values (what the perf harness labels). */
export function sortStepCount(n: number): number {
    const task = chunkedSort(new Float64Array(n));
    let steps = 1;
    while (!task.step()) steps++;
    return steps;
}
