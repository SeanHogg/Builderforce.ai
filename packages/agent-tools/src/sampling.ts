/**
 * sampling.ts — THE deterministic sampler: at most `n` items spread evenly across a list, in input order (never
 * `Math.random`). One rule for every caller that judges a long list by a bounded sample — the knowledge view's edge and
 * spring budgets, the system-copy test, and run-delta naturalness's baseline and scored lines. Pure.
 */

/** Item `floor(i * length / n)` for each `i < n`; every item when the list is no longer than `n`; none when `n <= 0`. */
export function strideSample<T>(items: readonly T[], n: number): T[] {
    if (n <= 0) return [];
    if (items.length <= n) return [...items];
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(items[Math.floor((i * items.length) / n)]!);
    return out;
}
