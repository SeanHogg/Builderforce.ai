/**
 * The stage's ONE light rig (the design prototype's): a hemisphere light plus one directional sun, as GLSL every lit
 * surface (marks, floor plates, halls) includes — so a wall, a cap and a plate can never disagree about where the light is.
 * Lambert only: `stageLight(n)` is the share of the surface colour that reaches the eye for a world normal `n`. A cap
 * (normal up) takes ~1; the walls fall off by how far they face from the sun, so walls read darker than caps.
 */

/** Where the sun sits, relative to the scene (the design's `sun.position`); also where contact shadows fall away from. */
export const SUN_DIR: readonly [number, number, number] = [7, 14, 9];

const len = Math.hypot(...SUN_DIR);
const [sx, sy, sz] = SUN_DIR.map((v) => (v / len).toFixed(4));

export const LIGHT_GLSL = /* glsl */ `
const vec3 SUN = vec3(${sx}, ${sy}, ${sz});
float stageLight(vec3 n) {
    float hemi = mix(0.44, 0.64, n.y * 0.5 + 0.5);
    return hemi + 0.55 * max(dot(n, SUN), 0.0);
}`;
