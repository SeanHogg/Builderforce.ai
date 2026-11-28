/**
 * A mark's footprint ASPECT (`Placement.aspect`: depth ÷ width, 1 = as wide as deep) as the A/B pair the shader tweens by
 * `uT` like the extrude. The pair rides in ONE float of `extrudeAB.w` (so a placement swap keeps its upload count and the
 * program its attribute count): each aspect is a 12-bit code on a log2 scale, 2048 = exactly 1, one step ≈ 0.15 %, the
 * range 1/8 … 8; A in the high 12 bits, B in the low 12 (24 bits: exact in a float32). The GLSL decode mirrors this file.
 */

const CODES = 4096;
/** The code of aspect 1 (the default). */
const ONE = CODES / 2;
/** log2 of the largest / smallest aspect the code reaches (±3 ⇒ 8 and 1/8). */
const LOG_RANGE = 3;

/** The packed pair for "both aspects 1": what a mark holds until a placement says otherwise. */
export const PACKED_ONE = ONE * CODES + ONE;

const encode = (aspect: number): number => {
    if (!(aspect > 0) || !Number.isFinite(aspect)) return ONE;
    return Math.max(0, Math.min(CODES - 1, Math.round((Math.log2(aspect) / LOG_RANGE) * ONE) + ONE));
};
const decode = (code: number): number => 2 ** (((code - ONE) / ONE) * LOG_RANGE);

/** The aspect stored for set `set` (0 = A, 1 = B) of `packed`. */
export function aspectOf(packed: number, set: 0 | 1): number {
    const hi = Math.floor(packed / CODES);
    return decode(set === 0 ? hi : packed - hi * CODES);
}

/** `packed` with set `set`'s aspect replaced by `aspect` (the other set untouched). */
export function withAspect(packed: number, set: 0 | 1, aspect: number): number {
    const hi = Math.floor(packed / CODES), lo = packed - hi * CODES, code = encode(aspect);
    return set === 0 ? code * CODES + lo : hi * CODES + code;
}

/** GLSL: the (A, B) aspects of a packed float, the inverse of {@link withAspect}. */
export const ASPECT_GLSL = /* glsl */ `
vec2 aspectsOf(float w) {
    float hi = floor(w / ${CODES.toFixed(1)});
    return exp2((vec2(hi, w - hi * ${CODES.toFixed(1)}) - ${ONE.toFixed(1)}) / ${ONE.toFixed(1)} * ${LOG_RANGE.toFixed(1)});
}`;
