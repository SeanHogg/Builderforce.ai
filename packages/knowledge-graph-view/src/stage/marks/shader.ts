/**
 * The ONE mark shader (PRD 43 B3, Marks). Vertex: the A/B placement pair mixed by `uT` (ping-ponged by `uFlip`, so a
 * camera switch writes only the stale set), scale 0 culled, the extruded walls raised by `extrude × uDepth` (the depth
 * control: 0 is the flat home view), and the cap quad padded in device pixels for the rings. Fragment: the cap is the
 * shape's exact polygon SDF (the `shapes.ts` outline as a uniform), anti-aliased with `fwidth` (no MSAA), drawing every
 * paint flag (`FLAG`, one float per slot) the way `StationMark` drew it in SVG, each band an offset of the OUTLINE:
 *
 * - body: the type colour; DOC draws it as a page (a pale fill inside a full-tone border);
 * - backing: the background ring under every mark; INTERCHANGE adds the text-tone backing outside it;
 * - coverage: the arc in `tone2` from 12 o'clock for `fill` of the way round; SHELL (measured zero coverage) dashes it;
 * - OUTLINE: the dashed violation ring;
 * - PULSE: the changed-tone ring breathing out and back over 2 s (`uTime`; static when `uMotion` is 0 — reduced motion);
 * - DIM blends every colour toward the background colour, never alpha.
 *
 * Colours are tone indices into one palette uniform (sRGB, written as-is), so a theme flip is one uniform.
 */

import { GLSL3, DoubleSide, LessEqualDepth, ShaderMaterial, Vector2, Vector3, type IUniform } from 'three';
import { SHAPE_EXTENT } from '../../shapes';
import { LIGHT_GLSL } from '../lighting';
import { PALETTE_SIZE, toneIndex } from '../tones';
import { STAGGER_MS, STAGGER_STEPS } from '../tween';
import { CAP_BAND, FORM_CODE, type MarkForm } from './forms';
import { FLAG } from '../types';

/** Outline points the cap SDF accepts (the circle has 32). */
export const MAX_OUTLINE = 40;

/** CSS-px offsets of the cap's bands from the outline, at DPR 1 (the shader multiplies by `uDpr`); `StationMark`'s radii. */
export const CAP_PX = {
    backing: 4, interchange: 3, ringIn: 2.5, ringOut: 5.5, shell: 1.5, docBorder: 1.5,
    outline: 9, outlineWidth: 1.5, pulseFrom: 4, pulseReach: 9, pulseWidth: 2.5,
} as const;
/** The cap quad's padding past the unit outline: the farthest band (the pulse at full reach) plus AA. */
export const CAP_PAD_PX = CAP_PX.pulseFrom + CAP_PX.pulseReach + CAP_PX.pulseWidth;
/** One breath of the pulse ring, as `StationMark`'s `<animate dur="2s">`. */
export const PULSE_PERIOD_MS = 2000;

/** The flag bits as GLSL constants, generated from `FLAG` so the worker's paint and the shader cannot drift apart. */
export const FLAG_GLSL = Object.entries(FLAG).map(([name, bit]) => `const float F_${name} = ${bit.toFixed(1)};`).join('\n');

const f1 = (n: number): string => n.toFixed(2);

// Packed so a mark costs 4 instanced attribute slots beside InstancedMesh's own instanceMatrix (4): D3D11 ANGLE caps a
// program at 16 vertex attributes, and twelve separate ones did not link there (P1a, measured).
const VERTEX = /* glsl */ `
in float aPart;
in vec4 placeA;      // posA.xyz, scaleA
in vec4 placeB;      // posB.xyz, scaleB
in vec2 extrudeAB;   // extrudeA, extrudeB
in vec4 paint;       // tone, tone2, fill, flags
uniform float uForm; uniform float uHoverInst;
uniform float uT; uniform float uLin; uniform float uSpan; uniform float uDur; uniform float uFlip; uniform float uPxPerWorld; uniform float uDpr; uniform float uDepth; uniform vec2 uMinMarkPx;
uniform vec3 uPalette[${PALETTE_SIZE}];
out vec2 vUv; out float vPart; out vec3 vColor; out vec3 vColor2; out float vFill; out float vFlags; out float vPx;
out float vLight; out float vY; out float vHover; out float vFade;
${LIGHT_GLSL}
void main() {
    vec4 from = mix(placeA, placeB, uFlip), to = mix(placeB, placeA, uFlip);
    // Each mark runs its own cubic in-out, started STAGGER_MS after the one before it (by index); a mark leaving shrinks and fades.
    float lt = clamp((uLin * uSpan - min(float(gl_InstanceID), ${STAGGER_STEPS.toFixed(1)}) * ${STAGGER_MS.toFixed(1)}) / max(uDur, 1.0), 0.0, 1.0);
    float tt = uLin >= 1.0 ? 1.0 : (lt < 0.5 ? 4.0 * lt * lt * lt : 1.0 - pow(-2.0 * lt + 2.0, 3.0) / 2.0);
    vFade = (from.w > 0.0 && to.w <= 0.0) ? 1.0 - tt : 1.0;
    float s = mix(from.w, to.w, tt);
    if (s <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    // Each placement SET carries its own drawn floor (markSize.ts drawnHalfPx; A in x, B in y), applied only where that
    // set shows the mark and blended with uT: a mark shrinking to hidden or growing from it never pops to the floor.
    float floorFrom = mix(uMinMarkPx.x, uMinMarkPx.y, uFlip) * step(1e-9, from.w), floorTo = mix(uMinMarkPx.y, uMinMarkPx.x, uFlip) * step(1e-9, to.w);
    s = max(s, mix(floorFrom, floorTo, tt) * 0.5 / max(uPxPerWorld, 1e-6));
    vec3 p = mix(from.xyz, to.xyz, tt);
    p.y *= uDepth;   // a roof miniature stands on its parent's roof, which collapses with the depth (Flat)
    float e = mix(mix(extrudeAB.x, extrudeAB.y, uFlip), mix(extrudeAB.y, extrudeAB.x, uFlip), tt) * uDepth;
    float tone = paint.x, tone2 = paint.y, fillv = paint.z, flags = paint.w;
    float px = s * uPxPerWorld * uDpr;
    vec3 local;
    vLight = stageLight(vec3(0.0, 1.0, 0.0)); vY = 1.0;
    if (aPart > 1.5) {
        // The contact shadow: the cap's quad on the ground under the mark, thrown away from the sun by its height, soft-edged.
        float extent = ${f1(SHAPE_EXTENT)} + max(0.9, (${f1(CAP_PAD_PX)} + 1.5) * uDpr / max(px, 0.001));
        vUv = position.xz * extent;
        bool caged = mod(floor(flags / 256.0), 2.0) > 0.5;
        vec2 off = caged ? vec2(0.0) : -SUN.xz / SUN.y * e * 0.45;
        local = vec3(vUv.x * s + off.x, s * 0.01, vUv.y * s + off.y);
    } else if (aPart > 0.5) {
        float extent = ${f1(SHAPE_EXTENT)} + (${f1(CAP_PAD_PX)} + 1.5) * uDpr / max(px, 0.001);
        vUv = position.xz * extent;
        local = vec3(vUv.x * s, e + 0.01, vUv.y * s);
    } else {
        vUv = position.xz;
        local = vec3(position.x * s, (position.y + 0.5) * e, position.z * s);
        // A drum and a puck are round: their walls take the radial normal, so the light rolls round them smoothly.
        vec3 n = (uForm > 2.5 && uForm < 4.5) ? normalize(vec3(position.x, 0.0, position.z)) : normal;
        vLight = stageLight(n); vY = position.y + 0.5;
    }
    vHover = float(gl_InstanceID) == uHoverInst ? 1.0 : 0.0;
    vPart = aPart; vPx = px; vFill = fillv; vFlags = flags;
    vColor = uPalette[int(tone + 0.5)]; vColor2 = uPalette[int(tone2 + 0.5)];
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p + local, 1.0);
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
${FLAG_GLSL}
uniform vec2 uOutline[${MAX_OUTLINE}];
uniform int uCount; uniform float uDashed; uniform vec3 uBg; uniform float uDpr;
uniform float uTime; uniform float uMotion;
uniform vec3 uPalette[${PALETTE_SIZE}];
uniform float uTextTone; uniform float uViolationTone; uniform float uChangedTone; uniform float uWallTone;
uniform float uForm; uniform float uHoverTone; uniform float uEdgeTone;
in float vFade;
in float vLight; in float vY; in float vHover;
in vec2 vUv; in float vPart; in vec3 vColor; in vec3 vColor2; in float vFill; in float vFlags; in float vPx;
out vec4 fragColor;
const float PI = 3.14159265;
bool bit(float flags, float b) { return mod(floor(flags / b), 2.0) > 0.5; }
vec3 toneOf(float t) { return uPalette[int(t + 0.5)]; }
// A cap is the lighter top of its body (a box and a drum a clear step, a prism a hint, a slab and a puck none).
vec3 capOf(vec3 b) { float k = (uForm > 0.5 && uForm < 1.5) || (uForm > 2.5 && uForm < 3.5) ? 0.3 : (uForm < 0.5 ? 0.12 : 0.0); return mix(b, vec3(1.0), k); }
// The hover tint: the lit accent as emissive, on top of the lighting.
vec3 shaded(vec3 base) { return mix(clamp(base * vLight, 0.0, 1.0), toneOf(uHoverTone), 0.4 * vHover); }
// Exact signed distance to the outline polygon (negative inside).
float sdPolygon(vec2 p) {
    float d = dot(p - uOutline[0], p - uOutline[0]);
    float sgn = 1.0;
    for (int i = 0; i < ${MAX_OUTLINE}; i++) {
        if (i >= uCount) break;
        int j = i == 0 ? uCount - 1 : i - 1;
        vec2 vi = uOutline[i], vj = uOutline[j];
        vec2 e = vj - vi, w = p - vi;
        vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
        d = min(d, dot(b, b));
        bvec3 c = bvec3(p.y >= vi.y, p.y < vj.y, e.x * w.y > e.y * w.x);
        if (all(c) || all(not(c))) sgn = -sgn;
    }
    return sgn * sqrt(d);
}
// Coverage of a band of half-width h centred at distance c from the outline (device px).
float band(float d, float c, float h, float aa) { return 1.0 - smoothstep(h - aa, h + aa, abs(d - c)); }
// 1 on the "on" part of an (on, off) CSS-px dash pattern run round the mark at distance c from the outline.
float dashAt(float c, vec2 pattern) {
    float a = atan(vUv.x, -vUv.y) + PI;
    float s = a * (vPx + c) / uDpr;
    return step(mod(s, pattern.x + pattern.y), pattern.x);
}
void main() {
    bool dim = bit(vFlags, F_DIM);
    if (vPart > 1.5) {
        float sd = sdPolygon(vUv) * vPx;
        float a = (1.0 - smoothstep(-0.15 * vPx, 0.5 * vPx, sd)) * (dim ? 0.12 : 0.32);
        vec4 o = vec4(0.0, 0.0, 0.0, a);
        if (bit(vFlags, F_CAGE)) {
            // The cage's foot: a dashed red ring on the floor round the mark (its top ring is the cap's).
            float aa2 = max(fwidth(sd), 0.0001) * 0.5;
            float ring = band(sd, ${f1(CAP_PX.outline)} * uDpr, ${f1(CAP_PX.outlineWidth / 2)} * uDpr, aa2) * dashAt(${f1(CAP_PX.outline)} * uDpr, vec2(2.0, 3.0));
            if (ring > a) o = vec4(toneOf(uViolationTone), ring);
        }
        if (o.a <= 0.004) discard;
        fragColor = vec4(o.rgb, o.a * vFade);
        return;
    }
    if (vPart < 0.5) {
        // The wall is the body, lit (darker than the cap by the light's angle); a box's top band is its lighter cap.
        vec3 base = (uForm > 0.5 && uForm < 1.5 && vY > ${(1 - CAP_BAND).toFixed(2)}) ? capOf(vColor) : vColor;
        vec3 wall = shaded(base);
        float wallA = (uForm > 4.5 ? 0.14 : 1.0) * (bit(vFlags, F_GHOST) ? 0.62 : 1.0) * vFade;   // an interface is see-through; a ghost is a neighbour
        fragColor = vec4(dim ? mix(wall, uBg, 0.7) : wall, wallA);
        return;
    }
    float dpr = uDpr;
    float d = sdPolygon(vUv) * vPx;              // device px from the outline
    float aa = max(fwidth(d), 0.0001) * 0.5;
    bool inter = bit(vFlags, F_INTERCHANGE), shellFlag = bit(vFlags, F_SHELL), outlined = bit(vFlags, F_OUTLINE) || bit(vFlags, F_CAGE), pulse = bit(vFlags, F_PULSE);
    bool ring = vFill > 0.0 || shellFlag;
    float back = ${f1(CAP_PX.backing)} * dpr;
    float outer = back;
    if (inter) outer = back + ${f1(CAP_PX.interchange)} * dpr;
    if (ring) outer = max(outer, ${f1(CAP_PX.ringOut)} * dpr);
    float pulseAt = 0.0, pulseA = 0.0;
    if (pulse) {
        float phase = uMotion > 0.5 ? 1.0 - abs(fract(uTime / ${f1(PULSE_PERIOD_MS)}) * 2.0 - 1.0) : 0.0;
        pulseAt = (${f1(CAP_PX.pulseFrom)} + ${f1(CAP_PX.pulseReach)} * phase) * dpr;
        pulseA = mix(1.0, 0.2, phase);
    }
    float edge = 1.0 - smoothstep(outer - aa, outer + aa, d);
    float outlineA = outlined ? band(d, ${f1(CAP_PX.outline)} * dpr, ${f1(CAP_PX.outlineWidth / 2)} * dpr, aa) * dashAt(${f1(CAP_PX.outline)} * dpr, vec2(2.0, 3.0)) : 0.0;
    float pulseBand = pulse ? band(d, pulseAt, ${f1(CAP_PX.pulseWidth / 2)} * dpr, aa) * pulseA : 0.0;
    float alpha = max(edge, max(outlineA, pulseBand));
    if (uForm > 4.5) {
        // An interface: a see-through box whose top edge is a DASHED outline.
        float dashed = band(d, -1.0 * dpr, 1.0 * dpr, aa) * dashAt(0.0, vec2(4.0, 3.0));
        alpha = max(max(0.14 * edge, dashed), max(outlineA, pulseBand));
    }
    alpha *= (bit(vFlags, F_GHOST) ? 0.62 : 1.0) * vFade;
    if (alpha <= 0.002) discard;

    vec3 body = capOf(vColor);
    if (bit(vFlags, F_DOC)) {
        // A document reads as a page: a pale fill inside a full-tone border.
        body = mix(mix(vColor, uBg, 0.55), vColor, smoothstep(-${f1(CAP_PX.docBorder)} * dpr - aa, -${f1(CAP_PX.docBorder)} * dpr + aa, d));
    }
    if (uDashed > 0.5) {
        // A dashed outline on the backing: the outside of the folder (missing / external).
        float on = dashAt(0.0, vec2(3.0, 3.0));
        float b = band(d, -0.75 * dpr, ${f1(CAP_PX.shell)} * dpr, aa);
        body = mix(uBg, vColor, b * on);
    }
    if (uForm > 1.5 && uForm < 2.5) body = mix(body, toneOf(uEdgeTone), 0.85 * band(d, -1.0 * dpr, 1.0 * dpr, aa)); // a slab: its edges outlined
    body = shaded(body);
    vec3 c = mix(body, uBg, smoothstep(-aa, aa, d));
    if (inter) c = mix(c, toneOf(uTextTone), smoothstep(back - aa, back + aa, d));
    if (ring) {
        float inBand = smoothstep(${f1(CAP_PX.ringIn)} * dpr - aa, ${f1(CAP_PX.ringIn)} * dpr + aa, d) * (1.0 - smoothstep(${f1(CAP_PX.ringOut)} * dpr - aa, ${f1(CAP_PX.ringOut)} * dpr + aa, d));
        float a = atan(vUv.x, -vUv.y) / (2.0 * PI);
        float f = a < 0.0 ? a + 1.0 : a;
        float on = vFill > 0.0 ? step(f, vFill) : dashAt(4.0 * dpr, vec2(3.0, 3.0));
        c = mix(c, vColor2, inBand * on);
    }
    c = mix(c, toneOf(uViolationTone), outlineA * (1.0 - edge));
    c = mix(c, toneOf(uChangedTone), pulseBand);
    fragColor = vec4(dim ? mix(c, uBg, 0.7) : c, alpha);
}`;

/** Uniforms every mark material shares (one object each, so a write reaches every batch). */
export interface SharedMarkUniforms {
    uT: IUniform<number>;
    /** The tween's LINEAR progress (0..1 over `uSpan`), the per-mark stagger clock; `uDur` is one mark's run, ms. */
    uLin: IUniform<number>;
    uSpan: IUniform<number>;
    uDur: IUniform<number>;
    uFlip: IUniform<number>;
    uPxPerWorld: IUniform<number>;
    uDpr: IUniform<number>;
    uPalette: IUniform<Vector3[]>;
    uBg: IUniform<Vector3>;
    /** The depth control, 0..1: multiplies every extrude (0 = the flat home view; Map's tilt raises the towers). */
    uDepth: IUniform<number>;
    /** Decorative-motion clock (ms), advanced at ≤ 30 fps only while a PULSE mark is visible. */
    uTime: IUniform<number>;
    /** 0 under reduced motion: the pulse ring stays still. */
    uMotion: IUniform<number>;
    uTextTone: IUniform<number>;
    uViolationTone: IUniform<number>;
    uChangedTone: IUniform<number>;
    /** An extruded mark's side walls: the `towerSide` token. */
    uWallTone: IUniform<number>;
    /** The hover tint (the lit accent) and the slab's edge line. */
    uHoverTone: IUniform<number>;
    uEdgeTone: IUniform<number>;
    /** The least drawn mark size, CSS px across, per placement set (`Placement.minMarkPx`; set A in x, B in y; 0 = world size). */
    uMinMarkPx: IUniform<Vector2>;
}

export function sharedMarkUniforms(): SharedMarkUniforms {
    return {
        uT: { value: 1 }, uLin: { value: 1 }, uSpan: { value: 1 }, uDur: { value: 1 }, uFlip: { value: 0 }, uPxPerWorld: { value: 1 }, uDpr: { value: 1 },
        uPalette: { value: Array.from({ length: PALETTE_SIZE }, () => new Vector3(0.5, 0.5, 0.5)) },
        uBg: { value: new Vector3(1, 1, 1) },
        uDepth: { value: 0 }, uTime: { value: 0 }, uMotion: { value: 1 }, uMinMarkPx: { value: new Vector2(0, 0) },
        uTextTone: { value: toneIndex('text') }, uViolationTone: { value: toneIndex('violation') }, uChangedTone: { value: toneIndex('changed') }, uWallTone: { value: toneIndex('towerSide') },
        uHoverTone: { value: toneIndex('lit') }, uEdgeTone: { value: toneIndex('edge') },
    };
}

/** One batch's material: the shared uniforms plus its shape's outline. */
export function markMaterial(shared: SharedMarkUniforms, outline: ReadonlyArray<readonly [number, number]>, dashed: boolean, form: MarkForm = 'prism'): ShaderMaterial {
    if (outline.length > MAX_OUTLINE) throw new Error(`stage: outline of ${outline.length} points exceeds ${MAX_OUTLINE}`);
    const points = Array.from({ length: MAX_OUTLINE }, (_, i) => new Vector2(outline[i]?.[0] ?? 0, outline[i]?.[1] ?? 0));
    return new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { ...shared, uOutline: { value: points }, uCount: { value: outline.length }, uDashed: { value: dashed ? 1 : 0 }, uForm: { value: FORM_CODE[form] }, uHoverInst: { value: -1 } },
        transparent: true,
        depthWrite: true,
        side: DoubleSide,
        // The contact shadow lies on the plate's top face: equal depth must pass.
        depthFunc: LessEqualDepth,
    });
}
