/**
 * The planes on the stage (PRD 43 B1/B1a: bands, partition planes, lifeline planes): ONE `InstancedMesh` for every plane
 * of a placement — one draw call — each instance a rectangle on the ground plane at its own height, in its own tone
 * (placements alternate the tone per plane). Unlit palette colour, drawn first as the backdrop: it neither tests nor
 * writes depth, so the marks and links over it never fight it. Preallocated at mount; only an overflow recreates it.
 * A placement swap is 2 ranged uploads; a theme flip touches only the shared palette uniform.
 */

import { DoubleSide, DynamicDrawUsage, Float32BufferAttribute, GLSL3, Group, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, ShaderMaterial, type IUniform, type Vector3 } from 'three';
import { PALETTE_SIZE } from '../tones';
import { uploadRange, type StageStats } from '../stats';
import type { PlaneSpec } from '../types';

/** Planes preallocated at mount: a map has a band per layer (≤ ~12), a graph a plane per partition. */
export const PLANE_CAPACITY = 64;

const QUAD = [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1];

const VERTEX = /* glsl */ `
in vec4 aRect;   // min x, min z, max x, max z
in vec2 aPlane;  // y, tone
uniform vec3 uPalette[${PALETTE_SIZE}];
out vec3 vColor;
void main() {
    vColor = uPalette[int(aPlane.y + 0.5)];
    vec3 p = vec3(mix(aRect.x, aRect.z, position.x), aPlane.x, mix(aRect.y, aRect.w, position.z));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() { fragColor = vec4(vColor, 1.0); }`;

export class PlaneLayer {
    readonly group = new Group();
    private mesh!: InstancedMesh;
    private rect!: InstancedBufferAttribute;
    private plane!: InstancedBufferAttribute;
    private capacity = 0;

    constructor(private readonly stats: StageStats, private readonly palette: IUniform<Vector3[]>) {
        this.create(PLANE_CAPACITY);
    }

    set(planes: readonly PlaneSpec[]): void {
        if (planes.length > this.capacity) this.create(Math.max(planes.length, this.capacity * 2));
        const r = this.rect.array as Float32Array, q = this.plane.array as Float32Array;
        planes.forEach((p, i) => {
            r[i * 4] = Math.min(p.min[0], p.max[0]); r[i * 4 + 1] = Math.min(p.min[2], p.max[2]);
            r[i * 4 + 2] = Math.max(p.min[0], p.max[0]); r[i * 4 + 3] = Math.max(p.min[2], p.max[2]);
            q[i * 2] = p.min[1]; q[i * 2 + 1] = p.tone;
        });
        uploadRange(this.stats, this.rect, 0, planes.length);
        uploadRange(this.stats, this.plane, 0, planes.length);
        this.mesh.count = planes.length;
    }

    get count(): number { return this.mesh.count; }
    set visible(v: boolean) { this.group.visible = v; }
    get visible(): boolean { return this.group.visible; }

    private create(capacity: number): void {
        this.dispose();
        const geometry = new InstancedBufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(QUAD, 3));
        this.rect = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
        this.plane = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(DynamicDrawUsage);
        geometry.setAttribute('aRect', this.rect);
        geometry.setAttribute('aPlane', this.plane);
        const material = new ShaderMaterial({
            glslVersion: GLSL3, vertexShader: VERTEX, fragmentShader: FRAGMENT,
            uniforms: { uPalette: this.palette }, depthTest: false, depthWrite: false, side: DoubleSide,
        });
        this.mesh = new InstancedMesh(geometry, material, capacity);
        this.stats.meshesCreated++;
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = -1;
        this.mesh.name = 'planes';
        this.group.add(this.mesh);
        this.capacity = capacity;
    }

    dispose(): void {
        if (!this.mesh) return;
        this.group.remove(this.mesh);
        this.mesh.geometry.dispose();
        (this.mesh.material as ShaderMaterial).dispose();
    }
}
