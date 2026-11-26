/**
 * symbolFacts (PRD 43 Part C2): the facts a symbol line, its gutter and its card read, computed ONCE per graph and
 * station model, never passed as booleans. Both facts belong to the symbol's FILE: an anti-pattern finding sits on a
 * file, and coverage is per station. Pure; the lookup maps are built here, so each ask is a map read.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { isRestructurable } from '../compute/compare/restructure';
import { QUESTIONS, type QuestionContext } from './questions';
import { fileRefOf, stationOfRef, type StationModel } from './stations';

/** An anti-pattern finding on a file. Every kind shows (the warning, the name); only a `restructurable` one can be restructured. */
export interface AntiPatternFact {
    kind: string;
    findingId: string;
    restructurable: boolean;
}

/** Whether a test reaches a file's station: `unknown` = no coverage reading was collected (never an invented zero). */
export type TestReach = 'reached' | 'none' | 'unknown';

export interface SymbolFacts {
    /**
     * The anti-pattern on the ref's file (a file ref or `<file ref>#<name>`), else null. A restructurable finding wins
     * over one that is not; among equals, the first in graph order.
     */
    antiPatternOf(ref: string): AntiPatternFact | null;
    /** Test reach of the ref's file's station: `none` is the SAME predicate as the "What has no test?" question. */
    testReach(ref: string): TestReach;
    /** `testReach(ref) === 'none'`: no reading is not "untested". */
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
    // The offender (the finding's first node) carries the anti-pattern; a restructurable finding outranks the rest of its file.
    const onFile = new Map<string, AntiPatternFact>();
    for (const f of graph.findings) {
        const at = f.nodes[0];
        if (!at) continue;
        const file = fileRefOf(at);
        const held = onFile.get(file);
        if (held && (held.restructurable || !isRestructurable(f.kind))) continue;
        onFile.set(file, { kind: f.kind, findingId: f.id, restructurable: isRestructurable(f.kind) });
    }
    const reach = new Map<string, TestReach>();
    const testReach = (ref: string): TestReach => {
        const file = fileRefOf(ref);
        let known = reach.get(file);
        if (known === undefined) {
            const station = stations.byId.get(stationOfRef(stations, file) ?? '');
            known = !station || station.cov === undefined ? 'unknown' : UNTESTED.matches(station, NO_CONTEXT) ? 'none' : 'reached';
            reach.set(file, known);
        }
        return known;
    };
    return {
        antiPatternOf: (ref) => onFile.get(fileRefOf(ref)) ?? null,
        testReach,
        untested: (ref) => testReach(ref) === 'none',
    };
}
