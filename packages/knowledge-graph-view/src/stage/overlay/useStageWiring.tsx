/**
 * What a stage camera wires to the surface (PRD 43 B5, B7): selection (a station opens its card and selects it on the
 * surface or in the drilled level; a node selects its ref), the card, the Map's drill and unfold (`useStageMap`), the
 * ranked incident index (asked for ONCE per graph and handed to the stage bus, so a selection slices it on the main
 * thread), the selected line as the path highlight, and Escape / Backspace "Out" (of a callee opened across, the code
 * level, then a drilled level).
 *
 * The code (B1a rule 9): the code pane opens from a mark's Code button and with the code level, beside the map
 * (`code`: the split layout, `codePaneWidth`). What it reads (`useCodeReading`) drives the map side: the reading ring
 * and the open method's numbered call arcs on the stage (`bus.reading`, `bus.calls`), the call numbers (`CallBadges`),
 * the step card and the zoom-path bar (`CodeTrail`). A callee drilled into opens the code level on it, or, with no mark
 * of its own at this level, its file in the pane while the map reveals its file.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CallSite } from '@seanhogg/builderforce-memory/knowledge';
import { useComputed } from '../../compute/useComputed';
import { COMPACT_WIDTH, nodeIndex } from '../../graphModel';
import type { SceneProps } from '../../surface/registry';
import { stageBus, StageBusContext } from '../anchor/stageBus';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';
import { codeTargetOf, fileTargetOf } from '../drill/codeText';
import { useCodeReading } from '../drill/useCodeReading';
import { CallBadges } from './CallBadges';
import { callTrackOf, markOf } from './callArcs';
import { CodeDock, codePaneWidth, codeRefForStop, codeSubject, focusLine, recordsForCode, targetForMark } from './CodeDock';
import { CodeTrail } from './CodeTrail';
import { StepCard } from './StepCard';
import { useSemanticZoom, type SemanticZoom } from '../drill/useSemanticZoom';
import { useStageMap, type StageMap } from '../drill/useStageMap';
import type { StageRenderer } from '../renderer';
import type { MarkSet, Placement } from '../types';
import { SlotIncident } from './incident';
import { CallSiteCard } from './CallSiteCard';
import { StageCard } from './StageCard';
import { MarkCodeButton } from './MarkCodeButton';
import type { SymbolRecord } from '../../types';

/** The code dock's records while it is closed: none, and the same array every render. */
const NO_RECORDS: readonly SymbolRecord[] = [];

export interface StageWiring {
    map: StageMap;
    /** The semantic zoom: the Map's band, the Sequence's `lod`, Go inside as a zoom, the code layer. */
    zoom: SemanticZoom;
    selected: string | null;
    onSelect(key: string): void;
    onOut: (() => void) | undefined;
    /** The Map placement with the unfold patch applied (memoized: the same placement in, the same out). */
    patchMap(p: Placement | null): Placement | null;
    card: ReactNode;
    /** While the code is open: the pane, the bar over the map, and whether the pane sits beside the map (else it floats over it). */
    code: { pane: ReactNode; bar: ReactNode; split: boolean } | null;
}

export function useStageWiring(p: SceneProps, renderer: StageRenderer, marks: MarkSet | null, width: number): StageWiring {
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
    const [codeOpen, setCodeOpen] = useState(false);

    // The ranked incident index, once per graph; the selected line is the path the overlay highlights.
    const generation = marks?.generation ?? 0;
    const incident = useComputed('stageIncident', { graph, generation }, [graph, generation], null, { enabled: !!marks }).value;
    const stops = drill.view ? null : surface.line?.stops ?? null;
    // A route pick selects its line, as the SVG map's hop does (`TransitCamera`: on the world map only); the path
    // highlight then follows the selected line's stops.
    // A Sequence message pick (its batch names the call site) opens the call-site card instead.
    const selectLine = surface.selectLine;
    const [site, setSite] = useState<{ site: CallSite; at: { x: number; y: number } } | null>(null);
    const onLink = useCallback((hit: { line: string | null; site: CallSite | null }, at: { x: number; y: number }) => {
        if (hit.site) { setCardKey(null); setSite({ site: hit.site, at }); return; }
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
        setSite(null);
        const station = map.stationOfKey(key);
        setCardKey(station ? key : null);
        if (station) { if (drill.view) drill.select(station.id); else surface.selectStation(station.id); return; }
        if (key.startsWith('node:')) p.onSelect(key.slice('node:'.length));
    }, [map, drill, surface, p]);

    const patched = useMemo(() => new WeakMap<Placement, Placement>(), [map.patch, zoom.nest]);
    const patchMap = useCallback((pl: Placement | null) => {
        if (!pl) return null;
        let out = patched.get(pl);
        if (!out) { out = zoom.nest(map.patch(pl)); patched.set(pl, out); }
        return out;
    }, [patched, map, zoom]);

    const closeCard = useCallback(() => setCardKey(null), []);
    const openCode = useCallback(() => setCodeOpen(true), []);
    // The code level opens the pane too: there the code is the primary view, beside the map.
    const showCode = codeOpen || !!zoom.code;
    const split = codePaneWidth(width) > 0;
    // The map's own width (a split box gives the pane the rest).
    const mapWidth = showCode ? width - codePaneWidth(width) : width;
    // A pointer hovering a mark while the pane is open tints that symbol's lines.
    const [hoverRef, setHoverRef] = useState<string | null>(null);
    useEffect(() => showCode ? bus.onHover((slot) => {
        const k = slot >= 0 ? bus.keys[slot] : undefined;
        setHoverRef(k?.startsWith('node:') ? k.slice('node:'.length) : null);
    }) : undefined, [bus, showCode]);
    // A callee in another file the zoom cannot open (no mark of its own at this level): the pane reads its file, from it.
    const [across, setAcross] = useState<string | null>(null);
    const clearAcross = useCallback(() => setAcross(null), []);
    // A new method at the code level drops the callee opened across and the old pick (it must not jump inside the new one).
    useEffect(() => { setAcross(null); setSelected(null); }, [zoom.code?.key]);
    // Only while the code is open: the fallback walks every graph node on the main thread, and `drill` is a fresh
    // object each render, so keying on it re-walked the graph on every render of every stage view (the perf gate's mount reads).
    const drillSymbols = drill.symbols;
    const records = useMemo(() => showCode ? recordsForCode(graph, { symbols: drillSymbols }) : NO_RECORDS, [showCode, graph, drillSymbols]);
    const acrossTarget = across ? codeTargetOf(across, records) : null;
    // The method whose calls are numbered: the one opened across, else the code level's.
    const methodTarget = acrossTarget ?? zoom.code?.target ?? null;
    const methodRef = methodTarget?.ref ?? null;
    // A station key is not a symbol. Resolve it to the station's first file so the pane has a source line and the station's name.
    const stationPick = selected?.startsWith('st:') ? map.stationOfKey(selected) : null;
    const subject = codeSubject(selected, stationPick);
    const markRef = subject.ref;
    // A journey stop id is a station id. Resolve it the same way; selection still wins when both name a line.
    const stop = surface.path?.stops[surface.step];
    const stopStation = stop ? surface.stations.byId.get(stop.id) ?? map.stations.byId.get(stop.id) ?? null : null;
    const stopRef = codeRefForStop(stop?.id ?? null, stopStation);
    // At the code level the pane reads the open method; else the selected mark, else the journey stop.
    const dockRef = methodRef ?? markRef ?? stopRef;
    const codeName = subject.name || (dockRef === stopRef && stopStation ? stopStation.name : '') || (dockRef ? index.get(dockRef)?.label ?? dockRef : '');
    // The pane reads the whole file; the mark's own line is `scrollLine`, so another method in the same file only scrolls it.
    const markTarget = showCode ? (methodTarget ?? targetForMark(dockRef, codeName, records)) : null;
    const codeTarget = markTarget ? fileTargetOf(markTarget) : null;
    const scrollLine = showCode ? (methodTarget?.startLine ?? focusLine(records, markRef, stopRef)) : undefined;
    // Code scrolled onto another symbol: the stage rings and centres its mark (else its file's), without selecting it;
    // selection would scroll the code back (`scrollLine`).
    const followCode = useCallback((ref: string) => {
        const slot = markOf(ref, (k) => bus.slotOf(k));
        bus.setReading(slot);
        if (slot >= 0) bus.reveal(slot);
    }, [bus]);
    const reading = useCodeReading({ path: codeTarget?.path, records, method: methodRef, scrollLine, pick: zoom.code ? markRef : null, onFocusSymbol: followCode });
    // The open method's calls on the stage, resolved again on every placement (a band crossed, a drill) so the arcs stay on their marks.
    const { steps, current } = reading;
    useEffect(() => {
        const push = () => bus.setCalls(callTrackOf(showCode ? methodRef : null, steps, current, (k) => bus.slotOf(k)));
        push();
        return bus.onPlacement(push);
    }, [bus, showCode, methodRef, steps, current]);
    // Nothing read: no reading ring.
    useEffect(() => { if (!showCode) bus.setReading(-1); }, [bus, showCode]);
    // Out, innermost first: back from a callee opened across, out of the code level, out of a drilled level.
    const out = across ? clearAcross : zoom.code ? zoom.closeCode : drill.canOut ? drill.out : undefined;
    // Closing the pane leaves the code level too.
    const leaveCode = zoom.leaveCode;
    const atCode = !!zoom.code;
    const closeCode = useCallback(() => { setCodeOpen(false); setHoverRef(null); setAcross(null); if (atCode) leaveCode(); }, [atCode, leaveCode]);
    // A method name in the code (or "Into") opens the code level on it when the zoom can; a loaded callee with no mark
    // here opens its file in the pane (the stage follows its reading line there); anything else selects the mark, as before.
    const enterCode = zoom.enterCode;
    const drillTo = useCallback((ref: string) => {
        if (enterCode(ref)) { setAcross(null); return; }
        if (atCode && codeTargetOf(ref, records)) { setAcross(ref); return; }
        setSelected(`node:${ref}`);
        p.onSelect(ref);
    }, [p, enterCode, atCode, records]);
    const card = (
        <StageBusContext.Provider value={bus}>
            <StageCard
                cardKey={cardKey} map={map} drill={drill} graph={graph} labels={p.labels} compact={mapWidth > 0 && mapWidth < COMPACT_WIDTH}
                onClose={closeCard} onQuestion={surface.setQuestion} onOpenPanel={surface.openPanel} onEnter={zoom.zoomInto}
                onCode={openCode}
            />
            {/* A selected file or symbol mark gets its own Code button; stations have it on their card, and the open pane shows code already. */}
            <MarkCodeButton
                slotKey={selected?.startsWith('node:') && !cardKey && !showCode ? selected : null}
                name={codeName} labels={p.labels} onCode={openCode}
            />
            {site && <CallSiteCard site={site.site} at={site.at} boxWidth={mapWidth} labels={p.labels} onOpenSource={p.onOpenSource} onClose={closeSite} />}
            {showCode && <CallBadges labels={p.labels} onStep={reading.goStep} />}
            {showCode && methodTarget && (
                <StepCard method={methodTarget} reading={reading} records={records} labels={p.labels} onDrill={drillTo} onOut={out} side={split ? 'right' : 'left'} />
            )}
            {drill.loading && zoom.band !== 'system' && <ZoomLoading text={p.labels.surface.map.card.loading} />}
        </StageBusContext.Provider>
    );
    const code = showCode ? {
        split,
        pane: (
            <CodeDock
                target={codeTarget} name={codeName} reader={surface.readSource} labels={p.labels} records={records} scrollLine={scrollLine}
                reading={reading} onDrill={drillTo} onOpenSource={p.onOpenSource} onClose={closeCode} onOut={out} hover={hoverRef} pane={split}
            />
        ),
        bar: (
            <CodeTrail
                stack={drill.stack} onClimb={drill.climb} methods={zoom.trail} onMethod={zoom.codeBack} onLeaveCode={leaveCode} across={acrossTarget?.ref ?? null}
                follow={reading.follow} onFollow={reading.toggleFollow} onOut={out} labels={p.labels}
            />
        ),
    } : null;
    return { map, zoom, selected, onSelect, onOut: out, patchMap, card, code };
}

/** The band's symbols being read (the lazy load on entering the class band), in the existing words. */
function ZoomLoading({ text }: { text: string }) {
    return (
        <div role="status" data-zoom-loading style={{ position: 'absolute', zIndex: 2, left: 8, top: 8, padding: '2px 8px', borderRadius: 6, background: cssVar('panel'), color: cssVar('muted'), ...TYPE.meta }}>
            {text}
        </div>
    );
}
