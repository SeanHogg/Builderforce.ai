import { describe, expect, it } from 'vitest';
import { arcLength, GLYPH_EM, labelFits, labelFitsAt, textWidth } from './labelBudget';
import { mindMap } from './mindMapModel';
import type { KNode } from '@seanhogg/builderforce-memory/knowledge';

describe('label budget', () => {
    it('estimates a label as chars x font x 0.6', () => {
        expect(GLYPH_EM).toBe(0.6);
        expect(textWidth(10, 11)).toBeCloseTo(66, 9);
    });

    it('measures the arc as the radius times the branch\'s share in radians (2πr·span/total)', () => {
        expect(arcLength(10, Math.PI)).toBeCloseTo(2 * Math.PI * 10 * 0.5, 9);
        expect(arcLength(0, 2 * Math.PI)).toBe(0);
    });

    it('hides a label whose arc is too short and shows one with room', () => {
        // 20 chars at 11px need 132 units of arc.
        expect(labelFits(100, 0.01, 20, 11)).toBe(false);
        // `span` is in radians, so the arc is 100 x 1.5 = 150, which holds the 132 units the label needs.
        expect(labelFits(100, 0.5, 20, 11)).toBe(false);
        expect(labelFits(100, 1.5, 20, 11)).toBe(true);
        expect(labelFits(100, 1.4, 20, 11)).toBe(true);
    });

    it('shows more labels as the view zooms in (the font, in map units, shrinks)', () => {
        expect(labelFits(60, 0.2, 14, 11)).toBe(false);
        expect(labelFits(60, 0.2, 14, 11 / 8)).toBe(true);
    });

    it('is a pure function of the model: the same branches get the same verdicts', () => {
        const wide: KNode[] = Array.from({ length: 300 }, (_, i) => ({
            ref: `src:r::d${i}/x.ts` as KNode['ref'], kind: 'file', label: 'x', pack: 'code', importance: 0.5, origin: 'extracted',
        }));
        const verdicts = () => mindMap(wide, []).branches.map((b) => labelFits(b.radius, b.span, 8, 11));
        expect(verdicts()).toEqual(verdicts());
        // 300 folders on one ring: the arc each owns is far shorter than an 8-letter label.
        expect(verdicts().slice(1).some((v) => !v)).toBe(true);
    });
});

describe('direction-aware label budget', () => {
    const spot = { radius: 100, span: 0.05, room: Infinity, chars: 12, font: 10 };

    it('lets a side label through when the arc clears the text height, however long the text', () => {
        // arc = 5; the text is 72 wide but runs radially, so only its 12 units of height must clear the arc... which 5 does not.
        expect(labelFitsAt({ ...spot, angle: 0 })).toBe(false);
        expect(labelFitsAt({ ...spot, angle: 0, span: 0.2 })).toBe(true); // arc 20 >= 12
        expect(labelFitsAt({ ...spot, angle: Math.PI, span: 0.2 })).toBe(true); // the left side too
    });

    it('needs the radial room for a side label: a branch with children close by hides a long label', () => {
        expect(labelFitsAt({ ...spot, angle: 0, span: 0.2, room: 14 })).toBe(false); // 72 > 14
        expect(labelFitsAt({ ...spot, angle: 0, span: 0.2, room: 80 })).toBe(true);
    });

    it('needs the arc to hold the text width for a top or bottom label (it runs along the ring)', () => {
        expect(labelFitsAt({ ...spot, angle: Math.PI / 2, span: 0.2 })).toBe(false); // arc 20 < 72
        expect(labelFitsAt({ ...spot, angle: -Math.PI / 2, span: 1 })).toBe(true); // arc 100 >= 72
    });

    it('never labels a crowded ring at a size that overlaps its neighbours', () => {
        const wide: KNode[] = Array.from({ length: 300 }, (_, i) => ({
            ref: `src:r::d${String(i).padStart(3, '0')}/x.ts` as KNode['ref'], kind: 'file', label: 'x', pack: 'code', importance: 0.5, origin: 'extracted',
        }));
        const font = 8;
        for (const b of mindMap(wide, []).branches.filter((x) => x.depth === 1)) {
            const chars = 10;
            if (!labelFitsAt({ radius: b.radius, span: b.span, angle: b.angle, room: b.room, chars, font })) continue;
            // Whatever is labelled has room: a side label a full line of arc, a top or bottom one its whole width.
            const arc = arcLength(b.radius, b.span);
            expect(arc).toBeGreaterThanOrEqual(Math.abs(Math.cos(b.angle)) > 0.5 ? font * 1.2 : textWidth(chars, font));
        }
    });
});
