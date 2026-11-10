/**
 * The stage's ONE orthographic projection math (PRD 43 B2/B5): how a placement is fitted into the stage box and how a
 * world point lands on screen under the rig's view (centre, zoom, tilt about the x axis; screen up = world −z). The rig
 * (`rig/rig.ts`: project, projector, pose) and the projector module (`projector.ts`: frameOf, frameProjector, toScreen)
 * both read it, so picking, the a11y proxies, the caption layer and the camera can never disagree. Pure, allocation-free
 * on the hot path (callers pass `out`).
 */

/** Space kept round a fitted placement, CSS px. */
export const FIT_MARGIN = 16;

/** The rig's view: ground point at the centre, CSS px per world unit, tilt in degrees, and the box it draws into. */
export interface GroundView { cx: number; cz: number; zoom: number; tilt: number; width: number; height: number }

export interface Bounds { min: readonly [number, number, number]; max: readonly [number, number, number] }

/** The centre and zoom that fit `bounds` into a `width` × `height` box with {@link FIT_MARGIN}. */
export function fitView(bounds: Bounds, width: number, height: number): { cx: number; cz: number; zoom: number } {
    const { min, max } = bounds;
    const w = Math.max(1, max[0] - min[0]), h = Math.max(1, max[2] - min[2]);
    const zoom = Math.max(1e-3, Math.min((width - 2 * FIT_MARGIN) / w, (height - 2 * FIT_MARGIN) / h));
    return { cx: (min[0] + max[0]) / 2, cz: (min[2] + max[2]) / 2, zoom };
}

/** The height of a `document` frame: `bounds` fitted to `width` (the page scrolls past it, B2). */
export function documentHeight(bounds: Bounds, width: number): number {
    const w = Math.max(1, bounds.max[0] - bounds.min[0]), d = Math.max(1, bounds.max[2] - bounds.min[2]);
    return Math.ceil(d * ((width - 2 * FIT_MARGIN) / w) + 2 * FIT_MARGIN);
}

/** Where a projection writes a screen point: a pair, or the scratch `Float64Array` the pick and anchor paths reuse. */
export type Vec2Out = { 0: number; 1: number } | Float64Array;

/** World (x, y, z) → CSS px in the box, written to `out[0]`, `out[1]`. */
export function projectGround(v: GroundView, x: number, y: number, z: number, out: Vec2Out): void {
    const a = (v.tilt * Math.PI) / 180;
    out[0] = (x - v.cx) * v.zoom + v.width / 2;
    out[1] = ((z - v.cz) * Math.cos(a) - y * Math.sin(a)) * v.zoom + v.height / 2;
}

/**
 * A free-orbit perspective view (the 3D camera, and every cross-projection tween): the camera looks at `target` from
 * `distance` away, `yaw` degrees about +y (0 = from +z) and `pitch` degrees above the ground, with a vertical `fov`.
 */
export interface OrbitPose { tx: number; ty: number; tz: number; yaw: number; pitch: number; distance: number; fov: number; width: number; height: number }

/** The camera's eye, its up vector (screen up) and forward, into the three `out` triples. */
export function orbitBasis(o: OrbitPose, eye: number[], up: number[], fwd: number[]): void {
    const y = (o.yaw * Math.PI) / 180, p = (o.pitch * Math.PI) / 180;
    const cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
    eye[0] = o.tx + o.distance * cp * sy; eye[1] = o.ty + o.distance * sp; eye[2] = o.tz + o.distance * cp * cy;
    fwd[0] = -cp * sy; fwd[1] = -sp; fwd[2] = -cp * cy;
    // d(eye)/d(pitch), normalised: screen up; at pitch 90° and yaw 0 it is world −z, the ground camera's up.
    up[0] = -sp * sy; up[1] = cp; up[2] = -sp * cy;
}

/** CSS px per world unit at the orbit target (what a perspective view shows the target plane at). */
export const orbitPxPerWorld = (o: Pick<OrbitPose, 'distance' | 'fov' | 'height'>): number =>
    o.height / (2 * Math.max(1e-6, o.distance) * Math.tan((o.fov * Math.PI) / 360));

/** The distance at which a perspective view of `fov` shows the target at `pxPerWorld` (an ortho zoom's twin). */
export const orbitDistanceFor = (pxPerWorld: number, fov: number, height: number): number =>
    height / (2 * Math.max(1e-6, pxPerWorld) * Math.tan((fov * Math.PI) / 360));

const EYE = [0, 0, 0], UP = [0, 0, 0], FWD = [0, 0, 0];

/** World → CSS px under the orbit view; false when the point is behind the camera. */
export function projectOrbit(o: OrbitPose, x: number, y: number, z: number, out: { 0: number; 1: number }): boolean {
    orbitBasis(o, EYE, UP, FWD);
    const rx = FWD[1]! * UP[2]! - FWD[2]! * UP[1]!, ry = FWD[2]! * UP[0]! - FWD[0]! * UP[2]!, rz = FWD[0]! * UP[1]! - FWD[1]! * UP[0]!;
    const dx = x - EYE[0]!, dy = y - EYE[1]!, dz = z - EYE[2]!;
    const depth = dx * FWD[0]! + dy * FWD[1]! + dz * FWD[2]!;
    if (depth <= 1e-6) return false;
    const k = o.height / (2 * Math.tan((o.fov * Math.PI) / 360) * depth);
    out[0] = o.width / 2 + (dx * rx + dy * ry + dz * rz) * k;
    out[1] = o.height / 2 - (dx * UP[0]! + dy * UP[1]! + dz * UP[2]!) * k;
    return true;
}

/** The same map as a column-major 4×4 into screen px (row 3 = (0, 0, 0, 1): orthographic). */
export function groundScreenMatrix(v: GroundView, out: Float64Array = new Float64Array(16)): Float64Array {
    const a = (v.tilt * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a), k = v.zoom;
    out.fill(0);
    out[0] = k;                                   // x → sx
    out[5] = -sin * k;                            // y → sy
    out[9] = cos * k;                             // z → sy
    out[12] = v.width / 2 - v.cx * k;
    out[13] = v.height / 2 - v.cz * cos * k;
    out[15] = 1;
    return out;
}
