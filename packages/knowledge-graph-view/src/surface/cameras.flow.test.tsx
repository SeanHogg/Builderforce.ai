import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../testing';
import { PLACEMENTS } from '../compute/tasks/placement';
import { CAMERAS } from './cameras';
import { cameraGlyph } from './ui/glyphs';

const env = { webgl: false, reducedMotion: true, hasLines: true, compact: false };

describe('the camera registry: Flow and Sequence (PRD 43 C7)', () => {
    const ids = CAMERAS.filter((c) => c.switcher !== false).map((c) => c.id);

    it('Flow and Sequence are both in the view switcher, after the architecture cameras and before the List', () => {
        expect(ids).toContain('flow');
        expect(ids).toContain('sequence');
        expect(ids.indexOf('flow')).toBeLessThan(ids.indexOf('sequence'));
        expect(ids.indexOf('sequence')).toBeLessThan(ids.indexOf('list'));
    });

    it('each is a stage placement that exists in the registry, drawn where the lines are, with a glyph', () => {
        for (const id of ['flow', 'sequence'] as const) {
            const cam = CAMERAS.find((c) => c.id === id)!;
            expect(cam.placement).toBe(id);
            expect(PLACEMENTS[id]).toBeTypeOf('function');
            expect(cam.available(surfaceFixture(), env)).toBe(true);
            expect(cam.available(surfaceFixture(), { ...env, hasLines: false })).toBe(false);
            expect(cameraGlyph(id)).toBeTruthy();
        }
    });
});
