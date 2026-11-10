import { describe, expect, it } from 'vitest';
import { bandCaption, overlaps, placeCaptions, type CaptionCandidate } from './captionPlacement';
import { layout2d, nodeRadius } from './layout2d';
import { partitionedFixture } from './testFixtures';

const noTwoOverlap = (boxes: ReadonlyArray<{ x: number; y: number; w: number; h: number }>) => {
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
};

describe('placeCaptions', () => {
    it('regression: folder captions on (almost) one spot no longer pile up — one per free side, the rest dropped', () => {
        const piled: CaptionCandidate[] = Array.from({ length: 8 }, (_, i) => ({ ref: `f${i}`, x: 10 + i * 0.01, y: 20, r: 1, text: `hired.video/frontend/lib/studio/editor-v${i}` }));
        const placed = placeCaptions(piled, 1);
        expect(placed.map((p) => p.ref)).toEqual(['f0', 'f1']);
        expect(placed.map((p) => p.anchor)).toEqual(['start', 'end']);
        noTwoOverlap(placed.map((p) => p.box));
    });

    it('places captions in the order given, so the first (the selection) always wins', () => {
        const a = { ref: 'sel', x: 0, y: 0, r: 1, text: 'selected.ts' }, b = { ref: 'other', x: 0, y: 0.2, r: 1, text: 'other.ts' };
        expect(placeCaptions([a, b, { ...b, ref: 'third' }], 1).map((p) => p.ref)).toEqual(['sel', 'other']);
    });

    it('keeps clear of the band captions', () => {
        const band = { partition: 'domain', top: 0, height: 10 };
        const caption = bandCaption(band, { minX: 0, maxX: 40, minY: 0, maxY: 10 }, 1, 'domain');
        const under = { ref: 'n', x: caption.box.x + caption.box.w / 2, y: caption.box.y + caption.box.h / 2, r: 0.3, text: 'x.ts' };
        expect(placeCaptions([under], 1, [caption.box])).toEqual([]);
        expect(placeCaptions([{ ...under, y: under.y + 5 }], 1, [caption.box])).toHaveLength(1);
        // The selection's name is never dropped, even with both sides taken.
        expect(placeCaptions([{ ...under, always: true }], 1, [caption.box]).map((p) => p.ref)).toEqual(['n']);
    });

    it('draws no two overlapping labels over a whole multi-partition layout, at every zoom', () => {
        const f = partitionedFixture();
        const l = layout2d('mono', f.nodes, f.edges);
        const candidates = [...f.nodes].sort((a, b) => b.importance - a.importance).map((n) => {
            const [x, y] = l.positions.get(n.ref)!;
            return { ref: n.ref, x, y, r: nodeRadius(n.importance), text: n.label };
        });
        for (const font of [0.5, 1, 2, 4]) {
            const bands = l.bands.map((b) => bandCaption(b, l.bounds, font, b.partition || 'No partition').box);
            const placed = placeCaptions(candidates, font, bands);
            expect(placed.length).toBeGreaterThan(0);
            noTwoOverlap([...bands, ...placed.map((p) => p.box)]);
        }
    });

    it('a pinned side is the only side tried: dropped when it is taken, never flipped', () => {
        const blocker: CaptionCandidate = { ref: 'a', x: 0, y: 0, r: 1, text: 'aaaa' };
        const right = placeCaptions([blocker, { ref: 'b', x: 0, y: 0, r: 1, text: 'b', side: 'start' }], 1);
        expect(right.map((c) => c.ref)).toEqual(['a']);
        const left = placeCaptions([blocker, { ref: 'b', x: 0, y: 0, r: 1, text: 'b', side: 'end' }], 1);
        expect(left.map((c) => [c.ref, c.anchor])).toEqual([['a', 'start'], ['b', 'end']]);
    });

    it('places nothing at a degenerate font', () => {
        expect(placeCaptions([{ ref: 'a', x: 0, y: 0, r: 1, text: 'a' }], 0)).toEqual([]);
    });
});
