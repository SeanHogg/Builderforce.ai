/**
 * run-delta/summary.ts — the compact, storable projection of a {@link RunDelta} (PRD 41 §C14).
 *
 * The summary is what a history list renders (one row per run × repo) and what the server indexes;
 * the full delta rides along only on {@link StoredRunDelta}. Pure: the caller supplies `computedAt`.
 */

import type { DimensionId, HeadlineModel, RunDelta, Verdict } from './contract.js';

/** Where the delta was computed. */
export type RunDeltaSurface = 'vscode' | 'cloud' | 'web';

export interface RunDeltaSummary {
    runId: string;
    repoKey: string;
    surface: RunDeltaSurface;
    mode: 'interactive' | 'autonomous';
    /** ISO-8601. */
    computedAt: string;
    headline: Verdict;
    summary: HeadlineModel;
    verdicts: Partial<Record<DimensionId, Verdict>>;
    /** Findings whose lineage is exactly `introduced` / `resolved`, across every dimension. */
    counts: { introduced: number; resolved: number };
    blastRadius: { score: number; band: 'low' | 'medium' | 'high' };
    blocking: string[];
    digest: string;
}

export interface StoredRunDelta extends RunDeltaSummary {
    delta: RunDelta;
}

export function summarizeRunDelta(
    delta: RunDelta,
    meta: { repoKey: string; surface: RunDeltaSurface; mode: 'interactive' | 'autonomous'; computedAt: string },
): RunDeltaSummary {
    const verdicts: Partial<Record<DimensionId, Verdict>> = {};
    let introduced = 0;
    let resolved = 0;
    for (const d of delta.dimensions) {
        verdicts[d.id] = d.verdict;
        for (const f of d.findings) {
            if (f.lineage === 'introduced') introduced += 1;
            else if (f.lineage === 'resolved') resolved += 1;
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
