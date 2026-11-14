/**
 * run-delta/summary.ts — the compact, storable projection of a {@link RunDelta} (PRD 41 §C14).
 *
 * The summary is what a history list renders (one row per run × repo) and what the server indexes;
 * the full delta rides along only on {@link StoredRunDelta}. Pure: the caller supplies `computedAt`.
 */
export function summarizeRunDelta(delta, meta) {
    const verdicts = {};
    let introduced = 0;
    let resolved = 0;
    for (const d of delta.dimensions) {
        verdicts[d.id] = d.verdict;
        for (const f of d.findings) {
            if (f.lineage === 'introduced')
                introduced += 1;
            else if (f.lineage === 'resolved')
                resolved += 1;
        }
    }
    return {
        runId: delta.runId,
        repoKey: meta.repoKey,
        surface: meta.surface,
        mode: meta.mode,
        computedAt: meta.computedAt,
        headline: delta.headline,
        summary: delta.summary,
        verdicts,
        counts: { introduced, resolved },
        blastRadius: { score: delta.blastRadius.score, band: delta.blastRadius.band },
        blocking: [...delta.blocking],
        digest: delta.digest,
    };
}
//# sourceMappingURL=summary.js.map