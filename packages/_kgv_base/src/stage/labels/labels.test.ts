import { describe, expect, it } from 'vitest';
import { fixedFontPort, monoCovers, documentFontPort, fontUrlsOf, monoFaceUrl } from '../fonts';
import type { LabelRun, Placement } from '../types';
import { LabelFade, LABEL_FADE_MS } from './fade';
import { LabelLayer, type LabelText, type TextPort } from './LabelLayer';
import { LABEL_LOD, minMarkPxFor } from './lod';
import { placeLabels } from './runs';

const run = (slot: number, text: string, over: Partial<LabelRun> = {}): LabelRun => ({
    slot, text, offsetPx: [0, 10], font: 'mono', size: 11, weight: 500, anchor: 'middle', tone: 3, halo: { tone: 0, px: 3 }, priority: 1, scale: 'world', ...over,
});

/** Three slots: two shown at scale 5, one hidden (scale 0). */
const placed = (dx = 0): Pick<Placement, 'position' | 'scale' | 'extrude' | 'labels'> => ({
    position: new Float32Array([100 + dx, 0, 50, 200 + dx, 0, 80, 0, 0, 0]),
    scale: new Float32Array([5, 5, 0]),
    extrude: new Float32Array([0, 20, 0]),
    labels: [run(0, 'alpha'), run(1, 'beta', { scale: 'screen', offsetPx: [4, 8] }), run(2, 'hidden')],
});

function fakePort() {
    const added = new Set<LabelText>();
    let created = 0;
    const port: TextPort = {
        object: null,
        create: () => {
            created++;
            const at = { x: 0, y: 0, z: 0 };
            return { text: '', font: null, fontSize: 0, anchorX: 0, color: null, outlineWidth: 0, outlineColor: 0, fillOpacity: 1, outlineOpacity: 1, at, position: { set: (x: number, y: number, z: number) => Object.assign(at, { x, y, z }) }, dispose() {} } as LabelText & { at: typeof at };
        },
        add: (t) => added.add(t),
        remove: (t) => added.delete(t),
        dispose() {},
    };
    return { port, added, created: () => created };
}

describe('label runs per zoom band (B4 detail by zoom)', () => {
    it('shows a run only inside its zoomPx span, and adds its world offset before the px offset', () => {
        const p = placed();
        const banded = [run(0, 'near', { scale: 'screen', offsetPx: [4, 0], offsetWorld: [5, 0], zoomPx: [1, 2] })];
        expect(placeLabels(banded, p, { pxPerWorld: 0.99, depth: 0 }, true).sdf).toEqual([]);
        expect(placeLabels(banded, p, { pxPerWorld: 2, depth: 0 }, true).sdf).toEqual([]);
        const [l] = placeLabels(banded, p, { pxPerWorld: 1.5, depth: 0 }, true).sdf;
        expect(l!.position[0]).toBeCloseTo(100 + 5 + 4 / 1.5, 5);
    });
});

describe('label runs (slot-relative, B1a rule 4)', () => {
    it('places a run at its slot plus its offset: world offsets in world units, screen offsets in px', () => {
        const { sdf, dom } = placeLabels(placed().labels, placed(), { pxPerWorld: 2, depth: 1 }, true);
        expect(dom).toEqual([]);
        expect(sdf.map((l) => l.text)).toEqual(['alpha', 'beta']); // the hidden slot's run never shows
        const [a, b] = [sdf.find((l) => l.text === 'alpha')!, sdf.find((l) => l.text === 'beta')!];
        expect([a.position[0], a.position[2]]).toEqual([100, 60]);
        expect(a.fontSize).toBe(11);
        expect([b.position[0], b.position[2]]).toEqual([202, 84]);
        expect(b.fontSize).toBeCloseTo(5.5);
        expect(b.position[1]).toBeGreaterThan(20); // on top of its extruded mark at full depth
    });

    it('drops runs whose mark is too small for their priority (lod.ts as data) and caps the count', () => {
        expect(minMarkPxFor(1)).toBe(LABEL_LOD.steps[0]!.minMarkPx);
        const runs = [run(0, 'big', { priority: 0.9 }), run(1, 'small', { priority: 0 })];
        // Marks 2 × 5 × 0.5 = 5 px: the important run survives, the minor one does not.
        expect(placeLabels(runs, placed(), { pxPerWorld: 0.5, depth: 0 }, true).sdf.map((l) => l.text)).toEqual(['big']);
        const many = Array.from({ length: 3 }, (_, i) => run(i % 2, `n${i}`));
        expect(placeLabels(many, placed(), { pxPerWorld: 4, depth: 0 }, true, { ...LABEL_LOD, maxLabels: 2 }).sdf).toHaveLength(2);
    });

    it('hands a name the SDF font cannot draw — or every name, with no host font — to the DOM caption layer', () => {
        expect(monoCovers('src/app.ts')).toBe(true);
        expect(monoCovers('模块')).toBe(false);
        const runs = [run(0, '模块'), run(1, 'ok')];
        const routed = placeLabels(runs, placed(), { pxPerWorld: 4, depth: 0 }, true);
        expect(routed.sdf.map((l) => l.text)).toEqual(['ok']);
        expect(routed.dom).toEqual([expect.objectContaining({ text: '模块', font: 'mono' })]);
        expect(placeLabels(runs, placed(), { pxPerWorld: 4, depth: 0 }, false).sdf).toEqual([]);
    });
});

describe('the label fade around a tween (B1a rule 5)', () => {
    it('fades out when a tween begins, stays hidden, is placed when it lands, then fades in', () => {
        const f = new LabelFade();
        expect(f.opacity(0)).toBe(1);
        f.tweenBegan(0);
        expect(f.opacity(LABEL_FADE_MS / 2)).toBeCloseTo(0.5);
        expect(f.opacity(LABEL_FADE_MS)).toBe(0);
        expect(f.state).toBe('hidden');
        expect(f.takePlacement()).toBe(false);
        f.landed(400);
        expect(f.takePlacement()).toBe(true);
        expect(f.takePlacement()).toBe(false);
        expect(f.opacity(400)).toBe(0);
        expect(f.opacity(400 + LABEL_FADE_MS)).toBe(1);
        expect(f.state).toBe('shown');
    });

    it('a 0 ms land (reduced motion) shows at once', () => {
        const f = new LabelFade();
        f.landed(0, false);
        expect(f.opacity(0)).toBe(1);
        expect(f.animating).toBe(false);
    });
});

describe('LabelLayer', () => {
    it('places labels only after the tween lands, and reuses a run\'s text object on the way back', () => {
        const { port, added, created } = fakePort();
        const layer = new LabelLayer(port, fixedFontPort({ 500: 'https://host/jbm-500.woff2' }));
        const view = { pxPerWorld: 4, depth: 0 };
        layer.setPlacement(placed(), 0, false);
        layer.tick(0, view);
        expect(layer.shown).toEqual(['0:alpha', '1:beta']);
        expect(created()).toBe(2);
        const first = [...added][0] as LabelText & { at: { x: number } };
        expect(first.font).toBe('https://host/jbm-500.woff2');

        const before = layer.placements;
        layer.setPlacement(placed(50), 10, true);
        layer.tick(10 + LABEL_FADE_MS, view);
        layer.tick(200, view);
        expect(layer.placements).toBe(before); // not mid-tween
        expect(layer.opacity).toBe(0);
        layer.landed(410);
        layer.tick(410, view);
        expect(layer.placements).toBe(before + 1);
        expect(first.at.x).toBe(150); // moved to the target placement
        layer.tick(410 + LABEL_FADE_MS, view);
        expect(layer.opacity).toBe(1);
        expect(created()).toBe(2); // same runs: no new text object
    });

    it('a theme flip rewrites colours only', () => {
        const { port, added } = fakePort();
        const layer = new LabelLayer(port, fixedFontPort({ 500: 'u' }));
        layer.setPlacement(placed(), 0, false);
        layer.tick(0, { pxPerWorld: 4, depth: 0 });
        const placements = layer.placements;
        layer.setPalette({ text: '#111111', bg: '#ffffff' } as never);
        expect(layer.placements).toBe(placements);
        expect([...added].every((t) => t.outlineColor === '#ffffff')).toBe(true);
    });
});

describe('the host font port', () => {
    it('reads the host\'s @fontsource face as an absolute URL, skipping the woff2 troika cannot parse', () => {
        const face = (w: number) => ({
            cssText: `@font-face { font-family: "JetBrains Mono"; font-style: normal; font-weight: ${w}; src: url("/assets/jbm-${w}.woff2") format("woff2"), url("/assets/jbm-${w}.woff") format("woff"); }`,
            base: 'https://host.example/app/',
        });
        const faces = [{ cssText: '@font-face { font-family: Inter; font-weight: 500; src: url(/inter.woff) }', base: 'https://host.example/' }, face(400), face(500)];
        expect(monoFaceUrl(faces, 500)).toBe('https://host.example/assets/jbm-500.woff');
        expect(monoFaceUrl(faces, 700)).toBe('https://host.example/assets/jbm-400.woff'); // falls back to the regular face
        expect(monoFaceUrl([], 500)).toBeNull();
        // A woff2-only face is dropped before the weight is chosen: the usable 400 wins over the unreadable 500.
        const woff2Only = { cssText: '@font-face { font-family: "JetBrains Mono"; font-weight: 500; src: url("/x-500.woff2") format("woff2"); }', base: 'https://host.example/' };
        expect(monoFaceUrl([woff2Only, face(400)], 500)).toBe('https://host.example/assets/jbm-400.woff');
        expect(monoFaceUrl([woff2Only], 500)).toBeNull();
        expect(fontUrlsOf(`url('b.woff2') format("woff2"), url("a.woff") format("woff")`)).toEqual(['a.woff']);
        // No host face in the document: no SDF labels (the names go to the DOM), never a CDN.
        expect(documentFontPort(document).monoUrl(500)).toBeNull();
    });
});
