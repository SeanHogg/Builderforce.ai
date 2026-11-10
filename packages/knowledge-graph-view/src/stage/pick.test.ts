import { describe, expect, it } from 'vitest';
import { nearestHit, type HitCandidate } from '../hitTest';
import { linkBatch } from '../compute/tasks/placement/links';
import { cameraProjector, frameProjector, LINK_TARGET_PX, PICK_TARGET_PX, PickIndex, type Projector } from './pick';
import { RigController } from './rig/rig';
import { FLAG, type Placement } from './types';

/** A seeded generator, so the fixtures are the same on every run. */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

type Marks = Pick<Placement, 'position' | 'scale' | 'extrude' | 'links'>;

/** `n` marks scattered over a `w` × `h` world, some hidden, some stacked exactly on another (distance ties). */
function scatter(n: number, w: number, h: number, seed = 7): { marks: Marks; keys: string[]; importance: Float32Array } {
    const r = rng(seed);
    const position = new Float32Array(n * 3), scale = new Float32Array(n), extrude = new Float32Array(n), importance = new Float32Array(n);
    const keys: string[] = [];
    for (let i = 0; i < n; i++) {
        const twin = i > 0 && r() < 0.1 ? Math.floor(r() * i) : -1;
        position[i * 3] = twin >= 0 ? position[twin * 3]! : Math.round(r() * w);
        position[i * 3 + 2] = twin >= 0 ? position[twin * 3 + 2]! : Math.round(r() * h);
        scale[i] = r() < 0.08 ? 0 : 2 + Math.round(r() * 6);
        importance[i] = Math.round(r() * 4) / 4;
        keys.push(`node:k${String(Math.floor(r() * 1e6)).padStart(6, '0')}-${i}`);
    }
    return { marks: { position, scale, extrude, links: [] }, keys, importance };
}

const frame = { zoom: 1.5, cx: 400, cz: 250, width: 800, height: 500 };

describe('stage picking (PRD 43 B5)', () => {
    it('is exactly hitTest.nearestHit over the projected centres: nearest within 40 px, ties by importance then id', () => {
        const { marks, keys, importance } = scatter(1500, 800, 500);
        const projector = frameProjector(frame);
        const index = PickIndex.build(marks, projector, { keys, importance });
        const candidates: HitCandidate[] = [];
        for (let s = 0; s < keys.length; s++) {
            const at = index.screenOf(s);
            if (at) candidates.push({ id: keys[s]!, x: at[0], y: at[1], importance: importance[s]! });
        }
        expect(candidates.length).toBeLessThan(keys.length); // the hidden ones are not candidates
        const r = rng(3);
        let hits = 0;
        for (let q = 0; q < 2000; q++) {
            // A pointer is on the stage: anywhere in its box.
            const sx = r() * frame.width, sy = r() * frame.height;
            const want = nearestHit(candidates, sx, sy, PICK_TARGET_PX);
            const got = index.pickMark(sx, sy);
            expect(got < 0 ? null : keys[got]).toBe(want);
            if (want) hits++;
        }
        // Also exactly on a mark (the tie cases: twins share a centre).
        const inBox = candidates.filter((c) => c.x >= 0 && c.y >= 0 && c.x <= frame.width && c.y <= frame.height);
        for (const c of inBox.slice(0, 300)) expect(keys[index.pickMark(c.x, c.y)]).toBe(nearestHit(candidates, c.x, c.y, PICK_TARGET_PX));
        expect(hits).toBeGreaterThan(500);
    });

    it('never picks a hidden slot, and covers an extruded body from its base to its top', () => {
        const marks: Marks = { position: Float32Array.from([100, 0, 100, 300, 0, 100]), scale: Float32Array.from([0, 4]), extrude: Float32Array.from([0, 60]), links: [] };
        // A tilted camera: height moves a point up the screen (as the rig's projection does).
        const tilt: Projector = { width: 400, height: 300, pxPerWorld: 1, key: 't', project: (x, y, z, out) => { out[0] = x; out[1] = z - y; return true; } };
        const index = PickIndex.build(marks, tilt);
        expect(index.pickMark(100, 100)).toBe(-1);
        expect(index.pickMark(300, 100)).toBe(1);   // the base
        expect(index.pickMark(300, 40)).toBe(1);    // the top, 60 px up
        expect(index.pickMark(300, 70)).toBe(1);    // the wall between
        // At half depth (the depth control's `uDepth`) the tower is drawn 30 tall: its top is there, not at 60.
        const half = PickIndex.build(marks, tilt, { extrudeScale: 0.5 });
        expect(half.pickMark(300, 70)).toBe(1);
        expect(half.pickMark(300, 40 - PICK_TARGET_PX + 5)).toBe(-1);
        expect(index.pickMark(300, 40 - PICK_TARGET_PX + 5)).toBe(1);
    });

    it('picks through the rig\'s tilted projection: a tilted Map is picked where it is drawn, not top-down', () => {
        const rig = new RigController();
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, { depth: { tilt: [0, 60], orbit: false } }, 800, 600, 0, 0);
        rig.setDepth(1);
        // A station 200 deep on the map with a 100-tall tower.
        const marks: Marks = { position: Float32Array.from([0, 0, 200]), scale: Float32Array.from([6]), extrude: Float32Array.from([100]), links: [] };
        const flat = frameProjector(rig.frame());
        const index = PickIndex.build(marks, rig.projector());
        const [tx, ty] = rig.project(0, 100, 200);
        expect(index.pickMark(tx, ty)).toBe(0);                     // the tower top, where the tilted camera draws it
        const out = new Float64Array(2);
        flat.project(0, 0, 200, out);
        expect(index.pickMark(out[0]!, out[1]!)).toBe(-1);         // the top-down spot is empty under tilt
        // The grid projects through the rig's projection read as a matrix (one tight loop): the same point to rounding.
        const [rx, ry] = rig.project(0, 0, 200), got = index.screenOf(0)!;
        expect(got[0]).toBeCloseTo(rx, 9); expect(got[1]).toBeCloseTo(ry, 9);
    });

    it('picks a selectable line segment (a route) when no mark is in reach, naming its batch, segment and polyline', () => {
        const route = linkBatch('route', [{ pts: [{ x: 0, y: 200 }, { x: 600, y: 200 }], tone: 1, width: 6, dash: 0, flags: FLAG.SELECTABLE }], 0);
        const marks: Marks = { position: Float32Array.from([50, 0, 50]), scale: Float32Array.from([4]), extrude: new Float32Array(1), links: [route] };
        const index = PickIndex.build(marks, frameProjector({ zoom: 1, cx: 300, cz: 200, width: 600, height: 400 }), { links: marks.links });
        expect(index.pick(300, 200 + LINK_TARGET_PX - 1)).toEqual({ kind: 'link', batch: 0, segment: 0, group: 0, slot: -1, line: null });
        expect(index.pick(300, 200 + LINK_TARGET_PX + 2)).toBeNull();
        expect(index.pick(50, 50)).toEqual({ kind: 'mark', slot: 0 });
    });

    it('picks a glyph as its slot', () => {
        const marks: Marks = { position: Float32Array.from([100, 0, 100]), scale: Float32Array.from([4]), extrude: new Float32Array(1), links: [] };
        const glyphs = [{ slot: Uint32Array.from([0]), position: Float32Array.from([100, 0, 30]) }];
        const index = PickIndex.build(marks, frameProjector({ zoom: 1, cx: 200, cz: 200, width: 400, height: 400 }), { glyphs });
        expect(index.pickMark(100, 30)).toBe(0);
    });

    it('projects through a three.js camera matrix the same way as the fitted frame (top-down orthographic)', () => {
        // An orthographic camera looking straight down −y with screen-up = −z, as the stage poses it.
        const zoom = 2, w = 400, h = 300, cx = 50, cz = 80;
        const l = -w / 2 / zoom, r = w / 2 / zoom, t = h / 2 / zoom, b = -h / 2 / zoom, near = 1, far = 4000;
        const proj = [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (far - near), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(far + near) / (far - near), 1];
        // View: world x → camera x, world z → camera −y (screen down), world y → camera z, camera at (cx, 1000, cz).
        const view = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, -cx, cz, -1000, 1];
        const cam = cameraProjector({ projectionMatrix: { elements: proj }, matrixWorldInverse: { elements: view } }, w, h);
        const fit = frameProjector({ zoom, cx, cz, width: w, height: h });
        const a = new Float64Array(2), c = new Float64Array(2);
        for (const [x, z] of [[50, 80], [0, 0], [120, -40]] as const) {
            cam.project(x, 0, z, a); fit.project(x, 0, z, c);
            expect(a[0]).toBeCloseTo(c[0]!, 6); expect(a[1]).toBeCloseTo(c[1]!, 6);
        }
        expect(cam.pxPerWorld).toBeCloseTo(zoom, 6);
    });

    it('benchmark: a settle at 10k slots is one projection per shown slot; a query reads a handful of candidates', () => {
        const { marks, keys } = scatter(10_000, 4000, 2500, 11);
        const shown = Array.from(marks.scale).filter((s) => s > 0).length;
        const projector = frameProjector({ zoom: 0.3, cx: 2000, cz: 1250, width: 1280, height: 800 });
        const t0 = performance.now();
        const index = PickIndex.build(marks, projector, { keys });
        const ms = performance.now() - t0;
        expect(index.counters.projected).toBe(shown);
        const r = rng(5);
        let worst = 0;
        for (let q = 0; q < 200; q++) { index.pickMark(r() * 1280, r() * 800); worst = Math.max(worst, index.counters.candidatesTested); }
        expect(index.counters.cellsVisited).toBeLessThanOrEqual(9);
        // ~9k marks over 1280×800 px is ~14 per 40 px cell: a query reads its 3×3 cells, never the 9k.
        expect(worst).toBeLessThan(shown / 20);
        // Wall clock is reported, never asserted (the target is ≈0.3 ms on a desktop; CI machines vary).
        console.info(`[pick] 10k-slot settle: ${ms.toFixed(2)} ms, ${index.counters.projected} projections, worst query ${worst} candidates`);
    });

    it('a settle that reuses the previous settle\'s buffers answers exactly as a fresh build, and retires the old index', () => {
        const { marks, keys, importance } = scatter(3000, 1600, 1000, 17);
        const a = frameProjector({ zoom: 0.8, cx: 800, cz: 500, width: 1280, height: 800 });
        const b = frameProjector({ zoom: 1.1, cx: 700, cz: 450, width: 1280, height: 800 });
        const first = PickIndex.build(marks, a, { keys, importance });
        const reused = PickIndex.build(marks, b, { keys, importance }, first);
        const fresh = PickIndex.build(marks, b, { keys, importance });
        expect(first.retired).toBe(true);
        const r = rng(21);
        for (let q = 0; q < 1000; q++) { const x = r() * 1280, y = r() * 800; expect(reused.pickMark(x, y)).toBe(fresh.pickMark(x, y)); }
        for (let s = 0; s < 3000; s += 7) expect(reused.screenOf(s)).toEqual(fresh.screenOf(s));
    });

    it('a zoomed-in view leaves the off-screen marks out of the grid (they cannot pile into the border cells)', () => {
        const { marks } = scatter(10_000, 4000, 2500, 13);
        const index = PickIndex.build(marks, frameProjector({ zoom: 4, cx: 2000, cz: 1250, width: 800, height: 500 }));
        const r = rng(9);
        let worst = 0;
        for (let q = 0; q < 200; q++) { index.pickMark(r() < 0.5 ? 1 : 799, r() * 500); worst = Math.max(worst, index.counters.candidatesTested); }
        expect(worst).toBeLessThan(40);
    });
});
