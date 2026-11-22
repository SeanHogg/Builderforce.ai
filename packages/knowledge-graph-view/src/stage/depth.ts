/**
 * The ONE resting depth for ground cameras (PRD 43 B1/B2): a ground view rests at a tilted perspective on first paint,
 * not flat top-down. Shared by the camera rig (`rig/rig.ts`, the initial `depthNow`) and the placement tasks
 * (`compute/tasks/placement`, the extrude / plane-stack sink) so the camera's tilt and the marks' extrusion cannot drift.
 *
 * An OMITTED depth means this resting value; an EXPLICIT depth of 0 still means flat — every reader uses `??`, never `||`.
 * The orbit camera (3D, `rig.view`) does not read this: its home pose is the placement's `rig.home` / `rig.view`.
 */
export const RESTING_DEPTH = 0.65;
