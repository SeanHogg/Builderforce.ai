/**
 * What a stage camera wires to the surface (PRD 43 B5, B7): selection (a station opens its card and selects it on the
 * surface or in the drilled level; a node selects its ref), the card, the Map's drill and unfold (`useStageMap`), the
 * ranked incident index (asked for ONCE per graph and handed to the stage bus, so a selection slices it on the main
 * thread), the selected line as the path highlight, and Escape / Backspace "Out" (of a callee opened across, the code
 * level, then a drilled level).
 *
 * The code (B1a rule 9, Part C1): the pane is docked beside the map (the outline of the level; a file once one is open),
 * wired by `useCodeDock`, which also owns what reading drives on the map side (the reading ring and the open method's
 * numbered call arcs). Here the pane, the bar over the map (`CodeTrail`), the call numbers (`CallBadges`) and the cards
 * are composed from it.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CallSite, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { restructureOf } from './restructureTarget';
import { useComputed } from '../../compute/useComputed';
import { fillTemplate } from '../../labels';
import { nodeIndex } from '../../graphModel';
import { fileRefOf } from '../../surface/stations';
import type { SceneProps } from '../../surface/registry';
import { stageBus, StageBusContext } from '../anchor/stageBus';
import { ZOOM_BANDS } from '../labels/lod';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';
import { questionGlyph } from '../../surface/ui/glyphs';
import { depthCrumbs } from '../../surface/DepthTrail';
import { answerOf } from '../../surface/transit/noteFacts';
import { onePaneStage } from '../../layout';
import { MARK_TYPE_ORDER, type MarkType } from '../../shapes';
import { railKindOf, type RailKind } from '../drill/codeText';
import { CallBadges } from './CallBadges';
import { CodeDock } from './CodeDock';
import { CodePane } from './CodePane';
import { CodeTrail } from './CodeTrail';
import { StepCard } from './StepCard';
import { useCodeDock } from './useCodeDock';
import type { CodeCompare } from '../drill/useCodeDiff';
import { useSemanticZoom, type SemanticZoom } from '../drill/useSemanticZoom';
import { useStageMap, type StageMap } from '../drill/useStageMap';
import type { StageRenderer } from '../renderer';
import type { MarkSet, Placement } from '../types';
import { SlotIncident } from './incident';
import { StageToast, useStageToast } from './StageToast';
import { StatusStrip } from './StatusStrip';
import { CallSiteCard } from './CallSiteCard';
import { StageCard, stationCardOf } from './StageCard';
import { SymbolCard, type SymbolCardState } from './SymbolCard';

/** The Map's bands, in ladder order (system, class, method, code). */
const BAND_ORDER = ZOOM_BANDS.map((b) => b.band);
/** A mark type for a symbol drawn after the MarkSet (a drilled level's), by what the record is. */
const SYMBOL_MARK_TYPE: Readonly<Record<RailKind, MarkType>> = { class: 'class', method: 'function', field: 'data' };

/** What the host hands the dock: its visibility (the viewer's `code` slot) and the actions another slice wires (Simulate, Restructure). */
export interface StageDockOptions {
    /** The pane is shown (default true); reading shows it regardless. */
    shown?: boolean | undefined;
    onToggleCode?: (() => void) | undefined;
    onSimulate?: ((ref: string) => void) | undefined;
    onRestructure?: ((ref: string) => void) | undefined;
    /** The restructure's file read is in flight (`useRestructure().status === 'loading'`): the card's Restructure is disabled meanwhile. */
    restructureLoading?: boolean | undefined;
    /** An open comparison of files (`codeCompareOf`): the code pane shows the chosen side and marks the lines the other lacks. */
    compare?: CodeCompare | undefined;
    /** The Sequence camera is on show: it draws the open method's calls as raised bars, so the call arcs and badges stay off. */
    sequence?: boolean | undefined;
    /** The graph the facts read while comparing (the shown side's own; `p.graph` is the union, which keeps both sides' findings). */
    factsGraph?: KnowledgeGraph | null | undefined;
}

export interface StageWiring {
    map: StageMap;
    /** The semantic zoom: the Map's band, the Sequence's `lod`, Go inside as a zoom, the code layer. */
    zoom: SemanticZoom;
    selected: string | null;
    onSelect(key: string): void;
    /** Double-click or Enter on a mark: a station goes inside, a method opens its code. */
    onDrill(key: string): void;
    onOut: (() => void) | undefined;
    /** Escape: clear the selection first, else go out (the mockup's order). */
    onEscape(): void;
    /** A click on empty space: no selection, no card. */
    clearSelection(): void;
    /** The surface's selection the person cleared (it stays selected on the surface; the stage does not show it). */
    dismissed: string | null;
    /** The stepped wheel on the Map: one band in (1) or out (-1). */
    wheelStep(dir: 1 | -1): void;
    /** The ladder: go to band `target` (0 system … 3 code). */
    toBand(target: number): void;
    /** The method whose code is open (the code band's, or one opened across): the Sequence placement's `method`. */
    method: string | null;
    /** The status strip along the bottom while the code is read. */
    status: ReactNode;
    /** The Map placement with the unfold patch applied (memoized: the same placement in, the same out). */
    patchMap(p: Placement | null): Placement | null;
    card: ReactNode;
    /**
     * The code pane. `visible`: shown at all (docked or read); `split`: beside the map (else one half of the Code | Picture
     * switch); `reading`: a file is open, so the bar over the map and the status strip show. `show` brings a hidden pane back;
     * `hide` hides it (and leaves the reading).
     */
    code: { pane: ReactNode; bar: ReactNode; visible: boolean; split: boolean; reading: boolean; show: (() => void) | undefined; hide: () => void };
}

export function useStageWiring(p: SceneProps, renderer: StageRenderer, marks: MarkSet | null, width: number, dock: StageDockOptions = {}): StageWiring {
    const { surface, graph } = p;
    const bus = useMemo(() => stageBus(renderer), [renderer]);
    const index = useMemo(() => nodeIndex(graph), [graph]);
    // The LIVE keys (the bus's: a drilled level's appended symbols included); the MarkSet's before the stage first mounts.
    const slotOf = useMemo(() => {
        const at = new Map((marks?.keys ?? []).map((k, i) => [k, i] as const));
        return (k: string) => { const s = bus.slotOf(k); return s >= 0 ? s : at.get(k) ?? -1; };
    }, [bus, marks]);
    const drill = surface.drill;
    const map = useStageMap(surface.stations, drill, index, slotOf);
    // The semantic zoom (B1a rules 9–10): the zoom enters and leaves the drill's levels; Go inside flies the same zoom.
    const zoom = useSemanticZoom(bus, drill, map, p.reducedMotion);
    const [selected, setSelected] = useState<string | null>(null);
    const [cardKey, setCardKey] = useState<string | null>(null);
    const [dismissed, setDismissed] = useState<string | null>(null);
    const toast = useStageToast();
    const t = p.labels.surface.code;

    // The ranked incident index, once per graph; the selected line is the path the overlay highlights.
    const generation = marks?.generation ?? 0;
    const incident = useComputed('stageIncident', { graph, generation }, [graph, generation], null, { enabled: !!marks }).value;
    const stops = drill.view ? null : surface.line?.stops ?? null;
    // A route pick selects its line, as the SVG map's hop does (`TransitCamera`: on the world map only); the path
    // highlight then follows the selected line's stops.
    // A Sequence message pick (its batch names the call site) opens the call-site card instead.
    const selectLine = surface.selectLine;
    // The card is docked (the note-card shell), so where the message was picked is not kept.
    const [site, setSite] = useState<CallSite | null>(null);
    const onLink = useCallback((hit: { line: string | null; site: CallSite | null }) => {
        if (hit.site) { setCardKey(null); setSite(hit.site); return; }
        if (drill.view || !hit.line) return;
        setCardKey(null); setSelected(null);
        selectLine(hit.line);
    }, [drill.view, selectLine]);
    const closeSite = useCallback(() => setSite(null), []);
    // The call site belongs to the placement it was picked on: a camera switch, a band crossed, a drill or a new MarkSet
    // (another placement on the bus) closes it, as does selecting a mark.
    useEffect(() => bus.onPlacement(() => setSite(null)), [bus]);
    useEffect(() => { setSite(null); }, [generation]);
    useEffect(() => {
        bus.setOptions({ ...bus.options, incident: incident && incident.generation === generation ? new SlotIncident(incident) : null, path: stops ? stops.map((id) => `st:${id}`) : null, onLink });
    }, [bus, incident, generation, stops, onLink]);

    // A drill step leaves the level the card and the selection were on. Focus follows it once the tween settles: Go
    // inside → the level's first stop; Out → the station (or member) drilled out of, at the level now on show.
    const stack = drill.stack;
    const before = useRef(stack);
    useEffect(() => {
        setCardKey(null); setSelected(null);
        const prev = before.current;
        before.current = stack;
        if (stack.length > prev.length) bus.requestFocus({ first: true });
        else if (stack.length < prev.length) {
            const left = prev[stack.length]!;
            bus.requestFocus({ key: stack.length === 0 ? `st:${left.ref}` : `node:${left.ref}` });
        }
    }, [map.drill, stack, bus]);

    const onSelect = useCallback((key: string) => {
        setSelected(key);
        setDismissed(null);
        setSite(null);
        const station = map.stationOfKey(key);
        setCardKey(station ? key : null);
        if (station) { if (drill.view) drill.select(station.id); else surface.selectStation(station.id); return; }
        if (key.startsWith('node:')) p.onSelect(key.slice('node:'.length));
    }, [map, drill, surface, p]);

    const onDrill = useCallback((key: string) => {
        // A method is a station too (the method band's marks), so a station that cannot be entered falls through to its code.
        const station = map.stationOfKey(key);
        if (station && drill.canEnter(station.id).can) { zoom.zoomInto(station.id); return; }
        if (!key.startsWith('node:')) return;
        const ref = key.slice('node:'.length);
        if (!zoom.enterCode(ref)) toast.show(fillTemplate(t.toastNoCalls, { name: index.get(ref)?.label ?? ref }));
    }, [map, drill, zoom, toast.show, t, index]);

    // Empty space (or Escape) clears the pick: the stage's selection, its card, the call-site card, and the drilled
    // level's or the surface's own selection.
    const surfaceSelected = p.selected ?? null;
    const clearSelection = useCallback(() => {
        setSelected(null); setCardKey(null); setSite(null); setDismissed(surfaceSelected);
        if (drill.view) drill.select(null); else surface.selectStation(null);
    }, [drill, surface, surfaceSelected]);

    const patched = useMemo(() => new WeakMap<Placement, Placement>(), [map.patch, zoom.nest]);
    const patchMap = useCallback((pl: Placement | null) => {
        if (!pl) return null;
        let out = patched.get(pl);
        if (!out) { out = zoom.nest(map.patch(pl)); patched.set(pl, out); }
        return out;
    }, [patched, map, zoom]);

    // The Map's wheel and ladder go one band at a time; a step with nothing to enter says so at the method band.
    const atCodeLevel = !!zoom.code;
    const bandIndex = BAND_ORDER.indexOf(zoom.band);
    const { stepIn, outToBand, closeCode: popCode, toBand: goToBand } = zoom;
    const wheelStep = useCallback((dir: 1 | -1) => {
        if (dir > 0) { if (!stepIn(selected) && bandIndex === BAND_ORDER.length - 2) toast.show(t.toastNoMethod); return; }
        if (atCodeLevel) popCode(); else if (bandIndex > 0) outToBand(bandIndex - 1);
    }, [stepIn, outToBand, popCode, atCodeLevel, bandIndex, selected, toast.show, t]);
    const toBand = useCallback((target: number) => goToBand(target, selected, () => toast.show(t.toastNoMethod)), [goToBand, selected, toast.show, t]);

    // The code dock: docked or read, what it reads and what that drives on the map (`useCodeDock`).
    const d = useCodeDock({ p, bus, map, zoom, selected, setSelected, cardKey, toast: toast.show, width, slotOf, shown: dock.shown ?? true, onToggle: dock.onToggleCode, sequence: dock.sequence, factsGraph: dock.factsGraph });
    const { reader, records, methodTarget, out } = d;
    // Escape: clear the pick first (never at the code level, which goes out), else go out.
    const onEscape = useCallback(() => {
        if ((selected || (surfaceSelected && surfaceSelected !== dismissed)) && !zoom.code) clearSelection(); else out?.();
    }, [selected, surfaceSelected, dismissed, zoom.code, clearSelection, out]);

    // The symbol card: a selected file or symbol mark, else (reading) the symbol being read, pinned when Follow is off.
    // Stations keep their card (`cardKey` wins) and the code level has the step card.
    const readRef = reader.chain.at(-1)?.ref ?? null;
    const cardSubject: { ref: string; state: SymbolCardState } | null = atCodeLevel || cardKey ? null
        : d.nodeSelected ? { ref: selected!.slice('node:'.length), state: 'selected' }
        : d.reading && readRef ? { ref: readRef, state: reader.follow ? 'reading' : 'pinned' } : null;
    const cardSlot = cardSubject ? [`node:${cardSubject.ref}`, `node:${fileRefOf(cardSubject.ref)}`].find((k) => bus.slotOf(k) >= 0) ?? null : null;
    const cardRecord = cardSubject ? records.find((r) => r.ref === cardSubject.ref) : undefined;
    const cardType = cardSlot ? MARK_TYPE_ORDER[marks?.type[bus.slotOf(cardSlot)] ?? -1] ?? SYMBOL_MARK_TYPE[railKindOf(cardRecord?.kind ?? '')] : 'external';
    // The card's actions: the host's handler bound to the ref it acts on (a symbol's own; a station's first file, or the one carrying the anti-pattern).
    const actOn = (act: ((ref: string) => void) | undefined, ref: string | undefined) => (act && ref ? () => act(ref) : undefined);
    // Restructure is offered only for a restructurable anti-pattern; a click loads the file's symbols when the drill lacks them,
    // so it is disabled only while that read is in flight (the same target and rule as the outline row and the lens).
    const restructureLoading = dock.restructureLoading === true;
    // The card's answer row: the question being asked, bold, and what it answers (the text the header used to carry).
    const narrow = onePaneStage(width);
    const answer = useMemo(() => ({ icon: questionGlyph(surface.question), ...answerOf(surface.question, surface, p.labels) }), [surface, p.labels]);
    const findings = useMemo(() => new Map(graph.findings.map((f) => [f.id, f] as const)), [graph]);
    const symbolRestructure = restructureOf(d.facts, [cardSubject?.ref ?? ''], restructureLoading);
    const symbolCard = cardSubject && (
        <SymbolCard
            slotKey={cardSlot} symbolRef={cardSubject.ref} name={cardRecord?.name ?? index.get(cardSubject.ref)?.label ?? cardSubject.ref} state={cardSubject.state}
            records={records} markType={cardType} labels={p.labels} onDrill={() => onDrill(`node:${cardSubject.ref}`)} onCode={d.openCode}
            onOpenSource={p.onOpenSource} answer={answer} narrow={narrow}
            facts={d.facts} onCallers={() => surface.setQuestion('callers')} onSimulate={actOn(dock.onSimulate, cardSubject.ref)} onRestructure={actOn(dock.onRestructure, symbolRestructure.ref)} restructureReady={symbolRestructure.ready}
        />
    );
    const cardRefs = map.stationOfKey(cardKey)?.refs ?? [];
    const stationRestructure = restructureOf(d.facts, cardRefs, restructureLoading);
    const card = (
        <StageBusContext.Provider value={bus}>
            <StageCard
                cardKey={cardKey} map={map} drill={drill} graph={graph} labels={p.labels} narrow={narrow} answer={answer}
                type={(cardKey && d.types.get(map.stationOfKey(cardKey)?.id ?? '')) || 'source'} onQuestion={surface.setQuestion} onOpenPanel={surface.openPanel} onEnter={zoom.zoomInto}
                onCode={d.openCode} facts={d.facts} onSimulate={actOn(dock.onSimulate, cardRefs[0])}
                onRestructure={actOn(dock.onRestructure, stationRestructure.ref)} restructureReady={stationRestructure.ready}
            />
            {/* One docked card at a time: the call site, while open, stands in for the symbol card. */}
            {site ? <CallSiteCard site={site} labels={p.labels} narrow={narrow} onOpenSource={p.onOpenSource} onClose={closeSite} /> : symbolCard}
            {d.reading && !dock.sequence && <CallBadges labels={p.labels} onStep={reader.goStep} />}
            {d.reading && methodTarget && (
                <StepCard method={methodTarget} reading={reader} records={records} labels={p.labels} onDrill={d.drillTo} onOut={out} side={d.split ? 'right' : 'left'} />
            )}
            {drill.loading && zoom.band !== 'system' && <ZoomLoading text={p.labels.surface.map.card.loading} />}
            <StageToast message={toast.message} />
        </StageBusContext.Provider>
    );
    // The pane: the level tree always; under it the file being read (the whole of it; `files` its tabs), else the level's folder listing; then the plain words.
    const sayStation = map.stationOfKey(selected ?? cardKey);
    const say = sayStation ? (() => { const c = stationCardOf(sayStation, { map, drill, findings, index, labels: p.labels, facts: d.facts }); return [c.meta, ...c.issues].join('. '); })()
        : (selected && index.get(selected.replace(/^node:/, ''))?.label) || depthCrumbs(drill.stack, null, p.labels.surface.depth).at(-1)?.name || '';
    const reading = !d.reading ? null : (
        <CodeDock
            target={d.codeTarget} name={d.codeName} reader={surface.readSource} labels={p.labels} records={records} scrollLine={d.scrollLine}
            reading={reader} onDrill={d.drillTo} onOpenSource={p.onOpenSource} onClose={d.closeCode} onOut={out} hover={d.hoverRef} pane
            toast={toast.show} onSelect={onSelect} followCode={d.followCode} onHomeTab={d.clearAcross} facts={d.facts} inside={d.inside}
            onSimulate={dock.onSimulate} onRestructure={dock.onRestructure} onHide={d.hide} compare={dock.compare} readerAt={surface.readSourceAt}
            files={d.codeTarget ? { home: (zoom.code?.target ?? d.markTarget)?.path ?? d.codeTarget.path, across: d.acrossTarget?.path ?? null } : undefined}
        />
    );
    const onHoverRow = (key: string | null) => bus.setHover(key ? bus.slotOf(key) : -1);
    const pane = !d.visible ? null : (
        <CodePane
            labels={p.labels} say={say} onHide={d.hide} note={surface.readSource ? undefined : t.levelNoSource} narrow={!d.split} source={reading}
            tree={{
                ancestors: depthCrumbs(drill.stack, null, p.labels.surface.depth), onClimb: drill.climb, stations: map.stations.stations, keyOf: map.keyOfStation, types: d.types,
                facts: d.facts, selected, canEnter: (id) => drill.canEnter(id).can, onSelect, onEnter: zoom.zoomInto, onHover: onHoverRow,
            }}
        />
    );
    const code = {
        pane, visible: d.visible, split: d.split, reading: d.reading, show: d.visible ? undefined : dock.onToggleCode, hide: d.hide,
        bar: d.reading ? (
            <CodeTrail
                stack={drill.stack} onClimb={drill.climb} methods={zoom.trail} onMethod={zoom.codeBack} onLeaveCode={zoom.leaveCode} across={d.acrossTarget?.ref ?? null}
                follow={reader.follow} onFollow={d.toggleFollow} onOut={out} labels={p.labels}
            />
        ) : null,
    };
    const status = d.reading ? <StatusStrip labels={p.labels} band={zoom.band} follow={reader.follow} path={d.codeTarget?.path ?? null} line={reader.line} /> : null;
    return {
        map, zoom, selected, onSelect, onDrill, onOut: out, onEscape, clearSelection, dismissed, wheelStep, toBand, method: methodTarget?.ref ?? null, patchMap, card, code, status,
    };
}

/** The band's symbols being read (the lazy load on entering the class band), in the existing words. */
function ZoomLoading({ text }: { text: string }) {
    return (
        <div role="status" data-zoom-loading style={{ position: 'absolute', zIndex: 2, left: 8, top: 8, padding: '2px 8px', borderRadius: 6, background: cssVar('panel'), color: cssVar('muted'), ...TYPE.meta }}>
            {text}
        </div>
    );
}
