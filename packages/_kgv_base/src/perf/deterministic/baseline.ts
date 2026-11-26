/// <reference types="node" />
/**
 * The ratchet. Deterministic work counts are exact, so the committed baseline is compared EXACTLY: every metric is
 * lower-is-better and any increase is a regression (no tolerance band to hide a creeping cost). A decrease is reported as an
 * improvement so the baseline can be re-recorded (`KG_PERF_UPDATE=1`) and the gain locked in.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Flat ids such as `view:graph2d:main.reads.mount`. */
export type Metrics = Record<string, number>;
export interface Change { id: string; was: number; now: number }
export interface Comparison { regressions: Change[]; improvements: Change[]; added: string[]; removed: string[] }

export const UPDATE_BASELINE: boolean = process.env.KG_PERF_UPDATE === '1';

export function compareMetrics(now: Metrics, baseline: Metrics | null): Comparison {
    const out: Comparison = { regressions: [], improvements: [], added: [], removed: [] };
    const was = baseline ?? {};
    for (const id of Object.keys(now).sort()) {
        const before = was[id];
        if (before === undefined) out.added.push(id);
        else if (now[id]! > before) out.regressions.push({ id, was: before, now: now[id]! });
        else if (now[id]! < before) out.improvements.push({ id, was: before, now: now[id]! });
    }
    for (const id of Object.keys(was).sort()) if (now[id] === undefined) out.removed.push(id);
    return out;
}

export function readBaseline(file: string): Metrics | null {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Metrics) : null;
}

export function writeBaseline(file: string, metrics: Metrics): void {
    const sorted: Metrics = {};
    for (const k of Object.keys(metrics).sort()) sorted[k] = metrics[k]!;
    writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
}

export function formatComparison(c: Comparison): string {
    const rows = (title: string, list: Change[]): string[] => list.length === 0 ? [] : [
        `${title} (${list.length})`,
        ...list.map((r) => `  ${r.id.padEnd(64)} ${String(r.was).padStart(12)} -> ${String(r.now).padStart(12)}  (${r.now >= r.was ? '+' : ''}${r.now - r.was})`),
    ];
    const ids = (title: string, list: string[]): string[] => list.length === 0 ? [] : [`${title} (${list.length})`, ...list.map((id) => `  ${id}`)];
    const lines = [...rows('REGRESSIONS', c.regressions), ...rows('improvements', c.improvements), ...ids('added', c.added), ...ids('removed', c.removed)];
    return lines.length === 0 ? 'no change against the baseline' : lines.join('\n');
}
