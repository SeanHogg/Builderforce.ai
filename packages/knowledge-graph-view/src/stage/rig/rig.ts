/**
 * The camera rig (PRD 43 B1/B2): the stage's ONE orthographic view — centre, zoom and depth — and how it moves.
 *
 * - A placement change re-fits the view to the new placement, TWEENED with the same clock and easing as the marks
 *   (`Tween`, ≤ 400 ms), so the camera never jumps while the marks glide; reduced motion jumps both.
 * - +, −, Fit, wheel and pinch zoom (about a point); a drag pans. Zoom is capped relative to the fitted view.
 * - Depth (0..1) is the depth control: it tilts the camera within the placement's `rig.depth.tilt` range and drives
 *   the marks' extrude (Map: the flat map rises into towers). Never a gesture (B2: tilt never collides with pinch).
 *
 * Framework-free and pure apart from its own state (the caller passes the time), so the R3F frame loop, the no-op
 * renderer path and the tests drive it the same way. `project` is the exact map the camera applies.
 */

import { Tween, TWEEN_MS } from '../tween';
import type { Projector, ScreenFrame } from '../pick';
import { groundScreenMatrix, projectGround, type GroundView } from '../projection';
import type { CameraRig } from '../types';

export interface RigView { cx: number; cz: number; zoom: number }
export interface RigPose { position: [number, number, number]; target: [number, number, number]; up: [number, number, number]; zoom: number }

export const MIN_ZOOM_FACTOR = 0.2;
export const MAX_ZOOM_FACTOR = 8;
/** The camera's distance from its target: far enough that a tilted, tall placement stays inside near/far. */
export const CAMERA_DISTANCE = 4000;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class RigController {
    private view: RigView = { cx: 0, cz: 0, zoom: 1 };
    private home: RigView = { cx: 0, cz: 0, zoom: 1 };
    private from: RigView = this.view;
    private readonly tween = new Tween();
    private depthNow = 0;
    private tiltRange: readonly [number, number] = [0, 0];
    private moved = false;
    private listeners = new Set<() => void>();
    width = 0;
    height = 0;

    /** Called on every change (a frame is needed). */
    subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    private changed(): void { for (const fn of this.listeners) fn(); }

    get current(): Readonly<RigView> { return this.view; }
    get depth(): number { return this.depthNow; }
    get tweening(): boolean { return this.tween.active; }
    get userMoved(): boolean { return this.moved; }
    /** The tilt in degrees at the current depth. */
    get tilt(): number { return lerp(this.tiltRange[0], this.tiltRange[1], this.depthNow); }

    /** A new placement's fitted view: tween to it (`ms` 0 jumps), forgetting the person's pan and zoom. */
    setHome(home: RigView, rig: Pick<CameraRig, 'depth'>, width: number, height: number, now: number, ms: number = TWEEN_MS): void {
        this.width = width; this.height = height;
        this.tiltRange = rig.depth.tilt;
        this.home = home;
        this.moved = false;
        this.go(home, now, ms);
    }

    /** A container resize under the same placement: re-fit only while the person has not moved the view. */
    resize(home: RigView, width: number, height: number): void {
        this.width = width; this.height = height;
        this.home = home;
        if (!this.moved) { this.tween.finish(); this.view = home; this.changed(); }
    }

    fit(now: number, ms: number = TWEEN_MS): void { this.moved = false; this.go(this.home, now, ms); }

    /** Zoom by `factor` about the screen point (`sx`, `sy`) (default: the centre), capped against the fitted zoom. */
    zoomBy(factor: number, sx = this.width / 2, sy = this.height / 2): void {
        this.tween.finish();
        const v = this.view, h = this.home;
        const zoom = Math.min(h.zoom * MAX_ZOOM_FACTOR, Math.max(h.zoom * MIN_ZOOM_FACTOR, v.zoom * factor));
        const cos = Math.cos((this.tilt * Math.PI) / 180) || 1;
        // Keep the ground point under (sx, sy) where it is.
        const wx = v.cx + (sx - this.width / 2) / v.zoom, wz = v.cz + (sy - this.height / 2) / (v.zoom * cos);
        this.view = { zoom, cx: wx - (sx - this.width / 2) / zoom, cz: wz - (sy - this.height / 2) / (zoom * cos) };
        this.moved = true;
        this.changed();
    }

    /** Pan by a screen delta in CSS px. */
    panBy(dx: number, dy: number): void {
        this.tween.finish();
        const cos = Math.cos((this.tilt * Math.PI) / 180) || 1;
        this.view = { ...this.view, cx: this.view.cx - dx / this.view.zoom, cz: this.view.cz - dy / (this.view.zoom * cos) };
        this.moved = true;
        this.changed();
    }

    /** Centres the view on ground point (x, z) at the current zoom (a focused off-screen proxy, B5). */
    centreOn(x: number, z: number): void {
        this.tween.finish();
        this.view = { ...this.view, cx: x, cz: z };
        this.moved = true;
        this.changed();
    }

    setDepth(depth: number): void {
        const d = Math.min(1, Math.max(0, depth));
        if (d === this.depthNow) return;
        this.depthNow = d;
        this.changed();
    }

    /** Advances the camera tween; true while another frame is needed. */
    tick(now: number): boolean {
        if (!this.tween.active) return false;
        const t = this.tween.at(now);
        const a = this.from, b = this.home;
        this.view = { cx: lerp(a.cx, b.cx, t), cz: lerp(a.cz, b.cz, t), zoom: a.zoom * Math.pow(b.zoom / a.zoom, t) };
        return this.tween.active;
    }

    /** The settled frame picking and the proxies use (top-down; tilt is applied by `project`). */
    frame(): ScreenFrame { return { zoom: this.view.zoom, cx: this.view.cx, cz: this.view.cz, width: this.width, height: this.height }; }

    /** The current view as the shared projection's input (`projection.ts`); ONE scratch object, rewritten per call. */
    groundView(): Readonly<GroundView> {
        const g = this.scratchView, v = this.view;
        g.cx = v.cx; g.cz = v.cz; g.zoom = v.zoom; g.tilt = this.tilt; g.width = this.width; g.height = this.height;
        return g;
    }

    /** World → CSS px in the stage box, into `out` (no allocation): exactly the camera {@link pose} sets up. */
    projectInto = (x: number, y: number, z: number, out: { 0: number; 1: number }): void => { projectGround(this.groundView(), x, y, z, out); };

    /** {@link projectInto} returning a fresh pair (tests, one-off reads; not for a frame loop). */
    project = (x: number, y: number, z: number): readonly [number, number] => {
        const out: [number, number] = [0, 0];
        this.projectInto(x, y, z, out);
        return out;
    };

    /** The rig's projection as the stage bus's {@link Projector} (the no-canvas path; the canvas taps the real camera). */
    projector(): Projector {
        const g: GroundView = { ...this.groundView() };
        return {
            width: g.width, height: g.height, pxPerWorld: g.zoom, key: `rig|${g.zoom}|${g.cx}|${g.cz}|${g.tilt}|${g.width}|${g.height}`,
            screen: groundScreenMatrix(g),
            project(x, y, z, out) { projectGround(g, x, y, z, out as unknown as { 0: number; 1: number }); return true; },
        };
    }

    /**
     * The camera pose for the current view: position, look-at target, up (screen up = world −z) and zoom. ONE scratch
     * object, rewritten per call (the frame loop reads it every frame).
     */
    pose(): Readonly<RigPose> {
        const a = (this.tilt * Math.PI) / 180, v = this.view, p = this.scratchPose;
        p.position[0] = v.cx; p.position[1] = CAMERA_DISTANCE * Math.cos(a); p.position[2] = v.cz + CAMERA_DISTANCE * Math.sin(a);
        p.target[0] = v.cx; p.target[1] = 0; p.target[2] = v.cz;
        p.zoom = v.zoom;
        return p;
    }

    private readonly scratchView: GroundView = { cx: 0, cz: 0, zoom: 1, tilt: 0, width: 0, height: 0 };
    private readonly scratchPose: RigPose = { position: [0, 0, 0], target: [0, 0, 0], up: [0, 0, -1], zoom: 1 };

    private go(to: RigView, now: number, ms: number): void {
        if (ms <= 0 || (this.view.zoom === to.zoom && this.view.cx === to.cx && this.view.cz === to.cz)) {
            this.tween.finish();
            this.view = to;
        } else {
            this.from = this.view;
            this.tween.begin(now, ms);
        }
        this.changed();
    }
}
