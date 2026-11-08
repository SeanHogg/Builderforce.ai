/**
 * The measuring kit of the perf harness: `time` (a pure step, median of 3 runs + max) and `task` (an idle-step
 * task: total and the longest single step, since one step over 50 ms is what locks the screen), a sorted table
 * and its JSON. A step that throws is recorded with its error and returns undefined, so one unreachable step
 * never hides the rest.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNS = 3;
/** A single step over this holds the screen (one frame is ~16 ms; 50 ms is a long task). */
export const LOCK_MS = 50;

export interface StepRow {
    step: string;
    views: string;
    median: number;
    max: number;
    /** Idle-step tasks only: the longest single step over all runs, and how many steps there were. */
    longestStep: number | null;
    steps: number | null;
    inputs: string;
    error?: string;
    /** Idle-step tasks only: the slowest steps of the median run. */
    slowest?: Array<{ label: string; ms: number }>;
}

const ms = (n: number): number => Math.round(n * 100) / 100;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

export interface IdleTaskLike<T> { step(): boolean; result(): T }

export class Recorder {
    readonly rows: StepRow[] = [];

    /** A pure step: `fresh` (untimed) builds each run's argument, so a cache keyed on the input starts cold. */
    time<A, T>(step: string, views: string, inputs: string, fn: (a: A) => T, fresh?: () => A): T | undefined {
        const times: number[] = [];
        let out: T | undefined;
        try {
            for (let i = 0; i < RUNS; i++) {
                const arg = fresh ? fresh() : (undefined as A);
                const t0 = performance.now();
                out = fn(arg);
                times.push(performance.now() - t0);
            }
        } catch (error) {
            this.rows.push({ step, views, median: 0, max: 0, longestStep: null, steps: null, inputs, error: String((error as Error)?.message ?? error) });
            return undefined;
        }
        this.rows.push({ step, views, median: ms(median(times)), max: ms(Math.max(...times)), longestStep: null, steps: null, inputs });
        return out;
    }

    /** An idle-step task driven to completion: `make` (the work done in the task's start) counts as the first step. */
    task<T>(step: string, views: string, inputs: string, make: () => IdleTaskLike<T>, labels: readonly string[] = []): T | undefined {
        const runs: Array<{ total: number; steps: Array<{ label: string; ms: number }> }> = [];
        let out: T | undefined;
        try {
            for (let i = 0; i < RUNS; i++) {
                const steps: Array<{ label: string; ms: number }> = [];
                let t = performance.now();
                const task = make();
                steps.push({ label: 'start()', ms: performance.now() - t });
                for (let n = 0; ; n++) {
                    t = performance.now();
                    const done = task.step();
                    steps.push({ label: labels[n] ?? `step ${n + 1}`, ms: performance.now() - t });
                    if (done) break;
                }
                t = performance.now();
                out = task.result();
                steps.push({ label: 'result()', ms: performance.now() - t });
                runs.push({ total: steps.reduce((a, s) => a + s.ms, 0), steps });
            }
        } catch (error) {
            this.rows.push({ step, views, median: 0, max: 0, longestStep: null, steps: null, inputs, error: String((error as Error)?.message ?? error) });
            return undefined;
        }
        const totals = runs.map((r) => r.total);
        const mid = [...runs].sort((a, b) => a.total - b.total)[Math.floor(runs.length / 2)]!;
        const longest = Math.max(...runs.flatMap((r) => r.steps.map((s) => s.ms)));
        this.rows.push({
            step, views, median: ms(median(totals)), max: ms(Math.max(...totals)), longestStep: ms(longest), steps: mid.steps.length, inputs,
            slowest: [...mid.steps].sort((a, b) => b.ms - a.ms).slice(0, 5).map((s) => ({ label: s.label, ms: ms(s.ms) })),
        });
        return out;
    }

    /** The result of an earlier step, or a recorded skip: a step whose input never arrived says so instead of crashing. */
    need<T>(value: T | undefined, what: string): T {
        if (value === undefined) throw new Error(`skipped: ${what} is unavailable (its step failed)`);
        return value;
    }

    /** A step that cannot be reached at all, with the reason. */
    unreachable(step: string, views: string, reason: string): void {
        this.rows.push({ step, views, median: 0, max: 0, longestStep: null, steps: null, inputs: '', error: reason });
    }

    table(): string {
        const rows = [...this.rows].sort((a, b) => b.median - a.median);
        const head = ['step', 'views', 'median ms', 'max ms', 'longest step ms', 'inputs'];
        const body = rows.map((r) => [
            r.step, r.views, r.error ? 'ERR' : String(r.median), r.error ? '' : String(r.max),
            r.longestStep === null ? '' : `${r.longestStep}${r.longestStep > LOCK_MS ? ' (!)' : ''} /${r.steps}`, r.error ? `ERROR: ${r.error}` : r.inputs,
        ]);
        const width = head.map((h, c) => Math.max(h.length, ...body.map((b) => b[c]!.length)));
        const line = (cells: string[]): string => cells.map((c, i) => (i >= 2 && i <= 4 ? c.padStart(width[i]!) : c.padEnd(width[i]!))).join('  ');
        return [line(head), line(width.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
    }
}

export const LAST_RUN_JSON = path.join(path.dirname(fileURLToPath(import.meta.url)), 'last-run.json');

export function writeReport(payload: Record<string, unknown>): void {
    writeFileSync(LAST_RUN_JSON, `${JSON.stringify(payload, null, 2)}\n`);
}
