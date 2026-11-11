// @vitest-environment jsdom
/**
 * Regressions from the real-browser runs of the ONE stage (PRD 43): the sizing seam (layout, label size floor), the
 * redraw a late label typeset needs, and the stage's navigation (nav control, wheel intent, orbit slide).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { layoutOf, sceneMinHeight, SCENE_MIN_PX, SCENE_STACKED_VH } from '../layout';
import { placeLabels } from './labels/runs';
import type { TextPort } from './labels/LabelLayer';
import { createWebGLStage } from './renderer';
import { wheelIntent } from './rig/gestures';
import { NAV_PAN_PX, NavControl } from './rig/NavControl';
import { RigController } from './rig/rig';
import { panZoomOf } from './rig/useRig';
import type { LabelRun } from './types';

const GROUND = { home: { position: [0, 1000, 0] as const, target: [0, 0, 0] as const, up: [0, 0, -1] as const }, depth: { tilt: [0, 60] as [number, number], orbit: false } };
const ORBIT = {
    home: { position: [0, 500, 500] as const, target: [0, 100, 0] as const, up: [0, 1, 0] as const },
    depth: { tilt: [5, 89] as [number, number], orbit: true }, view: { yaw: 0, pitch: 30, distance: 1000, fov: 50 },
};

describe('stage sizing', () => {
    it('regression: a stacked scene reserves the overlay on top of its drawing minimum (the 3D strip at ~700px)', () => {
        expect(sceneMinHeight(layoutOf(1400))).toBe(0);
        const stacked = sceneMinHeight(layoutOf(704));
        expect(stacked).toBe(`calc(max(${SCENE_MIN_PX}px, ${SCENE_STACKED_VH}vh) + var(--kg-scene-top, 88px))`);
        // A phone stacks the overlay in flow above the region: nothing to reserve.
        expect(sceneMinHeight(layoutOf(400))).toBe(`max(${SCENE_MIN_PX}px, ${SCENE_STACKED_VH}vh)`);
    });

    it('regression: a world label never draws under its nominal CSS px when zoomed out (Map / Mind map names)', () => {
        const run: LabelRun = { slot: 0, text: 'Area 16', offsetPx: [0, 0], font: 'mono', size: 11, weight: 500, anchor: 'middle', tone: 3, halo: { tone: 0, px: 3 }, priority: 1, scale: 'world' };
        const p = { position: new Float32Array([0, 0, 0]), scale: new Float32Array([40]), extrude: new Float32Array([0]) };
        const [far] = placeLabels([run], p, { pxPerWorld: 0.25, depth: 0 }, true).sdf;
        expect(far!.fontSize * 0.25).toBeCloseTo(11); // 11 CSS px on screen, not 2.75
        expect(far!.outlineWidth * 0.25).toBeCloseTo(3);
        const [near] = placeLabels([run], p, { pxPerWorld: 2, depth: 0 }, true).sdf;
        expect(near!.fontSize).toBe(11); // zoomed in it grows with the map, as before
    });

    it('regression: a label typeset after the last frame asks the on-demand canvas for one more (names never showed)', () => {
        let synced: (() => void) | null = null;
        const port: TextPort = { object: null, create: () => { throw new Error('unused'); }, add() {}, remove() {}, dispose() {} };
        const stage = createWebGLStage({ text: (onSynced) => { synced = onSynced; return port; } });
        const redraw = vi.fn();
        const off = stage.onRedraw(redraw);
        synced!();
        expect(redraw).toHaveBeenCalledTimes(1);
        off();
        synced!();
        expect(redraw).toHaveBeenCalledTimes(1);
        stage.dispose();
    });
});

describe('stage navigation', () => {
    it('wheel: the page keeps a document frame\'s plain wheel; Shift or a trackpad pans a fill frame; a mouse wheel zooms', () => {
        const e = (over: Partial<WheelEvent>) => ({ ctrlKey: false, metaKey: false, shiftKey: false, deltaMode: 0, deltaX: 0, deltaY: 100, ...over });
        expect(wheelIntent(e({}), 'document')).toBe('page');
        expect(wheelIntent(e({ ctrlKey: true }), 'document')).toBe('zoom');
        expect(wheelIntent(e({}), 'fill')).toBe('zoom');
        expect(wheelIntent(e({ shiftKey: true }), 'fill')).toBe('pan');
        expect(wheelIntent(e({ deltaY: 3.5 }), 'fill')).toBe('pan');
        expect(wheelIntent(e({ deltaX: 4 }), 'fill')).toBe('pan');
    });

    it('slideBy moves the orbit target up and down the stack without rotating, and pans a ground view', () => {
        const rig = new RigController();
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, ORBIT, 800, 600, 0, 0);
        const before = { ...rig.currentOrbit };
        rig.slideBy(0, -NAV_PAN_PX); // "Move down"
        expect(rig.currentOrbit.ty).toBeLessThan(before.ty);
        expect([rig.currentOrbit.yaw, rig.currentOrbit.pitch, rig.currentOrbit.distance]).toEqual([before.yaw, before.pitch, before.distance]);
        const ground = new RigController();
        ground.setHome({ cx: 0, cz: 0, zoom: 2 }, GROUND, 800, 600, 0, 0);
        ground.slideBy(0, -NAV_PAN_PX);
        expect(ground.current.cz).toBeCloseTo(NAV_PAN_PX / 2);
    });

    it('NavControl: buttons drive the rig; the orbit group shows only while orbiting', () => {
        const rig = new RigController();
        rig.setHome({ cx: 0, cz: 0, zoom: 1 }, GROUND, 800, 600, 0, 0);
        const settle = vi.fn();
        const panZoom = panZoomOf(rig, true, settle);
        const labels = { nav: L.surface.nav, zoomIn: L.zoomIn, zoomOut: L.zoomOut, zoomReset: L.zoomReset };
        const { unmount } = render(<NavControl rig={rig} panZoom={panZoom} labels={labels} onSettle={settle} />);
        expect(document.querySelector('[data-stage-nav-orbit]')).toBeNull();
        // A keyboard click (detail 0) acts once.
        fireEvent.click(screen.getByRole('button', { name: L.surface.nav.panDown }), { detail: 0 });
        expect(rig.current.cz).toBeCloseTo(NAV_PAN_PX);
        fireEvent.click(screen.getByRole('button', { name: L.zoomIn }), { detail: 0 });
        expect(rig.current.zoom).toBeGreaterThan(1);
        fireEvent.click(screen.getByRole('button', { name: L.zoomReset }));
        expect(rig.current).toEqual({ cx: 0, cz: 0, zoom: 1 }); // reduced motion: Fit jumps home
        unmount();
        const orbit = new RigController();
        orbit.setHome({ cx: 0, cz: 0, zoom: 1 }, ORBIT, 800, 600, 0, 0);
        render(<NavControl rig={orbit} panZoom={panZoomOf(orbit, true, settle)} labels={labels} onSettle={settle} />);
        expect(document.querySelector('[data-stage-nav-orbit]')).not.toBeNull();
        const yaw = orbit.currentOrbit.yaw;
        fireEvent.click(screen.getByRole('button', { name: L.surface.nav.rotateRight }), { detail: 0 });
        expect(orbit.currentOrbit.yaw).not.toBe(yaw);
    });
});
