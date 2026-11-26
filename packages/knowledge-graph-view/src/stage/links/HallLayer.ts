/**
 * HALLS (the design's raised flat bars between shapes): every segment of a `hall` batch as a lit 3D box of a WORLD-unit width
 * lying on its floor — the Map's routes, a drill level's links and the highlighted path. ONE instanced box mesh; its per-segment
 * attributes are the line shader's (`aA` xyz + run length, `aB` xyz + width, `aStyle` tone, dash, flags, group), so a batch is
 * packed by the same `fillSegments`. A segment flagged `PULSE` is a LIT hall: the accent tone, half emissive, with a white
 * pulse ball travelling along it (a second instanced mesh sharing the attributes; static at mid-length under reduced motion).
 * Both meshes are preallocated at mount; only an overflow recreates them.
 */

import {
    BoxGeometry, DoubleSide, DynamicDrawUsage, GLSL3, Group, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh,
    ShaderMaterial, SphereGeometry, type IUniform, type Vector3,
} from 'three';
import { capacityFor } from '../slots';
import { LIGHT_GLSL } from '../lighting';
import { uploadRange, type StageStats } from '../stats';
import { PALETTE_SIZE, toneIndex } from '../tones';
import { FLAG, type LinkBatch } from '../types';
import { HALL_STYLE } from './families';
import { fillSegments, segmentsOf } from './pack';

export interface HallUniforms {
    uPalette: IUniform<Vector3[]>;
    uBg: IUniform<Vector3>;
    uTime: IUniform<number>;
    uMotion: IUniform<number>;
}

/** One pulse lap, ms (the design's `0.00045` per ms ⇒ ~2.2 s). */
const PULSE_LAP_MS = 2222;

const BASIS = /* glsl */ `
in vec4 aA; in vec4 aB; in vec4 aStyle;
uniform vec3 uPalette[${PALETTE_SIZE}];
uniform float uThick;
vec3 dirOf() { vec3 d = aB.xyz - aA.xyz; return d / max(length(d), 1e-5); }
// Bar basis: forward along the segment, right horizontal, up completing it (world up for a level bar).
mat3 basis(vec3 f) {
    vec3 r = length(f.xz) > 1e-4 ? normalize(vec3(-f.z, 0.0, f.x)) : vec3(1.0, 0.0, 0.0);
    return mat3(f, normalize(cross(r, f)), r);
}`;

const VERTEX = /* glsl */ `
${BASIS}
uniform float uLitTone;
out vec3 vColor;
${LIGHT_GLSL}
void main() {
    vec3 d = aB.xyz - aA.xyz;
    float len = max(length(d), 1e-4), width = max(aB.w, 1e-4), thick = width * uThick;
    mat3 m = basis(dirOf());
    vec3 local = vec3(position.x * len, position.y * thick + thick * 0.5, position.z * width);
    vec3 p = (aA.xyz + aB.xyz) * 0.5 + m * local;
    vec3 n = normalize(m * normal);
    bool lit = mod(floor(aStyle.z / ${FLAG.PULSE.toFixed(1)}), 2.0) > 0.5;
    vec3 base = uPalette[int((lit ? uLitTone : aStyle.x) + 0.5)];
    float light = clamp(stageLight(n), 0.0, 1.0);
    vColor = lit ? base * (0.45 * light + 0.55) : base * light;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const PULSE_VERTEX = /* glsl */ `
${BASIS}
uniform float uTime; uniform float uMotion; uniform float uPulseWidth;
void main() {
    bool lit = mod(floor(aStyle.z / ${FLAG.PULSE.toFixed(1)}), 2.0) > 0.5;
    if (!lit) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 d = aB.xyz - aA.xyz;
    float width = max(aB.w, 1e-4);
    float k = uMotion > 0.5 ? fract(uTime / ${PULSE_LAP_MS.toFixed(1)} + aStyle.w * 0.13) : 0.5;
    vec3 at = aA.xyz + d * k + vec3(0.0, width * (uPulseWidth * 0.5 + 0.55), 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(at + position * width * uPulseWidth, 1.0);
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() { fragColor = vec4(vColor, 1.0); }`;

const BALL_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uBall;
out vec4 fragColor;
void main() { fragColor = vec4(uBall, 1.0); }`;

interface Hall { bars: InstancedMesh; balls: InstancedMesh; a: InstancedBufferAttribute; b: InstancedBufferAttribute; style: InstancedBufferAttribute; capacity: number }

export class HallLayer {
    readonly group = new Group();
    private hall!: Hall;
    /** A lit hall is on screen: the renderer keeps the decorative clock running (never under reduced motion). */
    pulsing = false;

    constructor(private readonly stats: StageStats, private readonly uniforms: HallUniforms) {
        this.create(HALL_STYLE.capacity);
    }

    set(batches: readonly LinkBatch[]): void {
        const halls = batches.filter((b) => b.family === 'hall');
        const total = halls.reduce((n, b) => n + segmentsOf(b), 0);
        if (total > this.hall.capacity) this.create(Math.max(capacityFor(total), this.hall.capacity * 2));
        const h = this.hall;
        let at = 0, lit = false;
        for (const batch of halls) {
            const n = fillSegments(batch, h.a.array as Float32Array, h.b.array as Float32Array, h.style.array as Float32Array, at);
            for (let i = at; i < at + n; i++) if (((h.style.array as Float32Array)[i * 4 + 2]! & FLAG.PULSE) !== 0) lit = true;
            at += n;
        }
        for (const attr of [h.a, h.b, h.style]) uploadRange(this.stats, attr, 0, at);
        h.bars.count = at;
        h.balls.count = at;
        this.pulsing = lit;
    }

    get count(): number { return this.hall.bars.count; }
    set visible(v: boolean) { this.group.visible = v; }
    get visible(): boolean { return this.group.visible; }
    get meshes(): readonly InstancedMesh[] { return [this.hall.bars, this.hall.balls]; }

    private create(capacity: number): void {
        this.dispose();
        const attr = () => new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
        const a = attr(), b = attr(), style = attr();
        const instanced = (src: BoxGeometry | SphereGeometry, normals: boolean): InstancedBufferGeometry => {
            const g = new InstancedBufferGeometry();
            g.setIndex(src.getIndex());
            g.setAttribute('position', src.getAttribute('position'));
            if (normals) g.setAttribute('normal', src.getAttribute('normal'));
            g.setAttribute('aA', a); g.setAttribute('aB', b); g.setAttribute('aStyle', style);
            return g;
        };
        const { uPalette, uBg, uTime, uMotion } = this.uniforms;
        const bars = new InstancedMesh(instanced(new BoxGeometry(1, 1, 1), true), new ShaderMaterial({
            glslVersion: GLSL3, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: DoubleSide,
            uniforms: { uPalette, uBg, uThick: { value: HALL_STYLE.thickness }, uLitTone: { value: toneIndex('lit') } },
        }), capacity);
        const balls = new InstancedMesh(instanced(new SphereGeometry(0.5, 10, 8), false), new ShaderMaterial({
            glslVersion: GLSL3, vertexShader: PULSE_VERTEX, fragmentShader: BALL_FRAGMENT,
            uniforms: { uPalette, uTime, uMotion, uPulseWidth: { value: 0.6 }, uBall: { value: this.uniforms.uPalette.value[toneIndex('sel')]! } },
        }), capacity);
        for (const [mesh, name, order] of [[bars, 'halls', 1], [balls, 'halls:pulse', 2]] as const) {
            mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = order; mesh.name = name;
            this.stats.meshesCreated++;
            this.group.add(mesh);
        }
        this.hall = { bars, balls, a, b, style, capacity };
    }

    dispose(): void {
        const h = this.hall as Hall | undefined;
        if (!h) return;
        for (const m of [h.bars, h.balls]) { this.group.remove(m); m.geometry.dispose(); (m.material as ShaderMaterial).dispose(); }
    }
}
