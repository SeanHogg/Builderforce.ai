/**
 * What the host view hands the stage and the Patterns drawer for the code and picture (PRD 43 Part C): Simulate (opens the
 * path simulator on a symbol), Restructure (a finding's proposal, opened in the compare), and the compare bar over the
 * stage. One hook so the host view composes them and holds none of their logic. It reads the ONE compare state
 * (`useCompare`) and the facts the stage already computes (`symbolFacts` is held once per graph and station model).
 */

import type { ReactNode } from 'react';
import type { Finding, KnowledgeGraph, KNode } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from '../labels';
import { CompareBar } from './CompareBar';
import { fileRefOf } from './stations';
import { simulateTarget } from './simulateTarget';
import { symbolFacts } from './symbolFacts';
import type { SymbolLoader } from './transit/useDrill';
import type { CompareApi } from './useCompare';
import { useRestructure } from './useRestructure';
import type { SurfaceModel } from './useSurface';

export interface CompareActionsInput {
    compare: CompareApi;
    /** Today's graph: a restructure is proposed against it. */
    current: KnowledgeGraph | null;
    /** The graph on the stage (the union while comparing). */
    graph: KnowledgeGraph;
    index: ReadonlyMap<string, KNode>;
    surface: SurfaceModel;
    symbols: SymbolLoader | undefined;
    labels: KnowledgeGraphLabels;
    /** The ONE select path (`useSurfaceActions`). */
    select(ref: string): void;
    /** Opens the path simulator (the right rail's Simulate mode) if it is not open, starting at `stopId` (a station on the path) when given. */
    openSimulate(stopId?: string): void;
}

export interface CompareActions {
    onSimulate(ref: string): void;
    onRestructure(ref: string): void;
    /** The Patterns card's action (`RestructureContext`). */
    restructureFinding(finding: Finding): void;
    /** 'loading' while a restructure's file is being read (the host passes `restructureStatus === 'loading'` on), 'none' when no proposal can be made, else null. */
    restructureStatus: 'loading' | 'none' | null;
    /** 'loading' while that ref's file is being read for a proposal, 'none' when none can be made, else null. */
    restructureStatusOf(ref: string): 'loading' | 'none' | null;
    /** The compare bar, or the note a restructure that cannot be made leaves. */
    bar: ReactNode;
}

export function useCompareActions({ compare, current, graph, index, surface, symbols, labels, select, openSimulate }: CompareActionsInput): CompareActions {
    const restructure = useRestructure({
        // Facts read the graph the stage shows (the shown side's own, never the union), so a ref's pattern is the one on screen.
        graph: current, facts: symbolFacts(compare.view?.sideGraph ?? graph, surface.stations), drillSymbols: surface.drill.symbols, symbols,
        activeFindingId: compare.state?.source === 'restructure' ? compare.state.findingId : undefined, close: compare.close,
        // The drawer it came from (Patterns) gives way to the picture it asked for.
        open: (next, proposal) => { surface.openPanel(null); compare.open(next, proposal); },
    });
    // Simulate opens the existing simulator with the symbol's file selected, on the path (line) that passes through its station and at that stop.
    // No line passes through it ⇒ the simulator opens on the path it had.
    const onSimulate = (ref: string): void => {
        const target = simulateTarget(surface.lines.lines, surface.line, surface.stations, ref);
        if (target && target.lineId !== surface.line?.id) surface.selectLine(target.lineId);
        select(index.has(ref) ? ref : fileRefOf(ref)); // after selectLine: a line change clears the station
        openSimulate(target?.stopId);
    };
    return {
        onSimulate, onRestructure: restructure.restructure, restructureFinding: restructure.restructureFinding, restructureStatusOf: restructure.statusOf, restructureStatus: restructure.status,
        bar: <CompareBar compare={compare} graph={graph} labels={labels} status={restructure.status} onApply={surface.resolve} />,
    };
}
