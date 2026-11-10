/**
 * engine/settlePending.ts — a phase-1 delta whose L3 analyzers will never report (PRD 41 §6 "Agent run": the editor
 * closed before phase 2 ran, and the prepared inputs are not kept across a restart) is SETTLED as the final delta, so a
 * card never stays "measuring" across restarts:
 *
 *  - every `pending` analyzer run becomes `failed` with the given reason (`interrupted`);
 *  - its dimension reason `analyzer-pending:<tool>` becomes `analyzer-not-measured:<tool>` (not measured, never zero
 *    findings — the pending tool never counted as having measured, so no verdict moves);
 *  - a blocking code `analyzer-pending:<tool>` becomes `not-comparable:<kind>` for each of that tool's kinds the
 *    delta's registry blocks on (fail-closed, as a tool that did not run);
 *  - the digest is recomputed over the result.
 * Pure. A delta with nothing pending is returned unchanged.
 */

import type { AnalyzerRule, RunDelta } from '../contract.js';
import { digestOf } from './digest.js';
import { sortedUnique } from './text.js';

const PENDING = 'analyzer-pending:';

export const hasPendingAnalyzers = (delta: RunDelta): boolean =>
    delta.dimensions.some((d) => d.measuredBy.some((m) => m.status === 'pending'));

export function settlePendingAnalyzers(delta: RunDelta, reason: string, rows: readonly AnalyzerRule[], blocking: readonly string[] = []): RunDelta {
    if (!hasPendingAnalyzers(delta)) return delta;
    const blocks = new Set(blocking);
    const dimensions = delta.dimensions.map((d) => ({
        ...d,
        measuredBy: d.measuredBy.map((m) => (m.status === 'pending' ? { tool: m.tool, version: m.version, status: 'failed' as const, reason, side: 'after' as const } : m)),
        reasons: sortedUnique(d.reasons.map((r) => (r.startsWith(PENDING) ? `analyzer-not-measured:${r.slice(PENDING.length)}` : r))),
    }));
    const kindsOf = (tool: string): string[] => Object.keys(rows.find((r) => r.tool === tool)?.kinds ?? {});
    const codes = sortedUnique(delta.blocking.flatMap((c) => {
        if (!c.startsWith(PENDING)) return [c];
        const kinds = kindsOf(c.slice(PENDING.length)).filter((k) => blocks.size === 0 || blocks.has(k));
        return kinds.length > 0 ? kinds.map((k) => `not-comparable:${k}`) : [`not-comparable:${c.slice(PENDING.length)}`];
    }));
    const { digest: _digest, narrative, ...rest } = delta;
    const body = { ...rest, dimensions, blocking: codes };
    return { ...body, ...(narrative ? { narrative } : {}), digest: digestOf(body) };
}
