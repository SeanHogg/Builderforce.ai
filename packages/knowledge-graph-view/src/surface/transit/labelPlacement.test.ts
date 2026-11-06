import { describe, expect, it } from 'vitest';
import { clip, MAX_NAME, placeLabels, type LabelItem } from './labelPlacement';

const item = (id: string, x: number, y: number, over: Partial<LabelItem> = {}): LabelItem => ({ id, x, y, r: 8, name: id, note: null, ...over });

describe('placeLabels', () => {
    it('puts a lone label under its station, centred, with the note beneath the name', () => {
        const p = placeLabels([item('api', 200, 100, { note: 'no tests · god' })], { width: 400 }).get('api')!;
        expect(p.side).toBe('bottom');
        expect(p.anchor).toBe('middle');
        expect(p.x).toBe(200);
        expect(p.noteY).toBeGreaterThan(p.y);
    });

    it('moves a label to another side when its neighbour\'s label is in the way', () => {
        const placed = placeLabels([item('left-station', 100, 100, { name: 'a-rather-long-station-name' }), item('right-station', 170, 100, { name: 'another-long-station-name' })], { width: 600 });
        const boxes = [...placed.values()].map((l) => l.box);
        const overlaps = boxes[0]!.x < boxes[1]!.x + boxes[1]!.w && boxes[1]!.x < boxes[0]!.x + boxes[0]!.w && boxes[0]!.y < boxes[1]!.y + boxes[1]!.h && boxes[1]!.y < boxes[0]!.y + boxes[0]!.h;
        expect(overlaps).toBe(false);
        expect(new Set([...placed.values()].map((l) => l.side)).size).toBeGreaterThan(1);
    });

    it('keeps a label inside the drawing and off an obstacle', () => {
        const edge = placeLabels([item('edge', 6, 100, { name: 'at-the-left-edge' })], { width: 300 }).get('edge')!;
        expect(edge.box.x).toBeGreaterThanOrEqual(0);
        const blocked = placeLabels([item('s', 200, 100)], { width: 400, obstacles: [{ x: 150, y: 105, w: 100, h: 40 }] }).get('s')!;
        expect(blocked.side).not.toBe('bottom');
    });

    it('keeps a label inside the bottom of the drawing too', () => {
        const low = placeLabels([item('low', 200, 190)], { width: 400, height: 200 }).get('low')!;
        expect(low.box.y + low.box.h).toBeLessThanOrEqual(200);
        expect(low.side).not.toBe('bottom');
    });

    it('places 400 labels within a generous budget', () => {
        const items = Array.from({ length: 400 }, (_, i) => item(`station-${i}`, 60 + (i % 20) * 96, 40 + Math.floor(i / 20) * 120, { note: 'no tests · god' }));
        const t0 = performance.now();
        const placed = placeLabels(items, { width: 2200, height: 2500 });
        expect(performance.now() - t0).toBeLessThan(2000);
        expect(placed.size).toBe(400);
    });

    it('does not centre-truncate a name at 16 characters, only past the cap', () => {
        const mid = placeLabels([item('s', 300, 100, { name: 'projectKnowledgeRoutes' })], { width: 600 }).get('s')!;
        expect(mid.text).toBe('projectKnowledgeRoutes');
        expect(clip('x'.repeat(40), MAX_NAME)).toHaveLength(MAX_NAME);
        expect(clip('x'.repeat(40), MAX_NAME).endsWith('…')).toBe(true);
    });
});
