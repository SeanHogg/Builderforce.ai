/**
 * The code dock's wiring (PRD 43 B1a rule 9, Part C1), moved out of `useStageWiring`: when the pane is docked, what it
 * reads and what that drives on the map.
 *
 * Two states, not one. DOCKED is the pane on the left (the outline of the level, from the stations the stage already has).
 * READING is a file open in it (the Code button, the code band, the editor's Follow): only then do the records walk
 * (`needRecords`), the call arcs and badges, the hover tint, the fade, the reading ring and the status strip turn on.
 * A docked pane alone costs none of them.
 *
 * What the pane reads (`useCodeReading`) drives the map side: the reading ring and the open method's numbered call arcs
 * (`bus.reading`, `bus.calls`), and the fade of what the code on screen does not light. A callee drilled into opens the
 * code level on it, or, with no mark of its own at this level, its file in the pane while the map reveals its file.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { nodeIndex, pathOf } from '../../graphModel';
import type { SceneProps } from '../../surface/registry';
import { fileRefOf } from '../../surface/stations';
import { symbolFacts, type SymbolFacts } from '../../surface/symbolFacts';
import { stationTypes } from '../../surface/transit/stationType';
import type { MarkType } from '../../shapes';
import type { SymbolRecord } from '../../types';
import type { StageBus } from '../anchor/stageBus';
import { codeTargetOf, fileTargetOf, symbolChain, type CodeTarget } from '../drill/codeText';
import { useCodeReading, type CodeReading } from '../drill/useCodeReading';
import type { SemanticZoom } from '../drill/useSemanticZoom';
import type { StageMap } from '../drill/useStageMap';
import { callTrackOf, markOf } from './callArcs';
import { codePaneWidth, codeRefForStop, codeSubject, focusLine, recordsForCode, targetForMark } from './CodeDock';
import { INCIDENT_SHOWN } from './incident';

/** The code dock's records while nothing is read: none, and the same array every render. */
const NO_RECORDS: readonly SymbolRecord[] = [];

export interface CodeDockInput {
    p: SceneProps;
    bus: StageBus;
    map: StageMap;
    zoom: SemanticZoom;
    selected: string | null;
    setSelected(key: string | null): void;
    /** A station's card is open (a station keeps its card; the symbol card is for nodes). */
    cardKey: string | null;
    toast(message: string): void;
    /** The stage box's width: the dock splits beside the map from `SPLIT_MIN_PX`. */
    width: number;
    slotOf(key: string): number;
    /** The pane is shown (the per-viewer `code` slot of `usePanelVisibility`); reading shows it regardless. */
    shown: boolean;
    /** Flip `shown`. */
    onToggle?: (() => void) | undefined;
    /** The Sequence camera is on show: it draws the open method's calls itself, so the numbered call arcs stay off. */
    sequence?: boolean | undefined;
    /** The graph the facts read when it is not `p.graph` (a comparison's shown side; `p.graph` is then the union). */
    factsGraph?: KnowledgeGraph | null | undefined;
}

export interface CodeDockModel {
    /** A file is open in the pane (or the code band): the records walk, call arcs, tint, fade, ring and status are on. */
    reading: boolean;
    /** The pane is shown at all (docked, or read). */
    visible: boolean;
    /** The pane sits beside the map (a wide box); else it is one half of the Code | Picture switch. */
    split: boolean;
    /** The map's own width. */
    mapWidth: number;
    facts: SymbolFacts;
    /** The symbol whose level you are inside (the open method, else the drilled level's): its lens shows Out. */
    inside: string | null;
    types: ReadonlyMap<string, MarkType>;
    records: readonly SymbolRecord[];
    reader: CodeReading;
    codeTarget: CodeTarget | null;
    markTarget: CodeTarget | null;
    acrossTarget: CodeTarget | null;
    methodTarget: CodeTarget | null;
    codeName: string;
    scrollLine: number | undefined;
    hoverRef: string | null;
    followCode(ref: string): void;
    clearAcross(): void;
    /** A node is selected with no station card: the symbol card reads its record. */
    nodeSelected: boolean;
    openCode(): void;
    closeCode(): void;
    /** Hide the pane: leaves the reading too. */
    hide(): void;
    drillTo(ref: string): void;
    toggleFollow(): void;
    /** Out, innermost first: back from a callee opened across, out of the code level, out of a drilled level. */
    out: (() => void) | undefined;
}

export function useCodeDock(a: CodeDockInput): CodeDockModel {
    const { p, bus, map, zoom, selected, setSelected, cardKey, toast, width, slotOf, shown, onToggle, sequence = false } = a;
    const { surface, graph } = p;
    const drill = surface.drill;
    const index = useMemo(() => nodeIndex(graph), [graph]);
    const t = p.labels.surface.code;
    const [codeOpen, setCodeOpen] = useState(false);
    // The pane opens as a reading with the code level too: there the code is the primary view, beside the map.
    const reading = codeOpen || !!zoom.code;
    const visible = shown || reading;
    const split = visible && codePaneWidth(width) > 0;
    const mapWidth = split ? width - codePaneWidth(width) : width;
    // Computed once per graph: the lens rows, the gutter and the outline's marks all read it.
    // While comparing, the graph is the union (both sides' findings): the facts read the shown side's own graph.
    const factsGraph = a.factsGraph ?? graph;
    const facts = useMemo(() => symbolFacts(factsGraph, surface.stations), [factsGraph, surface.stations]);
    const top = drill.stack[drill.stack.length - 1];
    const inside = zoom.code?.target.ref ?? top?.ref ?? null;
    // The level tree is always drawn in the pane, and the cards name their shape from it.
    const types = useMemo(() => stationTypes(graph, map.stations, index), [graph, map.stations, index]);

    // A pointer hovering a mark while the code is read tints that symbol's lines.
    const [hoverRef, setHoverRef] = useState<string | null>(null);
    useEffect(() => reading ? bus.onHover((slot) => {
        const k = slot >= 0 ? bus.keys[slot] : undefined;
        setHoverRef(k?.startsWith('node:') ? k.slice('node:'.length) : null);
    }) : undefined, [bus, reading]);
    // A callee in another file the zoom cannot open (no mark of its own at this level): the pane reads its file, from it.
    const [across, setAcross] = useState<string | null>(null);
    const clearAcross = useCallback(() => setAcross(null), []);
    // A new method at the code level drops the callee opened across and the old pick (it must not jump inside the new one).
    useEffect(() => { setAcross(null); setSelected(null); }, [zoom.code?.key, setSelected]);
    // Only while reading: the fallback walks every graph node on the main thread, and `drill` is a fresh object each
    // render, so keying on it re-walked the graph on every render of every stage view (the perf gate's mount reads).
    const drillSymbols = drill.symbols;
    // The symbol card needs them too, for a selected node with the pane closed.
    const nodeSelected = !!selected?.startsWith('node:') && !cardKey;
    const needRecords = reading || nodeSelected;
    const records = useMemo(() => needRecords ? recordsForCode(graph, { symbols: drillSymbols }) : NO_RECORDS, [needRecords, graph, drillSymbols]);
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
    const markTarget = reading ? (methodTarget ?? targetForMark(dockRef, codeName, records)) : null;
    const codeTarget = markTarget ? fileTargetOf(markTarget) : null;
    const scrollLine = reading ? (methodTarget?.startLine ?? focusLine(records, markRef, stopRef)) : undefined;
    // Code scrolled onto another symbol: the stage rings and centres its mark (else its file's), without selecting it;
    // selection would scroll the code back (`scrollLine`).
    const followCode = useCallback((ref: string) => {
        const slot = markOf(ref, (k) => bus.slotOf(k));
        bus.setReading(slot);
        if (slot >= 0) bus.reveal(slot);
    }, [bus]);
    const reader = useCodeReading({ path: codeTarget?.path, records, method: methodRef, scrollLine, pick: zoom.code ? markRef : null, onFocusSymbol: followCode });
    // The host's editor, while Follow is on: the LOCATION follows it (the editor's file is selected, never at the code level,
    // whose method holds the pane) and a pane already reading that file scrolls with it, so the stage follows the real editor
    // through the pane's own reading line. Following never starts reading (the records walk, fade and ring): the person opens a file.
    const editor = surface.editorView ?? null;
    const editorPath = editor?.path ?? null;
    const editorFileRef = useMemo(
        () => editorPath ? graph.nodes.find((n) => fileRefOf(n.ref) === n.ref && pathOf(n.ref) === editorPath)?.ref ?? null : null,
        [graph, editorPath],
    );
    const { follow: following, jumpTo } = reader;
    const atCodeLevel = !!zoom.code;
    const panePath = codeTarget?.path ?? null;
    useEffect(() => {
        if (!editor || !following) return;
        if (panePath === editor.path) { jumpTo(editor.firstLine); return; }
        if (!atCodeLevel && editorFileRef) setSelected(`node:${editorFileRef}`);
    }, [editor, following, panePath, atCodeLevel, editorFileRef, jumpTo, setSelected]);
    // The open method's calls on the stage, resolved again on every placement (a band crossed, a drill) so the arcs stay on their marks.
    // The Sequence camera draws those calls itself (raised bars), so the Flow arcs are off there.
    const { steps, current } = reader;
    const arcs = reading && !sequence;
    useEffect(() => {
        const push = () => bus.setCalls(callTrackOf(arcs ? methodRef : null, steps, current, (k) => bus.slotOf(k)));
        push();
        return bus.onPlacement(push);
    }, [bus, arcs, methodRef, steps, current]);
    // What the code on screen lights, the rest fade: the symbols in view, their enclosing symbols and files, and the reading
    // symbol's link neighbours. Only while the pane follows the map's own bands (not the system band or the code level).
    const inView = reader.inView, byRef = reader.byRef;
    const fadeOn = reading && reader.follow && !atCodeLevel && zoom.band !== 'system' && !!inView && inView.length > 0;
    useEffect(() => {
        if (!fadeOn || !inView) { bus.setFade(null); return undefined; }
        const push = () => {
            const lit = new Set<number>();
            const add = (slot: number) => { if (slot >= 0) lit.add(slot); };
            for (const ref of inView) {
                add(markOf(ref, slotOf));
                for (const parent of symbolChain(ref, byRef)) add(markOf(parent.ref, slotOf));
                add(slotOf(`node:${fileRefOf(ref)}`));
            }
            if (bus.reading >= 0) for (const slot of bus.options.incident?.of(bus.reading, INCIDENT_SHOWN) ?? []) add(slot);
            bus.setFade(lit);
        };
        push();
        return bus.onPlacement(push);
    }, [bus, fadeOn, inView, byRef, slotOf]);
    useEffect(() => () => bus.setFade(null), [bus]);
    // Nothing read: no reading ring.
    useEffect(() => { if (!reading) bus.setReading(-1); }, [bus, reading]);
    const out = across ? clearAcross : zoom.code ? zoom.closeCode : drill.canOut ? drill.out : undefined;

    const toggleFollow = useCallback(() => { toast(reader.follow ? t.toastFollowOff : t.toastFollowOn); reader.toggleFollow(); }, [reader, toast, t]);
    // Closing the pane leaves the code level too.
    const leaveCode = zoom.leaveCode;
    const closeCode = useCallback(() => { setCodeOpen(false); setHoverRef(null); setAcross(null); if (atCodeLevel) leaveCode(); }, [atCodeLevel, leaveCode]);
    const hide = useCallback(() => { closeCode(); if (shown) onToggle?.(); }, [closeCode, shown, onToggle]);
    const openCode = useCallback(() => setCodeOpen(true), []);
    // A method name in the code (or "Into") opens the code level on it when the zoom can; a loaded callee with no mark
    // here opens its file in the pane (the stage follows its reading line there); anything else selects the mark, as before.
    const enterCode = zoom.enterCode;
    const onSelectRef = p.onSelect;
    const drillTo = useCallback((ref: string) => {
        if (enterCode(ref)) { setAcross(null); return; }
        if (atCodeLevel && codeTargetOf(ref, records)) { setAcross(ref); return; }
        setSelected(`node:${ref}`);
        onSelectRef(ref);
    }, [onSelectRef, enterCode, atCodeLevel, records, setSelected]);

    return {
        reading, visible, split, mapWidth, facts, inside, types, records, reader, codeTarget, markTarget, acrossTarget, methodTarget, codeName, scrollLine, hoverRef,
        followCode, clearAcross, nodeSelected, openCode, closeCode, hide, drillTo, toggleFollow, out,
    };
}
