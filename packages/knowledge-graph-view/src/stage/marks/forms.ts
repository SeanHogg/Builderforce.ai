/**
 * What a mark is built as in the 3D stage (the design's shapes), by its type: the ONE table from `MarkType` to its FORM and
 * the outline the form is extruded from. Worker-safe (data only): the placement reads `FORM_RISE` to give each form its
 * height, the renderer reads `FORM_CODE` / `outlineShape` to build the batch.
 *
 *   box    — a solid block with a lighter cap band on top (a file, a class);
 *   slab   — a flat plate with its edges outlined (a system, a component, a deployable unit);
 *   drum   — a cylinder with a lighter lid (a store, data);
 *   puck   — a low cylinder (a method, a function);
 *   iface  — a translucent box with DASHED edges (an interface, a trait: a contract with no body);
 *   prism  — any other silhouette of `shapes.ts`, extruded and lit.
 */

import type { MarkType, NodeShape } from '../../shapes';
import { TYPE_SHAPE } from '../../shapes';

export type MarkForm = 'box' | 'slab' | 'drum' | 'puck' | 'prism' | 'iface';

/** The shader's `uForm` value. */
export const FORM_CODE: Readonly<Record<MarkForm, number>> = { prism: 0, box: 1, slab: 2, drum: 3, puck: 4, iface: 5 };

export const TYPE_FORM: Readonly<Record<MarkType, MarkForm>> = {
    class: 'box', source: 'box', interface: 'iface', function: 'puck', data: 'drum', system: 'slab', unit: 'slab',
    test: 'prism', doc: 'prism', config: 'prism', style: 'prism', section: 'prism', entity: 'prism', claim: 'prism', external: 'prism',
};

/** The outline a form is extruded from: round forms stand on the circle, the rest keep their type's silhouette. */
export function outlineShape(type: MarkType): NodeShape {
    const form = TYPE_FORM[type];
    return form === 'drum' || form === 'puck' ? 'circle' : TYPE_SHAPE[type];
}

/**
 * How tall a form stands, as a share of the station's own height (`towerHeight`): a slab is a plate, a puck a coin, a drum
 * a tub, a box and a prism the full tower.
 */
export const FORM_RISE: Readonly<Record<MarkForm, number>> = { slab: 0.25, puck: 0.35, drum: 0.8, box: 1, prism: 1, iface: 0.8 };

/** The lighter cap of a box is this share of its height (the design's 16%). */
export const CAP_BAND = 0.16;
