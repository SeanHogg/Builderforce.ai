/** A deterministic, evenly spread sample of at most `n` items, in input order (never `Math.random`): item `floor(i * length / n)` for each `i`. */
export function strideSample<T>(items: readonly T[], n: number): T[] {
    if (n <= 0) return [];
    if (items.length <= n) return [...items];
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(items[Math.floor((i * items.length) / n)]!);
    return out;
}
