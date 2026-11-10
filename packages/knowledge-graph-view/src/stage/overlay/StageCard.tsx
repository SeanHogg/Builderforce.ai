/**
 * The station card on the stage (PRD 43 B3 Cards, B7): the map's own `StationCard` and `buildCard`, anchored to the
 * station's SLOT with `useSlotAnchor` (its transform written from the frame loop, no React commit per frame), kept
 * clear of the unfolded satellites. Its actions run on the stage: Go inside is the semantic zoom's shortcut (`onEnter`:
 * the camera flies into the station and the zoom crossing drills — the level's slots appended and tweened out of it), Unfold patches the placement, Who calls / API / Patterns hand over to the surface. Closing it — Escape,
 * a press outside, an action — returns focus to the station's a11y proxy; a station that leaves the stage closes it.
 * Reads only main-thread data (the stations, the graph's index and findings).
 */

import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { nodeIndex } from '../../graphModel';
import type { KnowledgeGraphLabels } from '../../labels';
import type { QuestionId } from '../../surface/questions';
import { OTHER_LAYER } from '../../surface/transitLayout';
import { buildCard } from '../../surface/transit/cardModel';
import type { Rect } from '../../surface/transit/cardPlacement';
import { StationCard } from '../../surface/transit/StationCard';
import { bandTitle } from '../../surface/bands';
import type { DrillModel } from '../../surface/transit/useDrill';
import { useStageBus } from '../anchor/stageBus';
import { useSlotAnchor } from '../anchor/useSlotAnchor';
import { satelliteKeys } from '../drill/unfold';
import type { StageMap } from '../drill/useStageMap';
import { focusProxy } from '../StageProxies';
import type { Placement } from '../types';

export interface StageCardProps {
    /** The open card's slot key (a station at the current level); null = no card. */
    cardKey: string | null;
    map: StageMap;
    drill: DrillModel;
    graph: KnowledgeGraph;
    labels: KnowledgeGraphLabels;
    compact: boolean;
    onClose(): void;
    onQuestion?: ((id: QuestionId) => void) | undefined;
    onOpenPanel?: ((id: string) => void) | undefined;
    /** Go inside as the semantic zoom's shortcut (B1a rule 9: fly to the station, the zoom enters it); absent = drill directly. */
    onEnter?: ((stationId: string) => void) | undefined;
}

const NO_ENTER = { can: false, reason: 'deepest' } as const;
const SATELLITE_BOX = 14;

export function StageCard({ cardKey, map, drill, graph, labels, compact, onClose, onQuestion, onOpenPanel, onEnter }: StageCardProps) {
    const bus = useStageBus();
    const ref = useRef<HTMLDivElement | null>(null);
    const index = useMemo(() => nodeIndex(graph), [graph]);
    const findings = useMemo(() => new Map(graph.findings.map((f) => [f.id, f] as const)), [graph]);
    const station = map.stationOfKey(cardKey);
    const unfolded = !!station && map.unfolded === station.id;

    // Keep clear of the unfolded satellites, where they are on screen now. Their slots are found once per placement;
    // each frame only projects them.
    const avoid = useMemo(() => {
        const s = station && unfolded ? station : null;
        const out = new Float64Array(2);
        let held: { of: Placement; slots: number[] } | null = null;
        return (): Rect[] => {
            const view = bus.projector, p = bus.placement;
            if (!s || !view || !p) return [];
            if (held?.of !== p) held = { of: p, slots: satelliteKeys(s, index, (k) => bus.slotOf(k)).map(({ key }) => bus.slotOf(key)).filter((slot) => slot >= 0) };
            return held.slots.flatMap((slot) => {
                if (!view.project(p.position[slot * 3]!, p.position[slot * 3 + 1]!, p.position[slot * 3 + 2]!, out)) return [];
                return [{ left: out[0]! - SATELLITE_BOX, top: out[1]! - SATELLITE_BOX, width: SATELLITE_BOX * 2, height: SATELLITE_BOX * 2 }];
            });
        };
    }, [bus, station, unfolded, index]);
    const { missing } = useSlotAnchor(station ? cardKey : null, ref, { avoid });

    const close = useCallback(() => {
        onClose();
        if (cardKey) focusProxy(bus, cardKey);
    }, [onClose, bus, cardKey]);
    useEffect(() => { if (station && missing) onClose(); }, [station, missing, onClose]);
    if (!station || !cardKey) return null;

    const act = (run: () => void) => { run(); close(); };
    const card = buildCard({
        station, stations: map.stations.stations, labels, layerName: bandTitle(station.layer ?? OTHER_LAYER, labels), findings, index,
        enter: drill.canEnter?.(station.id) ?? NO_ENTER, satellites: map.satellites(station), unfolded, leaf: drill.view?.leaves.has(station.id) ?? false,
    });
    return (
        <StationCard
            key={station.id} card={card} labels={labels} compact={compact} at={{ left: 0, top: 0 }}
            boxRef={ref as MutableRefObject<HTMLDivElement | null>} loading={drill.loading} onClose={close}
            onEnter={() => { onClose(); focusProxy(bus, cardKey); (onEnter ?? drill.enter)(station.id); }}
            onUnfold={() => map.toggleUnfold(station.id)}
            onCallers={() => act(() => onQuestion?.('callers'))}
            onApi={() => act(() => onOpenPanel?.('api'))}
            onPatterns={() => act(() => onOpenPanel?.('patterns'))}
        />
    );
}
