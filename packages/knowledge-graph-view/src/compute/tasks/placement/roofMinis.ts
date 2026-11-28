/**
 * ROOF MINIATURES (the design's `build`): a shape you can go inside shows what is inside it, small, on its roof — at most
 * {@link MINIS_MAX}, laid out exactly as the next level lays them out (`tierLayout`), shrunk onto the roof by
 * `1.25 × w / 17` across and `1.25 × d / 13` deep, {@link MINI.height} tall. They are the SAME slots the next level grows them
 * from (visibility is scale), so entering a shape grows its roof into the room. A slot a level already placed is never
 * placed twice. The y of a mini is its parent's roof: `Placement.liftWithDepth` lowers it with the depth. Pure.
 */

import type { Draft } from './anchor';
import { VISIBLE, show } from './anchor';
import type { LevelChild } from './levelChildren';
import { FOOT, kindOfChild, MINI, MINIS_MAX, ROUND_KINDS, U } from './levelGeometry';
import { layTiers } from './tierLayout';

/** A shape standing on the floor: where (world x, z), how big (design units, full width × depth) and how high its roof is (world y). */
export interface RoofParent { x: number; z: number; w: number; d: number; roof: number }

/** Places `kids` (the parent's children, ranked) on the roof of `parent`; `aspect` receives each mini's depth ÷ width. */
export function roofMinis(d: Draft, aspect: Float32Array, parent: RoofParent, kids: readonly LevelChild[]): number {
    const fresh = kids.filter((k) => d.placed[k.slot] !== VISIBLE).slice(0, MINIS_MAX);
    const spots = layTiers(fresh.map((k) => {
        const kind = kindOfChild(k.role, k.type), [w, depth] = FOOT[kind];
        return { tier: k.tier, w, d: ROUND_KINDS.has(kind) ? w : depth };
    }));
    const fx = (MINI.share * parent.w) / MINI.refW, fz = (MINI.share * parent.d) / MINI.refD;
    fresh.forEach((kid, i) => {
        const at = spots[i]!, w = at.w * fx, depth = (ROUND_KINDS.has(kindOfChild(kid.role, kid.type)) ? at.w : at.d) * fz;
        show(d, kid.slot, parent.x + at.x * fx * U, parent.roof, parent.z + at.z * fz * U, (w * U) / 2, MINI.height * U);
        aspect[kid.slot] = depth / Math.max(w, 1e-6);
    });
    return fresh.length;
}
