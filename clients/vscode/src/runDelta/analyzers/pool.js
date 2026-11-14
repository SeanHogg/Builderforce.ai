/** THE bounded-concurrency map of the run delta's analyzer tier: `fn` over `items` with at most `limit` in flight, results in input order. */
export async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    }));
    return out;
}
//# sourceMappingURL=pool.js.map