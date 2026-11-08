/**
 * The surface's state and its derivations: the stations and lines folded from the graph on
 * screen, the overlay bindings, the question, and the line / station / step the person is on.
 * Everything derived is a pure function in this folder; this hook only holds the choices and
 * memoizes the readings, so a host with no entry points simply gets no lines.
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { Finding, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { fixFlowReducer, initialFlow, type FixFlowAction, type FixFlowState } from './fix/fixFlow';
import { buildLines, type Line, type LinesModel } from './lines';
import { dataCoverage, type DataCoverage } from './dataCoverage';
import { makeOverlay, PRESETS, presetOf, setChannel, type Bindings, type ChannelId, type MetricId, type OverlayModel, type PresetId } from './overlays';
import { mapEdges } from './outlineGraph';
import { pathOfLine, pathOfStations, type PathModel } from './path';
import { litStations, type QuestionContext, type QuestionId } from './questions';
import { buildStations, changedRefs, stationOfRef, type Station, type StationModel } from './stations';
import { useDrill, type DrillModel, type SymbolLoader } from './transit/useDrill';
import type { TowerHighlight } from './towerHighlight';

export interface Pin { stationId: string; count: number }

export interface SurfaceModel {
    stations: StationModel;
    lines: LinesModel;
    /** Where the map's files came from and which per-file data the graph carries (`dataCoverage`): the reasons behind "Not set up". Null with no graph. */
    coverage: DataCoverage | null;
    overlay: OverlayModel;
    /** The map's drill: package, class and function levels below the world map. */
    drill: DrillModel;
    preset: PresetId | 'custom';
    question: QuestionId;
    /** The pattern family the patterns question is narrowed to ("Behavioural only"); null = every family. */
    family: string | null;
    /** The line the path strip and the line list show: the chosen one, else the first. */
    line: Line | null;
    /** True once the person picked a line (the scope's NAME in the chrome follows an explicit pick; the Act scope follows the drawn line). */
    lineChosen: boolean;
    station: Station | null;
    step: number;
    path: PathModel;
    /** Stations that answer the question; null = every station. */
    lit: Set<string> | null;
    context: QuestionContext;
    pins: Pin[];
    /** The stations the Act panel is scoped to; null = the whole graph. */
    scope: Set<string> | null;
    /** Refs the path strip was pinned to (a pinpoint), instead of the selected line; null = the line. */
    pinned: readonly string[] | null;
    /** The open drawer (a PANELS id) and the finding Resolve works on. */
    panel: string | null;
    resolving: Finding | null;
    /** The anti-pattern lit in the Tower (offenders, partners, the rest dimmed); null = none. */
    highlight: TowerHighlight | null;
    setHighlight(h: TowerHighlight | null): void;
    /** The staged fix flow of every finding worked on, by finding id: closing the drawer keeps an applied fix's Undo. */
    fixFlows: Readonly<Record<string, FixFlowState>>;
    dispatchFix(findingId: string, action: FixFlowAction): void;
    setPreset(id: PresetId): void;
    setChannel(channel: ChannelId, metric: MetricId): void;
    setPins(on: boolean): void;
    /** Asking any question other than patterns drops the family filter. */
    setQuestion(id: QuestionId): void;
    /** Narrows the patterns question to one family (null clears it). */
    setFamily(family: string | null): void;
    selectLine(id: string | null): void;
    selectStation(id: string | null): void;
    setStep(n: number): void;
    pinPath(refs: readonly string[] | null): void;
    openPanel(id: string | null): void;
    /** Opens the Resolve drawer on a finding (null closes it). */
    resolve(finding: Finding | null): void;
}

export interface SurfaceOptions {
    /** The question to open on (the host's initial lens). Read once, on mount. */
    question?: QuestionId | undefined;
    /** Refs that are searched for or shown: their stations are the lit ones, whatever the question. */
    focus?: readonly string[] | undefined;
    /** Refs a picked commit changed (the time slider); they join the baseline's changed set. */
    changed?: ReadonlySet<string> | undefined;
    /** Reads the definitions of some files, for the map's class and function levels; absent ⇒ those levels show files. */
    symbols?: SymbolLoader | undefined;
    /** The localized name of the top-level config station (`labels.surface.repoConfig`). */
    repoConfigName?: string | undefined;
}

const MAX_PINS = 12;

export function useSurface(graph: KnowledgeGraph | null, baseline: KnowledgeGraph | null, opts: SurfaceOptions = {}): SurfaceModel {
    const [bindings, setBindings] = useState<Bindings>(PRESETS.risk);
    const [question, setQuestionId] = useState<QuestionId>(opts.question ?? 'where');
    const [family, setFamilyId] = useState<string | null>(null);
    const [lineId, setLineId] = useState<string | null>(null);
    const [stationId, setStationId] = useState<string | null>(null);
    const [step, setStepIndex] = useState(0);
    const [pinned, setPinned] = useState<readonly string[] | null>(null);
    const [panel, setPanel] = useState<string | null>(null);
    const [resolving, setResolving] = useState<Finding | null>(null);
    const [highlight, setHighlight] = useState<TowerHighlight | null>(null);
    const [fixFlows, dispatchFlows] = useReducer((m: Record<string, FixFlowState>, a: { id: string; action: FixFlowAction }) => ({ ...m, [a.id]: fixFlowReducer(m[a.id] ?? initialFlow(a.id), a.action) }), {});
    const dispatchFix = useCallback((id: string, action: FixFlowAction) => dispatchFlows({ id, action }), []);
    const historyChanged = opts.changed;

    const repoConfigName = opts.repoConfigName;
    const stations = useMemo<StationModel>(
        () => (graph
            ? buildStations(graph, { changed: new Set([...changedRefs(graph, baseline), ...(historyChanged ?? [])]), ...(repoConfigName ? { repoConfigName } : {}) })
            : { stations: [], byId: new Map(), stationOf: new Map() }),
        [graph, baseline, historyChanged, repoConfigName],
    );
    const lines = useMemo<LinesModel>(
        () => (graph ? buildLines(graph, stations) : { lines: [], interchanges: new Map(), omitted: 0 }),
        [graph, stations],
    );
    const coverage = useMemo(() => (graph ? dataCoverage(graph) : null), [graph]);
    const overlay = useMemo(() => makeOverlay(bindings, stations.stations), [bindings, stations]);
    const drill = useDrill(graph, stations, opts.symbols);

    const chosen = lines.lines.find((l) => l.id === lineId) ?? null;
    const line = chosen ?? lines.lines[0] ?? null;
    const station = stationId ? stations.byId.get(stationId) ?? null : null;
    const context = useMemo<QuestionContext>(() => ({ lines, line, selected: station, family }), [lines, line, station, family]);
    const focus = opts.focus;
    const lit = useMemo(() => {
        const shown = new Set((focus ?? []).flatMap((ref) => stationOfRef(stations, ref) ?? []));
        return shown.size > 0 ? shown : litStations(question, stations.stations, context);
    }, [question, stations, context, focus]);
    const path = useMemo(
        () => (pinned ? pathOfStations(pinned, stations, graph ? mapEdges(graph) : []) : pathOfLine(line, stations.byId)),
        [pinned, line, stations, graph],
    );

    const pins = useMemo<Pin[]>(() => {
        if (bindings.pins !== 'on') return [];
        const onLine = new Set(line?.stops ?? []);
        return stations.stations
            .filter((s) => s.findingIds.length > 0 && (lit ? lit.has(s.id) : onLine.has(s.id) || s.id === stationId))
            .sort((a, b) => b.anti - a.anti || b.findingIds.length - a.findingIds.length)
            .slice(0, MAX_PINS)
            .map((s) => ({ stationId: s.id, count: s.findingIds.length }));
    }, [bindings.pins, stations, lit, line, stationId]);

    // The Act scope follows what is DRAWN: the station, else the drawn path (the line, or a pinned pinpoint), else the whole graph.
    const scope = useMemo(() => (station ? new Set([station.id]) : path.stops.length > 0 ? new Set(path.stops.map((x) => x.id)) : null), [station, path]);

    // A new question or family is a new reading of the Tower: the anti-pattern highlight (and its legend) ends with the old one.
    const setQuestion = useCallback((id: QuestionId) => { setQuestionId(id); setHighlight(null); if (id !== 'patterns') setFamilyId(null); }, []);
    const setFamily = useCallback((f: string | null) => { setFamilyId(f); setHighlight(null); if (f) setQuestionId('patterns'); }, []);
    // A different graph (new load, baseline or Before/After toggle, a re-review reload) is not the one the highlight was made on.
    useEffect(() => setHighlight(null), [graph, baseline]);
    const setStep = useCallback((n: number) => {
        setStepIndex(n);
        const stop = path.stops[n];
        if (stop) setStationId(stop.id);
    }, [path]);
    const selectLine = useCallback((id: string | null) => { setLineId(id); setStationId(null); setStepIndex(0); setPinned(null); }, []);
    const pinPath = useCallback((refs: readonly string[] | null) => { setPinned(refs && refs.length > 0 ? refs : null); setStepIndex(0); }, []);
    const resolve = useCallback((f: Finding | null) => { setResolving(f); setPanel(f ? 'resolve' : null); }, []);
    const selectStation = useCallback((id: string | null) => {
        setStationId(id);
        const at = id ? path.stops.findIndex((s) => s.id === id) : -1;
        if (at >= 0) setStepIndex(at);
    }, [path]);

    return {
        stations, lines, coverage, overlay, drill, preset: presetOf(bindings), question, family, line, lineChosen: chosen !== null, station, step, path, lit,
        context, pins, scope, pinned, panel, resolving, highlight, setHighlight, fixFlows, dispatchFix,
        setPreset: (id) => setBindings(PRESETS[id]),
        setChannel: (channel, metric) => setBindings((b) => setChannel(b, channel, metric)),
        setPins: (on) => setBindings((b) => ({ ...b, pins: on ? 'on' : 'off' })),
        setQuestion, setFamily, selectLine, selectStation, setStep, pinPath, openPanel: setPanel, resolve,
    };
}
