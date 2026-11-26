/**
 * The camera rig's constants and pure helpers (`rig.ts` holds the state): the zoom and dolly limits, the orbit's degrees
 * per pixel, the interpolation helpers, and the {@link Projector} a rig view hands the stage bus (the no-canvas path).
 */

import type { Projector } from '../pick';
import { groundScreenMatrix, orbitPxPerWorld, projectGround, projectOrbit, type GroundView, type OrbitPose } from '../projection';

export const MIN_ZOOM_FACTOR = 0.2;
/** Deep: the semantic zoom (B1a rule 9) nests each band inside its parent mark, down to a method's code. */
export const MAX_ZOOM_FACTOR = 4096;
/** The ortho camera's distance from its target: far enough that a tilted, tall placement stays inside near/far. */
export const CAMERA_DISTANCE = 4000;
/** The fov a cross-projection tween uses when neither end names one. */
export const DEFAULT_FOV = 35;
/** Degrees of orbit per CSS px of drag, and per arrow-key press. */
export const ORBIT_DEG_PER_PX = 0.3;
export const ORBIT_KEY_DEG = 5;
/** An orbit pitched straight down (the Flat view of a 3D placement). */
export const FLAT_PITCH = 90;
/** Dolly limits relative to the home distance. */
export const DOLLY_MIN = 0.1, DOLLY_MAX = 6;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Shortest-way yaw interpolation (degrees). */
export const lerpAngle = (a: number, b: number, t: number): number => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** An orbit's extrude at `pitch`: full at the resting pitch, collapsing toward `flatDepth` at Flat; undefined = always full. */
export function orbitDepthAt(pitch: number, resting: number, flatDepth: number | undefined): number {
    if (flatDepth === undefined) return 1;
    return lerp(1, flatDepth, clamp((pitch - resting) / Math.max(1, FLAT_PITCH - resting), 0, 1));
}

/** A snapshot of an orbit pose as a {@link Projector} (its own copy: later rig moves do not change it). */
export function orbitProjector(pose: Readonly<OrbitPose>): Projector {
    const o: OrbitPose = { ...pose };
    return {
        width: o.width, height: o.height, pxPerWorld: orbitPxPerWorld(o),
        key: `orbit|${o.tx}|${o.ty}|${o.tz}|${o.yaw}|${o.pitch}|${o.distance}|${o.fov}|${o.width}|${o.height}`,
        project(x, y, z, out) { return projectOrbit(o, x, y, z, out as unknown as { 0: number; 1: number }); },
    };
}

/** A snapshot of a ground view as a {@link Projector}, with its screen matrix (the pick grid's inlined loop). */
export function groundProjector(view: Readonly<GroundView>): Projector {
    const g: GroundView = { ...view };
    return {
        width: g.width, height: g.height, pxPerWorld: g.zoom, key: `rig|${g.zoom}|${g.cx}|${g.cz}|${g.tilt}|${g.width}|${g.height}`,
        screen: groundScreenMatrix(g),
        project(x, y, z, out) { projectGround(g, x, y, z, out as unknown as { 0: number; 1: number }); return true; },
    };
}
