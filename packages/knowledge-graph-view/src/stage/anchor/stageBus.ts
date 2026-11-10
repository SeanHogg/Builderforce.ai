/**
 * The stage's main-thread interaction state, outside React (PRD 43 B5, B3 Cards): the current camera projection (pushed
 * by the frame loop every frame), the placement it projects, whether a tween is running, and the pick grid rebuilt when
 * the camera SETTLES. Hover, select, card anchors and the a11y proxies read it directly, so a pointer move or a camera
 * frame never waits on the worker and never commits React.
 *
 * Settling: a projection that has not changed for {@link SETTLE_MS}, a tween landing, or the rig saying so
 * ({@link StageBus.settle}). Picking is OFF during a tween (B1a rule 5): the grid would be where the marks were.
 *
 * One bus per renderer ({@link stageBus}), so the canvas side (the frame tap) and the DOM side (proxies, cards) meet
 * without threading a prop through the stage.
 */

import { createContext, useContext } from 'react';
import { PickIndex, type PickOptions, type Projector, type StageHit } from '../pick';
import type { SlotIncident } from '../overlay/incident';
import type { StageRenderer } from '../renderer';
import type { Placement } from '../types';

export const SETTLE_MS = 120;

type Fn<T extends unknown[] = []> = (...args: T) => void;

/** What the camera's owner adds to the stage's interaction (set with {@link StageBus.setOptions}; data and callbacks). */
export interface StageOptions {
    /** The ranked incident index (`stageIncident`): a selection draws its best neighbours. */
    incident?: SlotIncident | null;
    /** The highlighted path's stops, by key, in order (the path strip). */
    path?: readonly string[] | null;
    /** A line was picked (a route): its batch, segment, polyline and slot. */
    onLink?: ((hit: Extract<StageHit, { kind: 'link' }>, at: { x: number; y: number }) => void) | null;
}

/**
 * What the bus reads of the renderer: the depth (towers are measured at their drawn height), the MarkSet (its
 * `importance` is picking's tie-break, the same reading `nearestHit` uses) and the LIVE keys (the MarkSet's plus every
 * slot a drill appended).
 */
export type StageSource = Pick<StageRenderer, 'depth' | 'marks' | 'keys'>;

/** Where the bus moves keyboard focus once the next settle has rebuilt the proxies: a slot's key, or the first stop. */
export type FocusRequest = { key: string } | { first: true };

export class StageBus {
    options: StageOptions = {};
    private readonly optionFns = new Set<Fn>();
    projector: Projector | null = null;
    placement: Placement | null = null;
    tweening = false;
    /** The renderer, read at settle time (see {@link StageSource}). */
    source: StageSource | null = null;
    /** A focus move waiting for the proxies of the next settle (`StageProxies` performs it). */
    focusRequest: (FocusRequest & { from: Placement | null }) | null = null;
    private stored: readonly string[] = [];
    /** The slot under the pointer (-1 none). */
    hover = -1;
    /** True once a real camera pushed a projection: the fitted-frame fallback stops being used. */
    private camera = false;
    private index: PickIndex | null = null;
    /** The last dropped grid, whose buffers the next settle reuses. */
    private spare: PickIndex | null = null;
    private byKey: { of: readonly string[]; at: Map<string, number> } | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private lastKey = '';
    private readonly frameFns = new Set<Fn<[Projector]>>();
    private readonly settleFns = new Set<Fn>();
    private readonly revealFns = new Set<Fn<[number]>>();
    private readonly hoverFns = new Set<Fn<[number]>>();
    private readonly tweenFns = new Set<Fn<[boolean]>>();
    private readonly placementFns = new Set<Fn<[Placement]>>();

    /**
     * The depth control's extrude multiplier (the renderer's `depth`, the shader's `uDepth`): picking and the card anchors
     * measure a tower at the height it is drawn. The projection itself (tilt) comes from the camera / rig.
     */
    extrudeScale(): number { return this.source ? this.source.depth : 1; }

    /**
     * The LIVE key of every slot — the renderer's (`StageRenderer.keys()`: the MarkSet's plus every slot a drill
     * appended), so an appended symbol is selectable, focusable and anchorable; the stored MarkSet keys with no renderer.
     */
    get keys(): readonly string[] { return this.source ? this.source.keys() : this.stored; }

    /** The live keys changed (`StageRenderer.onKeys`: an append, a new MarkSet): the grid is rebuilt under them. */
    keysChanged(): void {
        // Scheduled, never immediate: keys change as a placement arrives, before its tween is flagged; settling now would
        // rebuild the proxies (and drop focus) over the level being left.
        this.dropIndex();
        this.schedule();
    }
    /** The a11y proxies' container (focus return reads it). */
    proxyRoot: HTMLElement | null = null;
    /** Asks the canvas for a frame (R3F's `invalidate`); a no-op without one. */
    invalidate: () => void = () => {};

    /** The current camera, once per rendered frame. `fromCamera` false = the fitted frame (no canvas: jsdom, no WebGL). */
    frame(projector: Projector, fromCamera = true): void {
        if (fromCamera) this.camera = true;
        else if (this.camera) return;
        this.projector = projector;
        for (const fn of this.frameFns) fn(projector);
        if (projector.key === this.lastKey) return;
        this.lastKey = projector.key;
        this.dropIndex();
        this.schedule();
    }

    /** The placement on show and the MarkSet's keys (the live keys add what the placement appends, {@link keys}). */
    setPlacement(p: Placement, keys: readonly string[]): void {
        if (p === this.placement && keys === this.stored) return;
        const moved = p !== this.placement;
        this.placement = p; this.stored = keys;
        if (moved) for (const fn of this.placementFns) fn(p);
        this.dropIndex();
        this.schedule();
    }

    setTweening(on: boolean): void {
        if (on === this.tweening) return;
        this.tweening = on;
        this.dropIndex();
        if (on) this.setHover(-1);
        for (const fn of this.tweenFns) fn(on);
        if (!on) this.settle();
    }

    /**
     * Moves keyboard focus once the proxies of ANOTHER placement exist (after Out: the station drilled out of; after Go
     * inside: the first stop) — never the stops of the placement on show when it is asked (the level being left), however
     * many times the camera settles (a wheel, a pan) while the drill's placement is still on its way from the worker.
     */
    requestFocus(request: FocusRequest): void { this.focusRequest = { ...request, from: this.placement }; }

    /** Rebuilds the pick grid from the current projection and tells the settle listeners (proxies, card visibility). */
    settle(): void {
        if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
        if (this.tweening || !this.projector || !this.placement) return;
        this.index = PickIndex.build(this.placement, this.projector, this.pickOptions(), this.index ?? this.spare);
        this.spare = null;
        for (const fn of this.settleFns) fn();
    }

    /** The settled grid; null while a tween runs or before the first settle. */
    get pickIndex(): PickIndex | null { return this.tweening ? null : this.index; }

    /** What is under (`sx`, `sy`); null during a tween. Never waits on the worker. */
    pick(sx: number, sy: number): StageHit | null {
        if (this.tweening) return null;
        if (!this.index && this.projector && this.placement) this.settle();
        return this.index?.pick(sx, sy) ?? null;
    }

    slotOf(key: string | null): number {
        if (!key) return -1;
        const keys = this.keys;
        if (this.byKey?.of !== keys) { const at = new Map<string, number>(); keys.forEach((k, i) => at.set(k, i)); this.byKey = { of: keys, at }; }
        return this.byKey.at.get(key) ?? -1;
    }

    setHover(slot: number): void {
        if (slot === this.hover) return;
        this.hover = slot;
        for (const fn of this.hoverFns) fn(slot);
    }

    /** Asks the rig to bring slot `s` into view (a focused off-screen proxy). */
    reveal(slot: number): void { for (const fn of this.revealFns) fn(slot); }

    setOptions(options: StageOptions): void {
        this.options = options;
        for (const fn of this.optionFns) fn();
    }

    onOptions(fn: Fn): () => void { this.optionFns.add(fn); return () => this.optionFns.delete(fn); }

    onFrame(fn: Fn<[Projector]>): () => void { this.frameFns.add(fn); return () => this.frameFns.delete(fn); }
    onSettle(fn: Fn): () => void { this.settleFns.add(fn); return () => this.settleFns.delete(fn); }
    onReveal(fn: Fn<[number]>): () => void { this.revealFns.add(fn); return () => this.revealFns.delete(fn); }
    onHover(fn: Fn<[number]>): () => void { this.hoverFns.add(fn); return () => this.hoverFns.delete(fn); }
    /** Another placement is on show (a camera switch, a band crossed, a drill, a new MarkSet): what was about the old one closes. */
    onPlacement(fn: Fn<[Placement]>): () => void { this.placementFns.add(fn); return () => this.placementFns.delete(fn); }
    /** A tween started (true) or landed (false): cards hide for its length (they would be over where the marks were). */
    onTween(fn: Fn<[boolean]>): () => void { this.tweenFns.add(fn); return () => this.tweenFns.delete(fn); }

    dispose(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.frameFns.clear(); this.settleFns.clear(); this.revealFns.clear(); this.hoverFns.clear(); this.optionFns.clear(); this.tweenFns.clear(); this.placementFns.clear();
    }

    /** The grid is stale (camera, placement or tween changed): kept as the next settle's buffers, never queried again. */
    private dropIndex(): void {
        if (this.index) this.spare = this.index;
        this.index = null;
    }

    private pickOptions(): PickOptions {
        const p = this.placement!;
        return { keys: this.keys, importance: this.source?.marks?.importance ?? null, links: p.links, extrudeScale: this.extrudeScale() };
    }

    private schedule(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.timer = null; this.settle(); }, SETTLE_MS);
    }
}

const BUSES = new WeakMap<object, StageBus>();

/** The bus of a stage, keyed by its renderer (one per `KnowledgeGraphView`'s stage). */
export function stageBus(owner: object): StageBus {
    let bus = BUSES.get(owner);
    if (!bus) { bus = new StageBus(); BUSES.set(owner, bus); }
    return bus;
}

export const StageBusContext = createContext<StageBus | null>(null);

export function useStageBus(): StageBus {
    const bus = useContext(StageBusContext);
    if (!bus) throw new Error('stage: useStageBus outside a StageBusContext');
    return bus;
}
