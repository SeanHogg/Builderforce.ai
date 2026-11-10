/**
 * The camera rig (PRD 43 B1/B2): the stage's ONE view and how it moves. Two kinds of view, chosen by the placement:
 *
 * - GROUND (Map, Graph, …): orthographic — centre, zoom and depth. +, −, Fit, wheel and pinch zoom about a point; a
 *   drag pans; depth (0..1, the depth control) tilts the camera within `rig.depth.tilt` and drives the marks' extrude.
 * - ORBIT (3D, a placement carrying `rig.view`): perspective free orbit — a drag (or the arrow keys on the focused
 *   canvas) rotates, pitch clamped to `rig.depth.tilt`; wheel / pinch / +, − dolly; Fit returns to the home pose. The
 *   marks' extrude is held at full (`depthUniform` 1).
 *
 * A placement change re-homes TWEENED with the same clock and easing as the marks (`Tween`, ≤ 400 ms), so the camera
 * never jumps while the marks glide; a tween between the kinds (Map ↔ 3D) runs in orbit space under a perspective
 * camera — the ground view's twin is the orbit at pitch 90° − tilt with the distance that shows the target at the same
 * zoom — and lands in the destination's projection. Reduced motion (0 ms) jumps.
 *
 * Framework-free and pure apart from its own state (the caller passes the time), so the R3F frame loop, the no-op
 * renderer path and the tests drive it the same way. `projectInto` is the exact map the camera applies.
 */

import { Tween, TWEEN_MS } from '../tween';
import type { Projector, ScreenFrame } from '../pick';
import {
    groundScreenMatrix, orbitBasis, orbitDistanceFor, orbitPxPerWorld, projectGround, projectOrbit, type GroundView, type OrbitPose,
} from '../projection';
import type { CameraRig } from '../types';

export interface RigView { cx: number; cz: number; zoom: number }
export interface RigPose {
    projection: 'orthographic' | 'perspective';
    position: [number, number, number]; target: [number, number, number]; up: [number, number, number];
    /** Orthographic zoom (1 for perspective). */
    zoom: number;
    /** Perspective vertical field of view, degrees. */
    fov: number;
}
/** An orbit view in world terms (no box size). */
export type OrbitState = Omit<OrbitPose, 'width' | 'height'>;

export const MIN_ZOOM_FACTOR = 0.2;
export const MAX_ZOOM_FACTOR = 8;
/** The ortho camera's distance from its target: far enough that a tilted, tall placement stays inside near/far. */
export const CAMERA_DISTANCE = 4000;
/** The fov a cross-projection tween uses when neither end names one. */
export const DEFAULT_FOV = 35;
/** Degrees of orbit per CSS px of drag, and per arrow-key press. */
export const ORBIT_DEG_PER_PX = 0.3;
export const ORBIT_KEY_DEG = 5;
/** Dolly limits relative to the home distance. */
const DOLLY_MIN = 0.1, DOLLY_MAX = 6;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Shortest-way yaw interpolation (degrees). */
const lerpAngle = (a: number, b: number, t: number): number => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class RigController {
    private view: RigView = { cx: 0, cz: 0, zoom: 1 };
    private home: RigView = { cx: 0, cz: 0, zoom: 1 };
    private from: RigView = this.view;
    private readonly tween = new Tween();
    private depthNow = 0;
    private tiltRange: readonly [number, number] = [0, 0];
    private moved = false;
    private listeners = new Set<() => void>();
    /** Which kind of view is current (or being tweened TO). */
    private kind: 'ground' | 'orbit' = 'ground';
    private orbit: OrbitState = { tx: 0, ty: 0, tz: 0, yaw: 0, pitch: 45, distance: 1000, fov: DEFAULT_FOV };
    private orbitHome: OrbitState = this.orbit;
    /** A tween in orbit space (orbit → orbit, or across the kinds): from, to. */
    private blend: { from: OrbitState; to: OrbitState } | null = null;
    width = 0;
    height = 0;

    /** Called on every change (a frame is needed). */
    subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    private changed(): void { for (const fn of this.listeners) fn(); }

    get current(): Readonly<RigView> { return this.view; }
    get currentOrbit(): Readonly<OrbitState> { return this.orbit; }
    get depth(): number { return this.depthNow; }
    get tweening(): boolean { return this.tween.active; }
    get userMoved(): boolean { return this.moved; }
    /** True for an orbit placement: drags rotate, the wheel dollies. */
    get orbiting(): boolean { return this.kind === 'orbit'; }
    /** The projection to draw with NOW: perspective for orbit and for any orbit-space tween. */
    get projection(): RigPose['projection'] { return this.kind === 'orbit' || this.blend ? 'perspective' : 'orthographic'; }
    /** The marks' extrude multiplier: the depth control on the ground, full in orbit (the 3D scene stands up). */
    get depthUniform(): number {
        const target = this.kind === 'orbit' ? 1 : this.depthNow;
        // Across a re-home (Map ↔ 3D) the extrude follows the camera tween instead of snapping.
        return this.tween.active && this.depthT < 1 ? lerp(this.depthFrom, target, this.depthT) : target;
    }
    /** The extrude multiplier a re-home tween starts from, and the tween's eased progress. */
    private depthFrom = 0;
    private depthT = 1;
    /** The tilt in degrees at the current depth (ground view). */
    get tilt(): number { return this.kind === 'orbit' ? 0 : lerp(this.tiltRange[0], this.tiltRange[1], this.depthNow); }
    /** CSS px per world unit at the view's centre. */
    get pxPerWorld(): number { return this.projection === 'perspective' ? orbitPxPerWorld(this.orbitPose()) : this.view.zoom; }

    /**
     * A new placement's home: tween to it (`ms` 0 jumps), forgetting the person's pan, zoom and orbit. `rig.view`
     * present ⇒ an orbit home looking at `rig.home.target`.
     */
    setHome(home: RigView, rig: Pick<CameraRig, 'depth' | 'home' | 'view'>, width: number, height: number, now: number, ms: number = TWEEN_MS): void {
        this.width = width; this.height = height;
        this.moved = false;
        this.depthFrom = this.depthUniform;
        this.depthT = ms > 0 ? 0 : 1;
        const wasOrbit = this.kind === 'orbit';
        const fromOrbit = this.liveOrbit(rig.view?.fov);
        this.tiltRange = rig.depth.tilt;
        this.home = home;
        if (rig.view) {
            const t = rig.home.target;
            this.orbitHome = { tx: t[0], ty: t[1], tz: t[2], yaw: rig.view.yaw, pitch: clamp(rig.view.pitch, ...this.tiltRange), distance: rig.view.distance, fov: rig.view.fov };
            this.kind = 'orbit';
            this.goOrbit(fromOrbit, this.orbitHome, now, ms);
            return;
        }
        this.kind = 'ground';
        if (wasOrbit && ms > 0) {
            // Orbit → ground: tween in orbit space to the ground home's perspective twin, then land orthographic.
            this.view = home;
            this.goOrbit(fromOrbit, this.groundTwin(home, fromOrbit.fov), now, ms);
            return;
        }
        this.blend = null;
        this.go(home, now, ms);
    }

    /** A container resize under the same placement: re-fit only while the person has not moved the view. */
    resize(home: RigView, width: number, height: number): void {
        this.width = width; this.height = height;
        this.home = home;
        if (!this.moved && this.kind === 'ground') { this.tween.finish(); this.blend = null; this.view = home; }
        this.changed();
    }

    fit(now: number, ms: number = TWEEN_MS): void {
        this.moved = false;
        if (this.kind === 'orbit') { this.goOrbit(this.orbit, this.orbitHome, now, ms); return; }
        this.go(this.home, now, ms);
    }

    /** Zoom by `factor` about the screen point (`sx`, `sy`) (default: the centre); in orbit, a dolly toward the target. */
    zoomBy(factor: number, sx = this.width / 2, sy = this.height / 2): void {
        this.stop();
        if (this.kind === 'orbit') {
            const h = this.orbitHome.distance;
            this.orbit = { ...this.orbit, distance: clamp(this.orbit.distance / factor, h * DOLLY_MIN, h * DOLLY_MAX) };
            this.moved = true;
            this.changed();
            return;
        }
        const v = this.view, h = this.home;
        const zoom = Math.min(h.zoom * MAX_ZOOM_FACTOR, Math.max(h.zoom * MIN_ZOOM_FACTOR, v.zoom * factor));
        const cos = Math.cos((this.tilt * Math.PI) / 180) || 1;
        // Keep the ground point under (sx, sy) where it is.
        const wx = v.cx + (sx - this.width / 2) / v.zoom, wz = v.cz + (sy - this.height / 2) / (v.zoom * cos);
        this.view = { zoom, cx: wx - (sx - this.width / 2) / zoom, cz: wz - (sy - this.height / 2) / (zoom * cos) };
        this.moved = true;
        this.changed();
    }

    /** Pan by a screen delta in CSS px (ground view). */
    panBy(dx: number, dy: number): void {
        if (this.kind === 'orbit') { this.orbitBy(dx, dy); return; }
        this.stop();
        const cos = Math.cos((this.tilt * Math.PI) / 180) || 1;
        this.view = { ...this.view, cx: this.view.cx - dx / this.view.zoom, cz: this.view.cz - dy / (this.view.zoom * cos) };
        this.moved = true;
        this.changed();
    }

    /** Orbit by a screen delta in CSS px: yaw with x, pitch with y, pitch clamped to the placement's tilt range. */
    orbitBy(dx: number, dy: number): void {
        if (this.kind !== 'orbit') return;
        this.stop();
        const [lo, hi] = this.tiltRange;
        this.orbit = { ...this.orbit, yaw: this.orbit.yaw - dx * ORBIT_DEG_PER_PX, pitch: clamp(this.orbit.pitch + dy * ORBIT_DEG_PER_PX, lo, hi) };
        this.moved = true;
        this.changed();
    }

    /** Centres the view on ground point (x, z) at the current zoom / distance (a focused off-screen proxy, B5). */
    centreOn(x: number, z: number): void {
        this.stop();
        if (this.kind === 'orbit') this.orbit = { ...this.orbit, tx: x, tz: z };
        else this.view = { ...this.view, cx: x, cz: z };
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
        this.depthT = t;
        if (this.blend) {
            const { from: a, to: b } = this.blend;
            this.orbit = {
                tx: lerp(a.tx, b.tx, t), ty: lerp(a.ty, b.ty, t), tz: lerp(a.tz, b.tz, t), yaw: lerpAngle(a.yaw, b.yaw, t),
                pitch: lerp(a.pitch, b.pitch, t), distance: a.distance * Math.pow(b.distance / a.distance, t), fov: lerp(a.fov, b.fov, t),
            };
            if (!this.tween.active) this.blend = null; // landed: a ground destination is orthographic again
            return this.tween.active;
        }
        const a = this.from, b = this.home;
        this.view = { cx: lerp(a.cx, b.cx, t), cz: lerp(a.cz, b.cz, t), zoom: a.zoom * Math.pow(b.zoom / a.zoom, t) };
        return this.tween.active;
    }

    /** The settled frame picking and the proxies use (top-down; tilt is applied by `project`). */
    frame(): ScreenFrame { return { zoom: this.view.zoom, cx: this.view.cx, cz: this.view.cz, width: this.width, height: this.height }; }

    /** The current ground view as the shared projection's input (`projection.ts`); ONE scratch object, rewritten per call. */
    groundView(): Readonly<GroundView> {
        const g = this.scratchView, v = this.view;
        g.cx = v.cx; g.cz = v.cz; g.zoom = v.zoom; g.tilt = this.tilt; g.width = this.width; g.height = this.height;
        return g;
    }

    /** The current orbit view with the box size; ONE scratch object. */
    orbitPose(): Readonly<OrbitPose> { return Object.assign(this.scratchOrbit, this.orbit, { width: this.width, height: this.height }); }

    /** World → CSS px in the stage box, into `out` (no allocation): exactly the camera {@link pose} sets up. */
    projectInto = (x: number, y: number, z: number, out: { 0: number; 1: number }): void => {
        if (this.projection === 'perspective') { if (!projectOrbit(this.orbitPose(), x, y, z, out)) { out[0] = NaN; out[1] = NaN; } return; }
        projectGround(this.groundView(), x, y, z, out);
    };

    /** {@link projectInto} returning a fresh pair (tests, one-off reads; not for a frame loop). */
    project = (x: number, y: number, z: number): readonly [number, number] => {
        const out: [number, number] = [0, 0];
        this.projectInto(x, y, z, out);
        return out;
    };

    /** The rig's projection as the stage bus's {@link Projector} (the no-canvas path; the canvas taps the real camera). */
    projector(): Projector {
        if (this.projection === 'perspective') {
            const o: OrbitPose = { ...this.orbitPose() };
            return {
                width: o.width, height: o.height, pxPerWorld: orbitPxPerWorld(o),
                key: `orbit|${o.tx}|${o.ty}|${o.tz}|${o.yaw}|${o.pitch}|${o.distance}|${o.fov}|${o.width}|${o.height}`,
                project(x, y, z, out) { return projectOrbit(o, x, y, z, out as unknown as { 0: number; 1: number }); },
            };
        }
        const g: GroundView = { ...this.groundView() };
        return {
            width: g.width, height: g.height, pxPerWorld: g.zoom, key: `rig|${g.zoom}|${g.cx}|${g.cz}|${g.tilt}|${g.width}|${g.height}`,
            screen: groundScreenMatrix(g),
            project(x, y, z, out) { projectGround(g, x, y, z, out as unknown as { 0: number; 1: number }); return true; },
        };
    }

    /**
     * The camera pose for the current view: projection, position, look-at target, up, zoom and fov. ONE scratch object,
     * rewritten per call (the frame loop reads it every frame).
     */
    pose(): Readonly<RigPose> {
        const p = this.scratchPose;
        if (this.projection === 'perspective') {
            const o = this.orbitPose();
            orbitBasis(o, p.position, p.up, this.scratchFwd);
            p.target[0] = o.tx; p.target[1] = o.ty; p.target[2] = o.tz;
            p.projection = 'perspective'; p.zoom = 1; p.fov = o.fov;
            return p;
        }
        const a = (this.tilt * Math.PI) / 180, v = this.view;
        p.projection = 'orthographic';
        p.position[0] = v.cx; p.position[1] = CAMERA_DISTANCE * Math.cos(a); p.position[2] = v.cz + CAMERA_DISTANCE * Math.sin(a);
        p.target[0] = v.cx; p.target[1] = 0; p.target[2] = v.cz;
        p.up[0] = 0; p.up[1] = 0; p.up[2] = -1;
        p.zoom = v.zoom;
        return p;
    }

    private readonly scratchView: GroundView = { cx: 0, cz: 0, zoom: 1, tilt: 0, width: 0, height: 0 };
    private readonly scratchOrbit: OrbitPose = { tx: 0, ty: 0, tz: 0, yaw: 0, pitch: 0, distance: 1, fov: DEFAULT_FOV, width: 0, height: 0 };
    private readonly scratchPose: RigPose = { projection: 'orthographic', position: [0, 0, 0], target: [0, 0, 0], up: [0, 0, -1], zoom: 1, fov: DEFAULT_FOV };
    private readonly scratchFwd = [0, 0, 0];

    /** A ground view's perspective twin: the same target and on-screen scale, looking down at 90° − tilt. */
    private groundTwin(v: RigView, fov = DEFAULT_FOV): OrbitState {
        return { tx: v.cx, ty: 0, tz: v.cz, yaw: 0, pitch: 90 - this.tilt, distance: orbitDistanceFor(v.zoom, fov, Math.max(1, this.height)), fov };
    }

    /** Where the camera is now, as an orbit state (a ground view becomes its twin). */
    private liveOrbit(fov?: number): OrbitState {
        return this.projection === 'perspective' ? { ...this.orbit } : this.groundTwin(this.view, fov ?? this.orbit.fov);
    }

    private stop(): void {
        if (!this.tween.active) return;
        this.tween.finish();
        if (this.blend) { this.orbit = this.blend.to; this.blend = null; } else this.view = this.home;
    }

    private goOrbit(from: OrbitState, to: OrbitState, now: number, ms: number): void {
        if (ms <= 0) { this.tween.finish(); this.blend = null; this.orbit = to; }
        else { this.orbit = from; this.blend = { from, to }; this.tween.begin(now, ms); }
        this.changed();
    }

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
