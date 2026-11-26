/**
 * The metrics as a compact console table: one row per view (the per-view ids), then the single-valued groups (wire, worker
 * tasks, GPU) in aligned columns. Read-only formatting; the ratchet itself is `baseline.ts`.
 */

import type { Metrics } from './baseline';

const VIEW_STATS = ['main.reads.mount', 'main.reads.settle', 'commits', 'dom', 'tasks.worker'] as const;
const pad = (v: string | number, n: number): string => String(v).padStart(n);

export function formatTable(metrics: Metrics): string {
    const views = [...new Set(Object.keys(metrics).filter((k) => k.startsWith('view:')).map((k) => k.split(':')[1]!))];
    const head = `${'view'.padEnd(12)}${VIEW_STATS.map((s) => pad(s, 20)).join('')}`;
    const rows = views.map((id) => `${id.padEnd(12)}${VIEW_STATS.map((s) => pad((metrics[`view:${id}:${s}`] ?? 0).toLocaleString('en-US'), 20)).join('')}`);
    const rest = Object.keys(metrics).filter((k) => !k.startsWith('view:')).sort();
    const width = Math.max(0, ...rest.map((k) => k.length));
    const others = rest.map((k) => `${k.padEnd(width)}  ${pad(metrics[k]!.toLocaleString('en-US'), 14)}`);
    return [head, ...rows, '', ...others].join('\n');
}
