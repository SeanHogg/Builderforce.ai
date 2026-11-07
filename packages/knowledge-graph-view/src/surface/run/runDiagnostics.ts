/**
 * The last review run as lines of the copied diagnostics (PRD 41 A8). PURE and English on purpose,
 * like the rest of the diagnostics: it is read by whoever triages the report. Equal input, equal text.
 */

import type { StoredReviewRun } from '../../types';
import { failureCountOf, phaseRows, runDurationMs } from './runModel';

export function runDiagnosticLines(run: StoredReviewRun): string[] {
    const byPhase = new Map(run.phases.map((p) => [p.phase, p]));
    const phases = phaseRows(run).map((row) => {
        const p = byPhase.get(row.phase)!;
        const ms = (p.endedAt ?? run.endedAt ?? run.updatedAt) - p.startedAt;
        return `${row.phase} ${row.done}/${row.total} ${Math.max(0, ms)}ms`;
    });
    return [
        `last run: id=${run.id} kind=${run.kind} outcome=${run.outcome ?? 'running'} duration=${runDurationMs(run)}ms`,
        `run phases: ${phases.join(' · ') || 'none'}`,
        `run errors: extractErrors=${run.report?.extractErrors ?? 'n/a'} failures=${failureCountOf(run)}`,
        `extraction pool: ${run.poolDown ? `down (${run.poolDown}); extracted on one thread` : 'parallel, or the review default'}`,
    ];
}
