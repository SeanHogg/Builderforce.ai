/** The rail's grouping of lines (PRD 41 A9): by system, largest first, then by app inside it. A line with no system goes last. */

import { cmp } from '../../order';
import type { Line } from '../lines';
import type { SystemInfo } from '../systems';

export interface AppGroup { app: string; lines: Line[] }
export interface SystemGroup {
    /** The system's folder; '' for lines that belong to none. */
    system: string;
    name: string;
    apps: AppGroup[];
}

export function groupLines(lines: readonly Line[], systems: readonly SystemInfo[]): SystemGroup[] {
    const bySystem = new Map<string, Line[]>();
    for (const l of lines) (bySystem.get(l.system ?? '') ?? bySystem.set(l.system ?? '', []).get(l.system ?? '')!).push(l);
    const rank = new Map(systems.map((s, i) => [s.path, i] as const));
    return [...bySystem.keys()]
        .sort((a, b) => (rank.get(a) ?? systems.length) - (rank.get(b) ?? systems.length) || cmp(a, b))
        .map((system) => {
            const byApp = new Map<string, Line[]>();
            for (const l of bySystem.get(system)!) (byApp.get(l.app ?? '') ?? byApp.set(l.app ?? '', []).get(l.app ?? '')!).push(l);
            return {
                system,
                name: systems.find((s) => s.path === system)?.name ?? system,
                apps: [...byApp].sort(([a], [b]) => cmp(a, b)).map(([app, ls]) => ({ app, lines: ls })),
            };
        });
}
