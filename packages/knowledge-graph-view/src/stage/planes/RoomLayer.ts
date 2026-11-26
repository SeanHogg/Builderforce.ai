/**
 * The FLOOR PLATE of a level (the design's room): a lit slab under the shapes that stand on it, tinted by its tone (the
 * floor at the top level, the room inside a shape), its edges outlined in the plate's `edge` tone (the lit accent, or the
 * warn tone when the room is risky). ONE instanced box mesh plus ONE instanced edge-line mesh, both preallocated at mount
 * (a level change creates none); a placement writes `PlaneSpec`s of kind `room` — `min[1]` the plate's underside, `max[1]`
 * its top face. Depth-tested and written (shapes stand ON it, their contact shadows land on its top), drawn first.
 */

import {
    BoxGeometry, DoubleSide, DynamicDrawUsage, EdgesGeometry, Float32BufferAttribute, GLSL3, Group, InstancedBufferAttribute,
    InstancedBufferGeometry, InstancedMesh, LineSegments, ShaderMaterial, type IUniform, type Vector3,
} from 'three';
import { LIGHT_GLSL } from '../lighting';
import { PALETTE_SIZE } from '../tones';
import { uploadRange, type StageStats } from '../stats';
import type { PlaneSpec } from '../types';

/** Rooms preallocated at mount: one per drawn level (a level change swaps the one). */
export const ROOM_CAPACITY = 8;

const VERTEX = /* glsl */ `
in vec4 aRect;   // min x, min z, max x, max z
in vec4 aRoom;   // underside y, top y, tone, edge tone
uniform vec3 uPalette[${PALETTE_SIZE}];
uniform float uEdges;
out vec3 vColor;
${LIGHT_GLSL}
void main() {
    vec3 unit = uEdges > 0.5 ? position : position + 0.5;   // an edge vertex is already 0..1; a box vertex is -.5..+.5
    vec3 p = vec3(mix(aRect.x, aRect.z, unit.x), mix(aRoom.x, aRoom.y, unit.y), mix(aRect.y, aRect.w, unit.z));
    vec3 n = uEdges > 0.5 ? vec3(0.0, 1.0, 0.0) : normal;
    vColor = uEdges > 0.5 ? uPalette[int(aRoom.w + 0.5)] : uPalette[int(aRoom.z + 0.5)] * clamp(stageLight(n), 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() { fragColor = vec4(vColor, 1.0); }`;

export class RoomLayer {
    readonly group = new Group();
    private readonly rect: InstancedBufferAttribute;
    private readonly room: InstancedBufferAttribute;
    private readonly box: InstancedMesh;
    private readonly edges: LineSegments;
    private readonly edgeGeometry: InstancedBufferGeometry;
    private readonly materials: ShaderMaterial[] = [];

    constructor(private readonly stats: StageStats, palette: IUniform<Vector3[]>) {
        this.rect = new InstancedBufferAttribute(new Float32Array(ROOM_CAPACITY * 4), 4).setUsage(DynamicDrawUsage);
        this.room = new InstancedBufferAttribute(new Float32Array(ROOM_CAPACITY * 4), 4).setUsage(DynamicDrawUsage);
        const material = (edges: number): ShaderMaterial => {
            const m = new ShaderMaterial({
                glslVersion: GLSL3, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: DoubleSide,
                uniforms: { uPalette: palette, uEdges: { value: edges } },
            });
            this.materials.push(m);
            return m;
        };
        const src = new BoxGeometry(1, 1, 1);
        const boxGeometry = new InstancedBufferGeometry();
        boxGeometry.setIndex(src.getIndex());
        boxGeometry.setAttribute('position', src.getAttribute('position'));
        boxGeometry.setAttribute('normal', src.getAttribute('normal'));
        boxGeometry.setAttribute('aRect', this.rect);
        boxGeometry.setAttribute('aRoom', this.room);
        this.box = new InstancedMesh(boxGeometry, material(0), ROOM_CAPACITY);
        this.box.count = 0;
        this.box.frustumCulled = false;
        this.box.renderOrder = -1;
        this.box.name = 'rooms';
        stats.meshesCreated++;
        // The 12 edges of the unit box (0..1), drawn once per room.
        const unit = new EdgesGeometry(new BoxGeometry(1, 1, 1)).translate(0.5, 0.5, 0.5);
        this.edgeGeometry = new InstancedBufferGeometry();
        this.edgeGeometry.setAttribute('position', unit.getAttribute('position'));
        this.edgeGeometry.setAttribute('normal', new Float32BufferAttribute(new Float32Array(unit.getAttribute('position').count * 3), 3));
        this.edgeGeometry.setAttribute('aRect', this.rect);
        this.edgeGeometry.setAttribute('aRoom', this.room);
        this.edgeGeometry.instanceCount = 0;
        this.edges = new LineSegments(this.edgeGeometry, material(1));
        this.edges.frustumCulled = false;
        this.edges.renderOrder = -1;
        this.edges.name = 'rooms:edges';
        stats.meshesCreated++;
        this.group.add(this.box, this.edges);
    }

    /** Draws the `room` specs of a placement (at most {@link ROOM_CAPACITY}); the rest of the planes are not this layer's. */
    set(planes: readonly PlaneSpec[]): void {
        const rooms = planes.filter((p) => p.kind === 'room').slice(0, ROOM_CAPACITY);
        const r = this.rect.array as Float32Array, q = this.room.array as Float32Array;
        rooms.forEach((p, i) => {
            r[i * 4] = Math.min(p.min[0], p.max[0]); r[i * 4 + 1] = Math.min(p.min[2], p.max[2]);
            r[i * 4 + 2] = Math.max(p.min[0], p.max[0]); r[i * 4 + 3] = Math.max(p.min[2], p.max[2]);
            q[i * 4] = Math.min(p.min[1], p.max[1]); q[i * 4 + 1] = Math.max(p.min[1], p.max[1]); q[i * 4 + 2] = p.tone; q[i * 4 + 3] = p.edge ?? p.tone;
        });
        uploadRange(this.stats, this.rect, 0, rooms.length);
        uploadRange(this.stats, this.room, 0, rooms.length);
        this.box.count = rooms.length;
        this.edgeGeometry.instanceCount = rooms.length;
    }

    get count(): number { return this.box.count; }

    dispose(): void {
        this.group.remove(this.box, this.edges);
        this.box.geometry.dispose();
        this.edgeGeometry.dispose();
        for (const m of this.materials) m.dispose();
    }
}
