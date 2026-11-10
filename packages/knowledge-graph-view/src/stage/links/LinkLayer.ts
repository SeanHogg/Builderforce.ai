/**
 * The links on the stage: ONE instanced-quad mesh per link family (`route`, `edge`, `describes`, `wall`, `arrow`), all
 * drawn by the one line shader (`shader.ts`). Every family's mesh is PREALLOCATED when the layer is built (the stage's
 * mount) at its `LINK_FAMILY_STYLE` capacity, so no placement — the first included — creates a mesh; only an overflow
 * recreates one (doubling). A placement swap is 3 ranged uploads per family it brings (`aA`, `aB`, `aStyle`); its width
 * unit and casing are uniforms. Links are hidden while marks tween and show the target placement's when it lands.
 */

import { DynamicDrawUsage, Float32BufferAttribute, Group, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, type ShaderMaterial } from 'three';
import { capacityFor } from '../slots';
import { uploadRange, type StageStats } from '../stats';
import { LINK_FAMILIES, type LinkBatch, type LinkFamily } from '../types';
import { LINK_FAMILY_STYLE } from './families';
import { linkMaterial, setLinkStyle, type LinkUniforms } from './shader';

interface Family { mesh: InstancedMesh; a: InstancedBufferAttribute; b: InstancedBufferAttribute; style: InstancedBufferAttribute; capacity: number }

/** The segment quad: x along (0 at A, 1 at B), y across (−1..1). */
const QUAD = [0, -1, 0, 1, -1, 0, 1, 1, 0, 0, -1, 0, 1, 1, 0, 0, 1, 0];

/** Segments of a batch: consecutive non-break points. */
export function segmentsOf(batch: LinkBatch): number {
    let n = 0;
    const p = batch.points;
    for (let i = 1; i < p.length / 3; i++) if (!Number.isNaN(p[i * 3]!) && !Number.isNaN(p[(i - 1) * 3]!)) n++;
    return n;
}

export class LinkLayer {
    readonly group = new Group();
    private readonly families = new Map<LinkFamily, Family>();

    /** `families`: the ones to preallocate (the stage: all; an overlay that draws only `edge`: that one). */
    constructor(private readonly stats: StageStats, private readonly uniforms: LinkUniforms, families: readonly LinkFamily[] = LINK_FAMILIES) {
        this.group.renderOrder = 1;
        for (const family of families) this.create(family, LINK_FAMILY_STYLE[family].capacity);
    }

    /** Shows `batches` (a placement's links); every family not in them draws nothing. */
    set(batches: readonly LinkBatch[]): void {
        const seen = new Set<LinkFamily>();
        for (const batch of batches) {
            seen.add(batch.family);
            const count = segmentsOf(batch);
            const fam = this.familyFor(batch.family, count);
            setLinkStyle(fam.mesh.material as ShaderMaterial, batch.widthUnit, batch.casing);
            fill(batch, fam);
            uploadRange(this.stats, fam.a, 0, count);
            uploadRange(this.stats, fam.b, 0, count);
            uploadRange(this.stats, fam.style, 0, count);
            fam.mesh.count = count;
            const groups = batch.group.length ? batch.group[batch.group.length - 1]! + 1 : 1;
            (fam.mesh.material as ShaderMaterial).uniforms.uDepthStep!.value = 0.4 / (2 * groups + 2);
        }
        for (const [family, fam] of this.families) if (!seen.has(family)) fam.mesh.count = 0;
    }

    set visible(v: boolean) { this.group.visible = v; }
    get visible(): boolean { return this.group.visible; }

    /** The family's mesh, recreated (the only creation after mount) when `count` overflows it. */
    private familyFor(family: LinkFamily, count: number): Family {
        const held = this.families.get(family);
        if (!held) return this.create(family, Math.max(capacityFor(count), LINK_FAMILY_STYLE[family].capacity));
        if (held.capacity >= count) return held;
        this.group.remove(held.mesh); held.mesh.geometry.dispose(); (held.mesh.material as ShaderMaterial).dispose();
        return this.create(family, Math.max(capacityFor(count), held.capacity * 2));
    }

    private create(family: LinkFamily, capacity: number): Family {
        const geometry = new InstancedBufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(QUAD, 3));
        const attr = () => new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
        const a = attr(), b = attr(), style = attr();
        geometry.setAttribute('aA', a); geometry.setAttribute('aB', b); geometry.setAttribute('aStyle', style);
        const mesh = new InstancedMesh(geometry, linkMaterial(this.uniforms, LINK_FAMILY_STYLE[family].widthUnit, undefined), capacity);
        this.stats.meshesCreated++;
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;
        mesh.name = `links:${family}`;
        this.group.add(mesh);
        const fam: Family = { mesh, a, b, style, capacity };
        this.families.set(family, fam);
        return fam;
    }

    get meshes(): readonly InstancedMesh[] { return [...this.families.values()].map((f) => f.mesh); }

    dispose(): void {
        for (const f of this.families.values()) { this.group.remove(f.mesh); f.mesh.geometry.dispose(); (f.mesh.material as ShaderMaterial).dispose(); }
        this.families.clear();
    }
}

function fill(batch: LinkBatch, fam: Family): void {
    const p = batch.points, run = batch.runLength;
    const a = fam.a.array as Float32Array, b = fam.b.array as Float32Array, st = fam.style.array as Float32Array;
    let s = 0;
    for (let i = 1; i < p.length / 3; i++) {
        if (Number.isNaN(p[i * 3]!) || Number.isNaN(p[(i - 1) * 3]!)) continue;
        a[s * 4] = p[(i - 1) * 3]!; a[s * 4 + 1] = p[(i - 1) * 3 + 1]!; a[s * 4 + 2] = p[(i - 1) * 3 + 2]!; a[s * 4 + 3] = run[i - 1]!;
        b[s * 4] = p[i * 3]!; b[s * 4 + 1] = p[i * 3 + 1]!; b[s * 4 + 2] = p[i * 3 + 2]!; b[s * 4 + 3] = batch.width[s]!;
        st[s * 4] = batch.tone[s]!; st[s * 4 + 1] = batch.dash[s]!; st[s * 4 + 2] = batch.flags[s]!; st[s * 4 + 3] = batch.group[s]!;
        s++;
    }
}
