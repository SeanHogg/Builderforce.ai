/**
 * The ONE line shader (PRD 43 B3, Links), the same for every link family: one instanced quad per segment, expanded
 * past both ends by the half-width so the distance-to-segment gives ROUND caps and joins; colour, width and dash per
 * segment; running-length dashes (with round dash caps, as SVG's `stroke-linecap="round"` draws them); the background
 * casing in the same pass; `fwidth` anti-aliasing with no MSAA; world or pixel width.
 *
 * Overlap: every fragment writes a depth from its polyline (`group`) and whether it is core or casing, so within one
 * polyline the joins never double-blend (equal depth fails LESS) and a later polyline's casing covers an earlier one's
 * core — exactly the SVG paint order of one casing + core per hop.
 *
 * Per-instance attributes, packed so a placement swap is 3 uploads: `aA` (xyz, run length at A), `aB` (xyz, width),
 * `aStyle` (tone, dash pattern, flags, group).
 */

import { DoubleSide, GLSL3, ShaderMaterial, Vector2, Vector3, type IUniform } from 'three';
import { DASH_PATTERNS } from '../types';
import { PALETTE_SIZE } from '../tones';

export const DASH_VERTEX_GLSL = /* glsl */ `
uniform vec2 uDash[${DASH_PATTERNS.length}];
flat out vec2 vDash;`;

export const dashUniform = () => ({ value: DASH_PATTERNS.map(([on, off]) => new Vector2(on, off)) });

const VERTEX = /* glsl */ `
in vec4 aA; in vec4 aB; in vec4 aStyle;
uniform float uPxPerWorld; uniform float uDpr; uniform float uWorldWidth; uniform float uCasing;
uniform vec3 uPalette[${PALETTE_SIZE}]; uniform float uCasingTone;
${DASH_VERTEX_GLSL}
out vec2 vLocal; out float vLen; out float vHalf; out float vCase; out float vRun;
out vec3 vColor; out vec3 vCaseColor; out float vFlags; out float vGroup;
void main() {
    vec2 d = aB.xz - aA.xz;
    float len = length(d);
    vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float unit = uWorldWidth > 0.5 ? 1.0 : 1.0 / uPxPerWorld;
    float halfW = aB.w * 0.5 * unit;
    float cas = halfW + uCasing * 0.5 * unit;
    float pad = cas + 2.0 / (uPxPerWorld * uDpr);
    float along = position.x * len + (position.x * 2.0 - 1.0) * pad;
    float across = position.y * pad;
    vec2 xz = aA.xz + dir * along + nrm * across;
    vLocal = vec2(along, across); vLen = len; vHalf = halfW; vCase = cas; vRun = aA.w;
    vColor = uPalette[int(aStyle.x + 0.5)]; vCaseColor = uPalette[int(uCasingTone + 0.5)];
    vDash = uDash[int(aStyle.y + 0.5)] * unit; vFlags = aStyle.z; vGroup = aStyle.w;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(xz.x, aA.y, xz.y, 1.0);
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uBg; uniform float uDepthStep;
flat in vec2 vDash;
in vec2 vLocal; in float vLen; in float vHalf; in float vCase; in float vRun;
in vec3 vColor; in vec3 vCaseColor; in float vFlags; in float vGroup;
out vec4 fragColor;
void main() {
    float t = clamp(vLocal.x, 0.0, vLen);
    float beyond = abs(vLocal.x - t);
    float dist = length(vec2(beyond, vLocal.y));
    float aa = max(fwidth(dist), 1e-5) * 0.5;
    float casingA = 1.0 - smoothstep(vCase - aa, vCase + aa, dist);
    if (casingA <= 0.002) discard;
    float coreDist = dist;
    if (vDash.y > 0.0) {
        float period = vDash.x + vDash.y;
        float q = mod(vRun + t, period);
        float off = q < vDash.x ? 0.0 : min(q - vDash.x, period - q);
        coreDist = length(vec2(max(off, beyond), vLocal.y));
    }
    float coreA = 1.0 - smoothstep(vHalf - aa, vHalf + aa, coreDist);
    vec3 c = mix(vCaseColor, vColor, coreA);
    if (mod(vFlags, 2.0) > 0.5) c = mix(c, uBg, 0.6);
    fragColor = vec4(c, casingA);
    gl_FragDepth = 0.9 - (vGroup * 2.0 + (coreA > 0.5 ? 1.0 : 0.0)) * uDepthStep;
}`;

export interface LinkUniforms {
    uPxPerWorld: IUniform<number>;
    uDpr: IUniform<number>;
    uPalette: IUniform<Vector3[]>;
    uBg: IUniform<Vector3>;
}

/** A batch's unit and casing are uniforms, so the family's ONE preallocated material takes any batch with no rebuild. */
export function setLinkStyle(material: ShaderMaterial, widthUnit: 'world' | 'px', casing: { tone: number; extra: number } | undefined): void {
    const u = material.uniforms;
    u.uWorldWidth!.value = widthUnit === 'world' ? 1 : 0;
    u.uCasing!.value = casing?.extra ?? 0;
    u.uCasingTone!.value = casing?.tone ?? 0;
}

export function linkMaterial(shared: LinkUniforms, widthUnit: 'world' | 'px', casing: { tone: number; extra: number } | undefined): ShaderMaterial {
    return new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
            ...shared,
            uWorldWidth: { value: widthUnit === 'world' ? 1 : 0 },
            uCasing: { value: casing?.extra ?? 0 },
            uCasingTone: { value: casing?.tone ?? 0 },
            uDash: dashUniform(),
            uDepthStep: { value: 1e-5 },
        },
        transparent: true,
        depthWrite: true,
        // The segment quad's winding depends on its direction; seen from above either face is the line.
        side: DoubleSide,
    });
}
