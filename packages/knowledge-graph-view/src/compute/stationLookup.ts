/**
 * The part of the station model two tasks read (`pathOfStations`, `groupAntiPatterns`): the file → station map and each
 * station's name and layer. The main thread slims a model to it for the wire; the worker presents it to the pure functions,
 * which are typed over the whole model but touch only these fields.
 */

import type { StationLookup } from './protocol';
import type { StationModel } from '../surface/stations';

const held = new WeakMap<object, StationLookup>();

export function lookupOf(model: Pick<StationModel, 'stationOf' | 'byId'>): StationLookup {
    let lookup = held.get(model);
    if (!lookup) {
        lookup = { stationOf: model.stationOf, byId: new Map([...model.byId].map(([id, s]) => [id, { id: s.id, name: s.name, ...(s.layer ? { layer: s.layer } : {}) }] as const)) };
        held.set(model, lookup);
    }
    return lookup;
}

/** The lookup as the model type the pure functions ask for. They read `stationOf` and `byId` names and layers only. */
export const modelOf = (lookup: StationLookup): Pick<StationModel, 'stationOf' | 'byId'> => lookup as unknown as Pick<StationModel, 'stationOf' | 'byId'>;
