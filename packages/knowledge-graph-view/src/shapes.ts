/**
 * The node-shape silhouette table (PRD 38 redundant encoding): one `{shape}` path per kind,
 * drawn beside its colour so two kinds are never told apart by hue alone. Unit-radius path
 * data centred on the origin — the caller translates/scales it to the node. Shared by the 2D
 * graph's node marks and the lens legend's glyphs.
 */

import type { NodeShape } from './lenses';

/** `{shape}` path data for a unit-radius mark centred on the origin; the caller translates it to the node. */
export function shapePath(shape: NodeShape): string {
    switch (shape) {
        case 'circle': return 'M1 0A1 1 0 1 1 -1 0A1 1 0 1 1 1 0Z';
        case 'square': return 'M-0.9 -0.9H0.9V0.9H-0.9Z';
        case 'diamond': return 'M0 -1.2L1.2 0L0 1.2L-1.2 0Z';
        case 'triangle': return 'M0 -1.1L1 0.8L-1 0.8Z';
        case 'hexagon': { const h = 0.87; return `M-1 -${h}L0 -1.05L1 -${h}L1.05 0L1 ${h}L0 1.05L-1 ${h}L-1.05 0Z`; }
        case 'octagon': { const c = 0.42, d = 1.02; return `M-${c} -${d}H${c}L${d} -${c}V${c}L${c} ${d}H-${c}L-${d} ${c}V-${c}Z`; }
        case 'pentagon': { const c = 0.95, s = 0.69; return `M0 -1.05L${c} -${s}L${s} 0.85H-${s}L-${c} -${s}Z`; }
        case 'star': { const a = 1.1, b = 0.45; return `M0 -${a}L${0.36 * b} -${0.36 * b}L${a * Math.cos(Math.PI * 0.1)} -${a * Math.sin(Math.PI * 0.1)}L${0.59 * b} ${0.14 * b}L${0.73 * a} ${0.73 * a}L${0.22 * a} ${0.22 * a}L0 ${b}L-${0.22 * a} ${0.22 * a}L-${0.73 * a} ${0.73 * a}L-${0.59 * b} ${0.14 * b}L-${a * Math.cos(Math.PI * 0.1)} -${a * Math.sin(Math.PI * 0.1)}L-${0.36 * b} -${0.36 * b}Z`; }
    }
}

export const SHAPE_PATHS: Readonly<Record<NodeShape, string>> = Object.freeze({
    circle: shapePath('circle'), square: shapePath('square'), diamond: shapePath('diamond'),
    triangle: shapePath('triangle'), hexagon: shapePath('hexagon'), octagon: shapePath('octagon'),
    pentagon: shapePath('pentagon'), star: shapePath('star'),
});
