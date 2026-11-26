/**
 * The System camera of a root with several systems (PRD 41 A9 rule 4): one tier group per system
 * (largest first), each laid out from its own stations and its own lines. A stray copy's stations
 * already read as their original's (`Station.system`), so they sit in the original's group, marked.
 * Stations of no system are a last group of loose files. A single-system root has no groups.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { LinesModel } from '../lines';
import type { StationModel } from '../stations';
import { isMultiSystem } from '../systems';
import { buildSystemLayout, type SystemLayout } from './systemModel';

export interface SystemGroup {
    /** The system's folder; '' for the stations in none. */
    system: string;
    name: string;
    layout: SystemLayout;
}

export function buildSystemGroups(stations: StationModel, lines: LinesModel, graph: Pick<KnowledgeGraph, 'nodes'> | null): SystemGroup[] {
    const systems = lines.systems ?? [];
    if (!isMultiSystem(systems)) return [];
    const paths = [...systems.map((s) => s.path), ''];
    return paths.flatMap((path) => {
        const mine = stations.stations.filter((st) => (st.system ?? '') === path);
        if (mine.length === 0) return [];
        const layout = buildSystemLayout({ ...stations, stations: mine }, { ...lines, lines: lines.lines.filter((l) => (l.system ?? '') === path) }, graph);
        return [{ system: path, name: systems.find((s) => s.path === path)?.name ?? '', layout }];
    });
}
