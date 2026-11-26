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
    /** Opens the path simulator (the right rail's Simulate mode) if it is not open. */
    openSimulate(): void;
}

export interface CompareActions {
    onSimulate(ref: string): void;
    onRestructure(ref: string): void;
    /** The Patterns card's action (`RestructureContext`). */
    restructureFinding(finding: Finding): void;
    /** The compare bar, or the note a restructure that cannot be made leaves. */
    bar: ReactNode;
}

export function useCompareActions({ compare, current, graph, index, surface, symbols, labels, select, openSimulate }: CompareActionsInput): CompareActions {
    const restructure = useRestructure({
        graph: current, facts: symbolFacts(graph, surface.stations), drillSymbols: surface.drill.symbols, symbols,
        // The drawer it came from (Patterns) gives way to the picture it asked for.
        open: (next, proposal) => { surface.openPanel(null); compare.open(next, proposal); },
    });
    // Simulate opens the existing simulator with the symbol's file selected: the path through it is what the simulator walks.
    const onSimulate = (ref: string): void => { select(index.has(ref) ? ref : fileRefOf(ref)); openSimulate(); };
    return {
        onSimulate, onRestructure: restructure.restructure, restructureFinding: restructure.restructureFinding,
        bar: <CompareBar compare={compare} graph={graph} labels={labels} status={restructure.status} onApply={surface.resolve} />,
    };
}
