/**
 * The link families as DATA (PRD 43 B3, Links): the segment capacity each family's mesh is preallocated with when the
 * stage mounts (so the first placement creates no mesh; only an overflow does), the width unit a family draws in when a
 * batch does not say, and its house style — the transit map's widths and dash patterns. A placement builder reads the
 * style for its batches; the renderer reads the capacity. Worker-safe: data only.
 */

import { DASH_DESCRIBES, DASH_SOLID, DASH_WALL, type LinkBatch, type LinkFamily } from '../types';

export interface LinkFamilyStyle {
    /** Segments preallocated at mount. */
    capacity: number;
    widthUnit: LinkBatch['widthUnit'];
    /** The family's own width and dash (a batch may still vary them per segment: untested hops dash 9/7). */
    width: number;
    dash: number;
}

export const LINK_FAMILY_STYLE: Readonly<Record<LinkFamily, LinkFamilyStyle>> = {
    // Transit / Tower routes scale with the zoom (world); 72 hops × ~20 sampled points on the harness map.
    route: { capacity: 4096, widthUnit: 'world', width: 6, dash: DASH_SOLID },
    // Graph edges are hairlines in screen px; the overview's bundled edges plus the selection's incident ones.
    edge: { capacity: 8192, widthUnit: 'px', width: 1, dash: DASH_SOLID },
    // Doc → code links: crisp 1.5 px, dotted 2/5.
    describes: { capacity: 1024, widthUnit: 'px', width: 1.5, dash: DASH_DESCRIBES },
    // Layer walls: 2.5 px, dashed 5/4.
    wall: { capacity: 256, widthUnit: 'px', width: 2.5, dash: DASH_WALL },
    // Sequence messages and cycle arrows (a cycle's segments dash 3/5 per segment).
    arrow: { capacity: 1024, widthUnit: 'px', width: 1.5, dash: DASH_SOLID },
};
