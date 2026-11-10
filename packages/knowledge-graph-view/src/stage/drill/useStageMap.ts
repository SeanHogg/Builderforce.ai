/**
 * The Map's drill and unfold on the stage (PRD 43 B7), on the surface's ONE drill (`useDrill`): the level's frame
 * becomes the placement request's `drill` (with the definitions read so far, for the appended symbol slots), and the
 * unfolded station becomes a main-thread placement patch. Keys ↔ stations at the current level, so a card, a selection
 * and focus return all name the same slot: a world station is `st:<id>`; inside a level a member is its node's slot
 * (`node:<ref>`) and a neighbour (leaf) its world station's (`st:<id>`).
 */

import { useCallback, useMemo, useState } from 'react';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { drillKeyOf } from '../../compute/tasks/placement/request';
import type { Station, StationModel } from '../../surface/stations';
import type { DrillModel } from '../../surface/transit/useDrill';
import type { Placement } from '../types';
import { satelliteKeys, unfoldPatch } from './unfold';

export interface StageMap {
    /** The placement request's `drill` (`<level>:<ref>`), null on the world map. */
    drill: string | null;
    symbols: DrillModel['symbols'];
    /** The stations of the level on show. */
    stations: StationModel;
    stationOfKey(key: string | null): Station | null;
    keyOfStation(s: Station): string;
    unfolded: string | null;
    toggleUnfold(stationId: string): void;
    /** How many satellites unfolding `s` would show. */
    satellites(s: Station): number;
    /** The placement with the unfolded station's satellites shown (the same placement when nothing is unfolded). */
    patch(p: Placement): Placement;
}

export function useStageMap(world: StationModel, drill: DrillModel, index: ReadonlyMap<string, KNode>, slotOf: (key: string) => number): StageMap {
    const view = drill.view;
    const stations = view?.stations ?? world;
    const top = drill.stack[drill.stack.length - 1];
    const key = drillKeyOf(top);
    const [unfold, setUnfold] = useState<{ level: string | null; id: string } | null>(null);
    // An unfold belongs to the level it was made on.
    const unfolded = unfold && unfold.level === key && stations.byId.has(unfold.id) ? unfold.id : null;

    const keyOfStation = useCallback((s: Station): string => (!view || view.leaves.has(s.id) ? `st:${s.id}` : `node:${s.refs[0] ?? s.id}`), [view]);
    const byKey = useMemo(() => new Map(stations.stations.map((s) => [keyOfStation(s), s] as const)), [stations, keyOfStation]);
    const stationOfKey = useCallback((k: string | null) => (k ? byKey.get(k) ?? null : null), [byKey]);
    const toggleUnfold = useCallback((id: string) => setUnfold((cur) => (cur && cur.id === id && cur.level === key ? null : { level: key, id })), [key]);
    const satellites = useCallback((s: Station) => satelliteKeys(s, index, slotOf).length, [index, slotOf]);

    const patch = useCallback((p: Placement): Placement => {
        const s = unfolded ? stations.byId.get(unfolded) : undefined;
        if (!s) return p;
        return unfoldPatch(p, slotOf(keyOfStation(s)), satelliteKeys(s, index, slotOf), slotOf);
    }, [unfolded, stations, index, slotOf, keyOfStation]);

    return { drill: key, symbols: drill.symbols, stations, stationOfKey, keyOfStation, unfolded, toggleUnfold, satellites, patch };
}
