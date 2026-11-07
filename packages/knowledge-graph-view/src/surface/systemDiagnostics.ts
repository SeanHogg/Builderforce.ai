/**
 * The diagnostics lines of a folder of many systems (PRD 41 A9): the systems (name, files, apps, truncated,
 * copy-of, what the reference graph read and skipped), the stray copies, and why each line stops. PURE and
 * English like the rest of the copied diagnostics; read from the same `systemsOf` the UI reads.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { Line } from './lines';
import { systemsOf, type SystemInfo } from './systems';

const pct = (n: number): number => Math.round(n <= 1 ? n * 100 : n);

function systemLine(s: SystemInfo): string {
    const read = s.graphRead
        ? ` · graph read=${s.graphRead.read}${s.graphRead.skipped.length ? ` skipped=${s.graphRead.skipped.map((k) => `${k.reason}:${k.count}`).join(',')}` : ''}`
        : '';
    return `  ${s.name || '(root)'} [${s.path || '.'}]: files=${s.files} · apps=${s.apps.length ? s.apps.join(',') : 'none'} · truncated=${s.truncated ? 'yes' : 'no'}${s.copyOf ? ` · copy-of=${s.copyOf}` : ''}${read}`;
}

export function systemDiagnosticLines(graph: KnowledgeGraph): string[] {
    const systems = systemsOf(graph);
    if (systems.length === 0) return ['systems: none (a single-system root)'];
    const copies = systems.filter((s) => s.copyOf);
    return [
        `systems: ${systems.length} (${systems.length - copies.length} standing, ${copies.length} copies)`,
        ...systems.map(systemLine),
        copies.length
            ? `copies: ${copies.map((c) => `${c.path || '.'} -> ${c.copyOf}${c.copySimilarity !== undefined ? ` (${pct(c.copySimilarity)}%${c.copyReason ? `, ${c.copyReason}` : ''})` : ''}`).join('; ')}`
            : 'copies: none',
    ];
}

/** `stop=<reason>` for a line; a line built before reasons were recorded has none. */
export const stopDiagnostic = (line: Pick<Line, 'stopReason'>): string => (line.stopReason ? ` · stop=${line.stopReason}` : '');
