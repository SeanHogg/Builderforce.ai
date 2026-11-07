/**
 * The last review run as lines of the copied diagnostics (PRD 41 A8). PURE and English on purpose,
 * like the rest of the diagnostics: it is read by whoever triages the report. Equal input, equal text.
 */

import type { StoredReviewRun } from '../../types';
import { awaitingJudgeCount, failureCountOf, phaseRows, runDurationMs, slowestOf } from './runModel';

export function runDiagnosticLines(run: StoredReviewRun): string[] {
    const byPhase = new Map(run.phases.map((p) => [p.phase, p]));
    const phases = phaseRows(run).map((row) => {
        const p = byPhase.get(row.phase)!;
        const ms = (p.endedAt ?? run.endedAt ?? run.updatedAt) - p.startedAt;
        return `${row.phase} ${row.done}/${row.total} ${Math.max(0, ms)}ms`;
    });
    const slowest = slowestOf(run).map((s) => {
        const parts = s.parts ? ` read=${s.parts.readMs ?? 'n/a'}ms lookup=${s.parts.lookupMs ?? 'n/a'}ms pool=${s.parts.poolMs ?? 'n/a'}ms` : '';
        return `${s.path} ${s.phase} ${Math.round(s.ms)}ms ${s.outcome}${s.reason ? ` (${s.reason})` : ''}${parts}`;
    });
    return [
        `last run: id=${run.id} kind=${run.kind} outcome=${run.outcome ?? 'running'} duration=${runDurationMs(run)}ms`,
        `run phases: ${phases.join(' · ') || 'none'}`,
        `awaiting judge: ${awaitingJudgeCount(run)}`,
        `slowest steps: ${slowest.join(' | ') || 'none'}`,
        `run errors: extractErrors=${run.report?.extractErrors ?? 'n/a'} failures=${failureCountOf(run)}`,
        `extraction pool: ${run.poolDown ? `down (${run.poolDown}); extracted on one thread` : 'parallel, or the review default'}`,
    ];
}
