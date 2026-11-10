/**
 * What a stage camera wires to the surface (PRD 43 B5, B7): selection (a station opens its card and selects it on the
 * surface or in the drilled level; a node selects its ref), the card, the Map's drill and unfold (`useStageMap`), the
 * ranked incident index (asked for ONCE per graph and handed to the stage bus, so a selection slices it on the main
 * thread), the selected line as the path highlight, and Escape / Backspace "Out" of a drilled level.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CallSite } from '@seanhogg/builderforce-memory/knowledge';
import { useComputed } from '../../compute/useComputed';
import { COMPACT_WIDTH, nodeIndex } from '../../graphModel';
import type { SceneProps } from '../../surface/registry';
import { stageBus, StageBusContext } from '../anchor/stageBus';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';
import { CodeLayer } from '../drill/CodeLayer';
import { useSemanticZoom, type SemanticZoom } from '../drill/useSemanticZoom';
import { useStageMap, type StageMap } from '../drill/useStageMap';
import type { StageRenderer } from '../renderer';
import type { MarkSet, Placement } from '../types';
import { SlotIncident } from './incident';
import { CallSiteCard } from './CallSiteCard';
import { StageCard } from './StageCard';

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
    const card = (
        <StageBusContext.Provider value={bus}>
            <StageCard
                cardKey={cardKey} map={map} drill={drill} graph={graph} labels={p.labels} compact={width > 0 && width < COMPACT_WIDTH}
                onClose={closeCard} onQuestion={surface.setQuestion} onOpenPanel={surface.openPanel} onEnter={zoom.zoomInto}
            />
            {site && <CallSiteCard site={site.site} at={site.at} boxWidth={width} labels={p.labels} onOpenSource={p.onOpenSource} onClose={closeSite} />}
            {zoom.code && (
                <CodeLayer
                    key={zoom.code.key} slotKey={zoom.code.key} target={zoom.code.target} reader={surface.readSource}
                    labels={p.labels} onOpenSource={p.onOpenSource} onClose={zoom.closeCode}
                />
            )}
            {drill.loading && zoom.band !== 'system' && <ZoomLoading text={p.labels.surface.map.card.loading} />}
        </StageBusContext.Provider>
    );
    return { map, zoom, selected, onSelect, onOut: drill.canOut ? drill.out : undefined, patchMap, card };
}

/** The band's symbols being read (the lazy load on entering the class band), in the existing words. */
function ZoomLoading({ text }: { text: string }) {
    return (
        <div role="status" data-zoom-loading style={{ position: 'absolute', zIndex: 2, left: 8, top: 8, padding: '2px 8px', borderRadius: 6, background: cssVar('panel'), color: cssVar('muted'), ...TYPE.meta }}>
            {text}
        </div>
    );
}
