/** The placement task's request (PRD 43 B1a, `TaskTable.placement`) and the viewport bands it is cached by. Types + data only. */

import type { GraphId, ModelInputs } from '../../protocol';
import type { PlacementCamera } from '../../../stage/types';
import type { Bindings } from '../../../surface/overlays';
import type { DrillFrame } from '../../../surface/transit/drillView';
import type { SymbolRecord } from '../../../types';

/**
 * Viewport widths a placement is laid out for: the stage re-places only when the width crosses a band (rule 6), never on
 * a scrollbar wobble. `viewportBand` indexes this.
 */
export const VIEWPORT_BANDS: readonly number[] = [360, 640, 960, 1280, 1600, 1920, 2560];

export function viewportBandOf(width: number): number {
    let band = 0;
    while (band < VIEWPORT_BANDS.length - 1 && VIEWPORT_BANDS[band + 1]! <= width) band++;
    return band;
}

export interface PlacementReq {
    graph: GraphId;
    generation: number;
    camera: PlacementCamera;
    drill: string | null;
    unfolded: string | null;
    pins: readonly string[];
    pathId: string | null;
    viewportBand: number;
    lod: number;
    /** 0 = the flat home view; 1 = fully tilted (Map: each station extruded into its tower, rule 7). */
    depth?: number;
    /**
     * The overlay's channel bindings, as data: the geometry channels read here — `size` (a station's mark radius and its
     * tower height) and `width` (a route's line width). Absent = every channel off (the neutral size and width).
     */
    channels?: PlacementChannels;
    /**
     * The definitions the host has read so far (`useDrill`'s records): a drilled class / function level places them as
     * appended slots (`Placement.append`). Append-only, so an appended symbol keeps its slot from request to request.
     */
    symbols?: readonly SymbolRecord[];
    /** The stage model's inputs (`protocol.ts` `ModelInputs`), copied in by the codec: any realm builds the same model. */
    model?: ModelInputs;
}

/** `drill` names the innermost drill frame as `<level>:<ref>` (a ref may hold ':' itself; the first one splits). */
export const drillKeyOf = (frame: Pick<DrillFrame, 'level' | 'ref'> | null | undefined): string | null => (frame ? `${frame.level}:${frame.ref}` : null);

export function drillFrameOf(key: string | null): Pick<DrillFrame, 'level' | 'ref'> | null {
    if (!key) return null;
    const at = key.indexOf(':');
    const level = key.slice(0, at);
    return at > 0 && (level === 'package' || level === 'class' || level === 'function') ? { level, ref: key.slice(at + 1) } : null;
}

/** The overlay channels that move geometry (the rest are paint, `markPaint`). */
export type PlacementChannels = Pick<Bindings, 'size' | 'width'>;

export const NO_CHANNELS: PlacementChannels = Object.freeze({ size: 'none', width: 'none' });

/** The full `Bindings` `makeOverlay` reads, with every paint channel off: a placement only reads size and width. */
export const channelBindings = (c: PlacementChannels = NO_CHANNELS): Bindings =>
    ({ colour: 'none', ring: 'none', pulse: 'none', outline: 'none', pins: 'off', size: c.size, width: c.width });

/**
 * The key a placement is cached under (B1a rule 6). `build` names the MarkSet build it was placed for — its generation,
 * which is unique per (graph, changed, localized strings digest) — so the main thread can name a request it has not
 * sent yet (`codecs/stage.ts` keeps answers under it) and a locale change misses. Then everything the layout reads.
 */
export const placementCacheKey = (build: string, r: PlacementReq): string => {
    const c = r.channels ?? NO_CHANNELS;
    return [build, r.camera, r.drill ?? '', r.unfolded ?? '', r.pathId ?? '', r.viewportBand, r.lod, r.depth ?? 0, c.size, c.width, r.drill || r.camera === 'sequence' ? r.symbols?.length ?? 0 : 0].join('|');
};

/** The key a placement builder stamps on its answer: {@link placementCacheKey} under the MarkSet build it placed. */
export const placementKeyOf = (marks: { generation: number }, r: PlacementReq): string => placementCacheKey(String(marks.generation), r);
