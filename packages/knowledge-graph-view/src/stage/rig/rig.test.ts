import { describe, expect, it } from 'vitest';
import { TWEEN_MS } from '../tween';
import { MAX_ZOOM_FACTOR, RigController } from './rig';

const RIG = {
    home: { position: [0, 1000, 0] as const, target: [0, 0, 0] as const, up: [0, 0, -1] as const },
    depth: { tilt: [0, 60] as [number, number], orbit: false },
};

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

const ORBIT_RIG = {
    home: { position: [0, 0, 0] as const, target: [100, 20, 50] as const, up: [0, 1, 0] as const },
    depth: { tilt: [5, 89] as [number, number], orbit: true },
    view: { yaw: 45, pitch: 26, distance: 900, fov: 40 },
};

describe('the orbit rig (3D, a placement carrying rig.view)', () => {
    it('homes on the view, drags orbit with pitch clamped to the tilt range, the wheel dollies, extrude is held at 1', () => {
        const rig = new RigController();
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, ORBIT_RIG, 800, 600, 0, 0);
        expect(rig.orbiting).toBe(true);
        expect(rig.projection).toBe('perspective');
        expect(rig.currentOrbit).toMatchObject({ tx: 100, ty: 20, tz: 50, yaw: 45, pitch: 26, distance: 900, fov: 40 });
        rig.setDepth(0);
        expect(rig.depthUniform).toBe(1);
        rig.orbitBy(0, 10_000);
        expect(rig.currentOrbit.pitch).toBe(89);
        rig.orbitBy(0, -10_000);
        expect(rig.currentOrbit.pitch).toBe(5);
        rig.orbitBy(100, 0);
        expect(rig.currentOrbit.yaw).toBeCloseTo(45 - 30);
        rig.zoomBy(2);
        expect(rig.currentOrbit.distance).toBeCloseTo(450);
        // The pose looks at the target from `distance` away.
        const p = rig.pose();
        expect(p.projection).toBe('perspective');
        expect(Math.hypot(p.position[0] - 100, p.position[1] - 20, p.position[2] - 50)).toBeCloseTo(450);
        // The target projects to the box centre.
        const [x, y] = rig.project(100, 20, 50);
        expect(x).toBeCloseTo(400); expect(y).toBeCloseTo(300);
        rig.fit(0, 0);
        expect(rig.currentOrbit.distance).toBe(900);
    });

    it('Map ↔ 3D blends the camera: perspective mid-tween, landing in the destination projection', () => {
        const rig = new RigController();
        rig.setHome({ cx: 100, cz: 50, zoom: 2 }, RIG, 800, 600, 0, 0);
        expect(rig.projection).toBe('orthographic');
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, ORBIT_RIG, 800, 600, 1000);
        expect(rig.tweening).toBe(true);
        rig.tick(1000);
        // Starts from the map's perspective twin: straight down, same target, same on-screen scale.
        expect(rig.currentOrbit.pitch).toBeCloseTo(90);
        expect(rig.pxPerWorld).toBeCloseTo(2);
        rig.tick(1000 + TWEEN_MS / 2);
        expect(rig.projection).toBe('perspective');
        expect(rig.currentOrbit.pitch).toBeLessThan(90);
        expect(rig.currentOrbit.pitch).toBeGreaterThan(26);
        expect(rig.tick(1000 + TWEEN_MS)).toBe(false);
        expect(rig.currentOrbit.pitch).toBeCloseTo(26);
        // And back: perspective while it blends, orthographic once it lands.
        rig.setHome({ cx: 100, cz: 50, zoom: 2 }, RIG, 800, 600, 2000);
        rig.tick(2000 + TWEEN_MS / 2);
        expect(rig.projection).toBe('perspective');
        expect(rig.orbiting).toBe(false);
        rig.tick(2000 + TWEEN_MS);
        expect(rig.projection).toBe('orthographic');
        expect(rig.current).toEqual({ cx: 100, cz: 50, zoom: 2 });
    });

    it('the extrude follows the Map ↔ 3D tween instead of snapping', () => {
        const rig = new RigController();
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, RIG, 800, 600, 0, 0);
        rig.setDepth(0.2);
        expect(rig.depthUniform).toBe(0.2);
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, ORBIT_RIG, 800, 600, 1000);
        expect(rig.depthUniform).toBeCloseTo(0.2); // starts where the map was
        rig.tick(1000 + TWEEN_MS / 2);
        expect(rig.depthUniform).toBeGreaterThan(0.2);
        expect(rig.depthUniform).toBeLessThan(1);
        rig.tick(1000 + TWEEN_MS);
        expect(rig.depthUniform).toBe(1);
        // And back down to the depth control's value.
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, RIG, 800, 600, 2000);
        expect(rig.depthUniform).toBe(1);
        rig.tick(2000 + TWEEN_MS / 2);
        expect(rig.depthUniform).toBeLessThan(1);
        expect(rig.depthUniform).toBeGreaterThan(0.2);
        rig.tick(2000 + TWEEN_MS);
        expect(rig.depthUniform).toBe(0.2);
    });

    it('a resize while 3D is active leaves no stale ortho frustum: back on Map the camera projects as the rig does', async () => {
        const { OrthographicCamera, PerspectiveCamera, Vector3 } = await import('three');
        const { aimCamera } = await import('./aim');
        const ortho = new OrthographicCamera(-400, 400, 300, -300, 1, 1000), persp = new PerspectiveCamera(35, 800 / 600, 1, 1e6);
        const rig = new RigController();
        rig.setHome({ cx: 100, cz: 50, zoom: 2 }, RIG, 800, 600, 0, 0);
        aimCamera(rig.pose(), rig.currentOrbit.distance, ortho, persp, { width: 800, height: 600 });
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, ORBIT_RIG, 800, 600, 0, 0);
        // Resized while the PERSPECTIVE camera is the active one.
        rig.resize({ cx: 0, cz: 0, zoom: 1 }, 1200, 500);
        aimCamera(rig.pose(), rig.currentOrbit.distance, ortho, persp, { width: 1200, height: 500 });
        rig.setHome({ cx: 100, cz: 50, zoom: 2 }, RIG, 1200, 500, 0, 0);
        const cam = aimCamera(rig.pose(), rig.currentOrbit.distance, ortho, persp, { width: 1200, height: 500 });
        expect(cam).toBe(ortho);
        for (const [x, y, z] of [[100, 0, 50], [300, 0, 120], [-40, 10, 7]] as const) {
            const v = new Vector3(x, y, z).project(cam);
            const sx = (v.x + 1) * 600, sy = (1 - v.y) * 250;
            const [rx, ry] = rig.project(x, y, z);
            expect(sx).toBeCloseTo(rx, 3);
            expect(sy).toBeCloseTo(ry, 3);
        }
    });

    it('reduced motion (0 ms) jumps between the projections', () => {
        const rig = new RigController();
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, RIG, 800, 600, 0, 0);
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, ORBIT_RIG, 800, 600, 10, 0);
        expect(rig.tweening).toBe(false);
        expect(rig.currentOrbit.pitch).toBe(26);
        rig.setHome({ cx: 5, cz: 5, zoom: 1 }, RIG, 800, 600, 20, 0);
        expect(rig.tweening).toBe(false);
        expect(rig.projection).toBe('orthographic');
    });

    it('arrow keys orbit only while the canvas itself has focus', async () => {
        const { bindOrbitKeys } = await import('./gestures');
        const rig = new RigController();
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, ORBIT_RIG, 800, 600, 0, 0);
        const canvas = document.createElement('canvas'), proxy = document.createElement('button');
        canvas.appendChild(proxy);
        const unbind = bindOrbitKeys(canvas, rig, () => {});
        proxy.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(rig.currentOrbit.yaw).toBe(45);
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(rig.currentOrbit.yaw).toBeGreaterThan(45);
        unbind();
    });
});
