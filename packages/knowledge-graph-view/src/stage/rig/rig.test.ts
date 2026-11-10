import { describe, expect, it } from 'vitest';
import { TWEEN_MS } from '../tween';
import { MAX_ZOOM_FACTOR, RigController } from './rig';

const RIG = { depth: { tilt: [0, 60] as [number, number], orbit: false } };

describe('the camera rig (PRD 43 B2)', () => {
    it('tweens the camera to a new placement\'s fit alongside the marks — progress runs 0 → 1, no jump', () => {
        const rig = new RigController();
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, RIG, 800, 600, 0, 0);
        expect(rig.current).toEqual({ cx: 0, cz: 0, zoom: 1 });
        rig.setHome({ cx: 100, cz: 50, zoom: 4 }, RIG, 800, 600, 1000);
        expect(rig.tweening).toBe(true);
        rig.tick(1000);
        expect(rig.current.cx).toBe(0); // starts where it was
        expect(rig.tick(1000 + TWEEN_MS / 2)).toBe(true);
        expect(rig.current.cx).toBeGreaterThan(0);
        expect(rig.current.cx).toBeLessThan(100);
        expect(rig.current.zoom).toBeGreaterThan(1);
        expect(rig.current.zoom).toBeLessThan(4);
        expect(rig.tick(1000 + TWEEN_MS)).toBe(false);
        expect(rig.current).toEqual({ cx: 100, cz: 50, zoom: 4 });
    });

    it('reduced motion (0 ms) jumps', () => {
        const rig = new RigController();
        rig.setHome({ cx: 10, cz: 10, zoom: 2 }, RIG, 800, 600, 0, 0);
        rig.setHome({ cx: 30, cz: 30, zoom: 2 }, RIG, 800, 600, 5, 0);
        expect(rig.tweening).toBe(false);
        expect(rig.current.cx).toBe(30);
    });

    it('zooms about a point (the ground point under it stays put), capped against the fit; Fit returns home', () => {
        const rig = new RigController();
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, RIG, 800, 600, 0, 0);
        const at = [600, 450] as const;
        const before = rig.project(200, 0, 150);
        expect(before).toEqual(at);
        rig.zoomBy(2, at[0], at[1]);
        const after = rig.project(200, 0, 150);
        expect(after[0]).toBeCloseTo(at[0]);
        expect(after[1]).toBeCloseTo(at[1]);
        for (let i = 0; i < 20; i++) rig.zoomBy(2);
        expect(rig.current.zoom).toBe(MAX_ZOOM_FACTOR);
        expect(rig.userMoved).toBe(true);
        rig.fit(0, 0);
        expect(rig.current).toEqual({ cx: 0, cz: 0, zoom: 1 });
    });

    it('a resize re-fits only while the person has not moved the view', () => {
        const rig = new RigController();
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, RIG, 800, 600, 0, 0);
        rig.resize({ cx: 5, cz: 5, zoom: 1.5 }, 900, 600);
        expect(rig.current.zoom).toBe(1.5);
        rig.panBy(10, 0);
        rig.resize({ cx: 0, cz: 0, zoom: 3 }, 1000, 600);
        expect(rig.current.zoom).toBe(1.5);
    });

    it('depth tilts within the placement\'s range, and the projector matches the camera pose (ground compressed by cos tilt)', () => {
        const rig = new RigController();
        rig.setHome({ cx: 0, cz: 0, zoom: 2 }, RIG, 800, 600, 0, 0);
        rig.setDepth(1);
        expect(rig.tilt).toBe(60);
        const [, y] = rig.project(0, 0, 100);
        expect(y).toBeCloseTo(300 + 100 * Math.cos(Math.PI / 3) * 2);
        const out = new Float64Array(2);
        rig.projector().project(0, 0, 100, out);
        expect(out[1]).toBeCloseTo(y);
        const pose = rig.pose();
        expect(pose.position[2]).toBeGreaterThan(0); // the camera leans back toward +z to look across the map
        rig.setDepth(5);
        expect(rig.depth).toBe(1);
    });
});
