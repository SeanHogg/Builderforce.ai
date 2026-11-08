/**
 * knowledge/analysisProgress.ts — the counter behind the code pack's analyse-phase progress.
 *
 * The units of work are the repo-graph file reads plus one unit per analyzer tool. The total is
 * only known once the file listing is, so nothing is reported before {@link AnalysisProgress.plan}
 * (a tool that settles first is counted and reported with the first report). `done` only grows and
 * never passes `total`; {@link AnalysisProgress.finish} brings the run to `done === total`.
 */

import type { AnalyzerProgress } from '@seanhogg/builderforce-memory/knowledge';
import { ANALYZERS } from '../codeAnalysisTool.js';

export interface AnalysisProgress {
    /** The listing is known: `files` will be read, plus the analyzer tools. Idempotent (the first call wins). */
    plan(files: number): void;
    /** `count` more files were read; `path` is the last of them. */
    filesRead(count: number, path?: string): void;
    /** One analyzer tool settled (complete, failed or not measured). */
    toolSettled(): void;
    /** The run is over: everything is counted done. */
    finish(): void;
}

export function createAnalysisProgress(onProgress?: (p: AnalyzerProgress) => void): AnalysisProgress {
    let done = 0;
    let total = 0;
    let planned = false;
    const emit = (path?: string): void => {
        if (!planned || !onProgress) return;
        onProgress({ done: Math.min(done, total), total, ...(path ? { path } : {}) });
    };
    return {
        plan(files) {
            if (planned) return;
            planned = true;
            total = files + ANALYZERS.length;
            emit();
        },
        filesRead(count, path) { done += count; emit(path); },
        toolSettled() { done += 1; emit(); },
        finish() {
            if (!planned) { planned = true; total = ANALYZERS.length; }
            done = total;
            emit();
        },
    };
}
