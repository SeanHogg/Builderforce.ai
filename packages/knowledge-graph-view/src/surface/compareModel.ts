/**
 * The compare's data (PRD 43 Part C5), pure: the ONE state a comparison is, the model its two-graph sources share, and
 * the view of one side that the stage and the code pane read.
 *
 * A comparison is one of four sources held by one state (`useCompare`). `baseline` / `snapshot` / `restructure` are TWO
 * graphs: one union graph (`unionGraph`) is handed to the stage for the whole comparison so the MarkSet is built once and
 * every slot stays put; a side is the union with the slots it lacks shrunk (`applySideMask`). `commit` is NOT a second
 * graph (no host can build the graph at a commit): it is a changed set over today's graph, painted, never a MarkSet input.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { absentOn, diffGraphs, diffKindOf, unionGraph, type DiffKind, type GraphDiff, type MovedSpan, type Proposal, type UnionGraph } from '../compute/compare';
import type { Commit } from '../types';
import { stationOfRef, type StationModel } from './stations';

export type CompareSource = 'baseline' | 'snapshot' | 'restructure' | 'commit';
export type CompareSide = 'before' | 'after';

/** What is being compared, and which side is on show. `findingId` names a restructure's finding; `commit` a picked commit. */
export interface CompareState {
    source: CompareSource;
    side: CompareSide;
    findingId?: string | undefined;
    commit?: Commit | undefined;
}

/** What two graphs say about each other, built once per comparison and shared by both sides. */
export interface CompareModel {
    union: UnionGraph;
    diff: GraphDiff;
    /** Where a slot absent on a side parks: a restructure's `bornFrom` (new module to file) and its inverse (file to its first module). */
    anchors: ReadonlyMap<string, string>;
    /** The two graphs themselves (the union keeps both sides' findings; what a side's facts read is its own). */
    sides: Readonly<Record<CompareSide, KnowledgeGraph>>;
    /** A restructure's definitions that leave their file (definition ref to the new module's ref); empty for any other source. */
    moved: ReadonlyMap<string, string>;
    /** The lines those definitions occupy (`Proposal.spans`), for the code pane's marks. */
    spans: readonly MovedSpan[];
}

/** The revision each side's source is read at; null = today's working tree. */
export interface CompareRevs { before: string | null; after: string | null }

/** One side of a comparison, as the stage and the code pane read it. */
export interface CompareView {
    state: CompareState;
    /** The graph the stage draws for the WHOLE comparison (the union); null for a commit (today's graph stays). */
    graph: KnowledgeGraph | null;
    /** Refs this side does not have: shrunk to scale 0 at their anchor. */
    absent: ReadonlySet<string>;
    anchors: ReadonlyMap<string, string>;
    /** How each ref differs, as `paintMarks`' diff input (a changed set for a commit). */
    diff: ReadonlyMap<string, DiffKind>;
    revs: CompareRevs;
    /** The shown side's OWN graph (facts such as an anti-pattern read it, never the union); null with no two-graph source. */
    sideGraph?: KnowledgeGraph | null | undefined;
    /** A restructure's moved definitions (`Proposal.moved`): the code pane marks their lines. */
    moved?: ReadonlyMap<string, string> | undefined;
    spans?: readonly MovedSpan[] | undefined;
}

const NONE: ReadonlySet<string> = new Set();
const NO_ANCHORS: ReadonlyMap<string, string> = new Map();

/** The two graphs of a two-graph source; null for a commit or when a side is missing. */
export function compareModel(source: CompareSource, current: KnowledgeGraph | null, baseline: KnowledgeGraph | null, proposal: Proposal | null): CompareModel | null {
    const pair: readonly [KnowledgeGraph, KnowledgeGraph] | null = source === 'restructure' ? (current && proposal ? [current, proposal.after] : null)
        : source === 'commit' ? null
        : current && baseline ? [baseline, current] : null;
    if (!pair) return null;
    const anchors = new Map<string, string>();
    if (source === 'restructure' && proposal) {
        for (const [born, from] of proposal.bornFrom) { anchors.set(born, from); if (!anchors.has(from)) anchors.set(from, born); }
    }
    return { union: unionGraph(pair[0], pair[1]), diff: diffGraphs(pair[0], pair[1]), anchors, sides: { before: pair[0], after: pair[1] }, moved: source === 'restructure' && proposal ? proposal.moved : NO_ANCHORS, spans: source === 'restructure' && proposal ? proposal.spans : [] };
}

/** Which revision each side reads: a baseline's `rev` is Before, a snapshot's `rev` its After, a commit's parent is Before and its sha After. A restructure has none. */
export function compareRevs(state: CompareState, baselineRev: string | null, snapshotRev: string | null): CompareRevs {
    switch (state.source) {
        case 'baseline': return { before: baselineRev, after: null };
        case 'snapshot': return { before: baselineRev, after: snapshotRev };
        // A commit's Before is the file as the commit found it (its first parent; none known ⇒ not available), After is the commit itself.
        case 'commit': return { before: state.commit?.parent ?? null, after: state.commit?.sha ?? null };
        default: return { before: null, after: null };
    }
}

export function compareView(state: CompareState, model: CompareModel | null, revs: CompareRevs): CompareView {
    if (state.source === 'commit') {
        const diff = new Map<string, DiffKind>((state.commit?.refs ?? []).map((r) => [r, 'changed'] as const));
        return { state, graph: null, absent: NONE, anchors: NO_ANCHORS, diff, revs };
    }
    if (!model) return { state, graph: null, absent: NONE, anchors: NO_ANCHORS, diff: new Map(), revs };
    return { state, graph: model.union.graph, absent: absentOn(model.union, state.side), anchors: model.anchors, diff: diffKindOf(model.diff, state.side), revs, sideGraph: model.sides[state.side], moved: model.moved, spans: model.spans };
}

/**
 * What the code pane compares: the side on show and the revision each reads. A restructure has no file at a revision (both
 * sides read today's file), so it carries `moved` instead: the pane marks the lines of the definitions that leave the file.
 */
export function codeCompareOf(view: CompareView | null | undefined): { side: CompareSide; revs: CompareRevs; moved?: ReadonlyMap<string, string>; spans?: readonly MovedSpan[] } | undefined {
    if (!view) return undefined;
    if (view.state.source !== 'restructure') return { side: view.state.side, revs: view.revs };
    return view.moved && view.moved.size > 0 ? { side: view.state.side, revs: view.revs, moved: view.moved, spans: view.spans ?? [] } : undefined;
}

/** The diff plus the station of each ref it names: a station mark is painted by its id, a node mark by its ref (`paintMarks`). */
export function paintDiffEntries(diff: ReadonlyMap<string, DiffKind>, stations: Pick<StationModel, 'stationOf'>): Array<[string, DiffKind]> {
    const out = new Map(diff);
    for (const [ref, kind] of diff) {
        const station = stationOfRef(stations, ref);
        if (station !== undefined && !out.has(station)) out.set(station, kind);
    }
    return [...out];
}
