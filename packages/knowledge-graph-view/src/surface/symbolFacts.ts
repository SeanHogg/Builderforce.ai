/**
 * symbolFacts (PRD 43 Part C2): the facts a symbol line, its gutter and its card read, computed ONCE per graph and
 * station model, never passed as booleans. Both facts belong to the symbol's FILE: an anti-pattern finding sits on a
 * file, and coverage is per station. Pure; the lookup maps are built here, so each ask is a map read.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { isRestructurable } from '../compute/compare/restructure';
import { QUESTIONS, type QuestionContext } from './questions';
import { fileRefOf, stationOfRef, type StationModel } from './stations';

export interface SymbolFacts {
    /** The restructurable anti-pattern on the ref's file (a file ref or `<file ref>#<name>`), else null. */
    antiPatternOf(ref: string): { kind: string; findingId: string } | null;
    /** Its file's station has no test reaching it: the SAME predicate as the "What has no test?" question. */
    untested(ref: string): boolean;
}

const UNTESTED = QUESTIONS.find((q) => q.id === 'untested')!;
/** The untested question reads the station alone; its context is for the questions that ask about lines. */
const NO_CONTEXT = {} as QuestionContext;

/** One facts object per (graph, station model): the stage's wiring and the host view's restructure entry read the SAME one. */
const HELD = new WeakMap<object, WeakMap<StationModel, SymbolFacts>>();

export function symbolFacts(graph: Pick<KnowledgeGraph, 'findings'>, stations: StationModel): SymbolFacts {
    let byStations = HELD.get(graph);
    if (!byStations) HELD.set(graph, byStations = new WeakMap());
    let held = byStations.get(stations);
    if (!held) byStations.set(stations, held = factsOf(graph, stations));
    return held;
}

function factsOf(graph: Pick<KnowledgeGraph, 'findings'>, stations: StationModel): SymbolFacts {
    // The offender (the finding's first node) carries the anti-pattern; the first finding in graph order wins a file.
    const onFile = new Map<string, { kind: string; findingId: string }>();
    for (const f of graph.findings) {
        const at = f.nodes[0];
        if (!at || !isRestructurable(f.kind)) continue;
        const file = fileRefOf(at);
        if (!onFile.has(file)) onFile.set(file, { kind: f.kind, findingId: f.id });
    }
    const untested = new Map<string, boolean>();
    return {
        antiPatternOf: (ref) => onFile.get(fileRefOf(ref)) ?? null,
        untested(ref) {
            const file = fileRefOf(ref);
            let known = untested.get(file);
            if (known === undefined) {
                const station = stations.byId.get(stationOfRef(stations, file) ?? '');
                known = !!station && UNTESTED.matches(station, NO_CONTEXT);
                untested.set(file, known);
            }
            return known;
        },
    };
}
