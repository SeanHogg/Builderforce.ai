/**
 * Semantic zoom on the stage (PRD 43 B1a rules 9–10): zooming in like a map goes system → classes → methods → code, as
 * continuous member tweens on the ONE stage. Read from the camera every frame (the bus), against the ONE band table
 * (`ZOOM_BANDS`, `labels/lod.ts`, with its hysteresis):
 *
 *   - Map: the mark under the zoom point (the rig's last zoom point, else the centre) growing past the next band's
 *     threshold goes into it through the surface's ONE drill (`useDrill`: system → `package`, class → `class`; entering
 *     a package loads its symbols ONCE per station). The level is nested into that mark ({@link nest}, `nest.ts`), so
 *     its members tween out of it while the zoom carries on; the parent shrinking below its band's `exitPx` goes back
 *     out (they fold in). At the method band a method past the code threshold opens the code layer on its slot.
 *   - Sequence: a participant's size moves the Sequence's band the same way; `sequenceLod` is its `req.lod`.
 *
 * "Go inside" is a shortcut to the same zoom ({@link SemanticZoom.zoomInto}: the rig flies to the station at the next
 * band's threshold; the crossing does the rest). With no rig (no stage yet) it drills directly, as before.
 */

import { drillKeyOf } from '../../compute/tasks/placement/request';
import { entryFileOf } from '../../surface/stations';
import { folderOfKey, structuralDepth } from '../../surface/transit/levelFrames';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DrillModel } from '../../surface/transit/useDrill';
import type { StageBus } from '../anchor/stageBus';
import { ZOOM_BANDS, type ZoomBand } from '../labels/lod';
import { rigOf } from '../rig/rigOfBus';
import { bandOf, drawnPx, focusOf, sequenceLodOf, stepBand, zoomForBand } from '../rig/zoomBand';
import { now, TWEEN_MS } from '../tween';
import type { Placement } from '../types';
import { codeTargetOf, type CodeTarget } from './codeText';
import { RUNG_METHOD, RUNG_OF_BAND, rungOf, stackLengthForRung } from './levelRung';
import { drillOfPlacement, nestEntryOf, type NestBasis, type NestEntry } from './nest';
import { useNestEntries } from './useNestEntries';
import type { StageMap } from './useStageMap';

export interface SemanticZoom {
    /** The Map's band on show. */
    band: ZoomBand;
    /** The Sequence's `req.lod`, from its own zoom (rule 10). */
    sequenceLod: number;
    /** The Map placement nested into the mark the zoom entered (the same placement when the zoom did not enter it). */
    nest(p: Placement): Placement;
    /** The generation-matched placements a rebuilt world re-derives the nesting from (`useNestEntries`). */
    setBasis(b: NestBasis | null): void;
    /** An entry of the drill is stale for `p`'s generation and its basis has not landed (nesting now would draw the level un-nested). */
    awaitsBasis(p: Placement): boolean;
    /** The zoom entered a level of the current drill (a rebuilt world has nesting to keep). */
    nests: boolean;
    /** "Go inside": fly to the station at the next band's threshold (the zoom crossing enters it). */
    zoomInto(stationId: string): void;
    /** The Map's ladder: go back out to band `target` (0 system … CODE-1 method). Bands at or past the current one stay. */
    outToBand(target: number): void;
    /** One band in, from the mark `prefer` when it can be entered, else the one nearest the zoom point; false when nothing can be. */
    stepIn(prefer: string | null): boolean;
    /** The Map's ladder: go to band `target` (0 system … CODE). Out is `outToBand`; in steps band by band from `prefer`,
     *  and `onBlocked` runs when a step has nothing to enter. */
    toBand(target: number, prefer: string | null, onBlocked: () => void): void;
    /** The level rail's rung (0 System … 4 Line) the drill stands on (`levelRung.ts`). */
    rung: number;
    /** The level rail's click: go out to rung `rung`, or in toward it step by step (`onBlocked` runs when a step has nothing to enter). */
    toRung(rung: number, prefer: string | null, onBlocked: () => void): void;
    /** One step out: leave the code, else the band, else the system or app the drill is inside. */
    outOne(): void;
    /** The Sequence's band control: set the band (the zoom's own `sequenceLod`), then fly to its threshold (0 = Fit). */
    zoomToBand(band: number): void;
    /** The Sequence draws a method's calls (the code band's method, or one opened across): it has no bands, so the zoom steps nothing. */
    setMethodOpen(open: boolean): void;
    /** The code band's method, when it is open. */
    code: { key: string; target: CodeTarget } | null;
    /** Leave the code band: back one method on the trail, else fly back out to the method band. */
    closeCode(): void;
    /** Leave the code band from anywhere on the trail: fly back out to the method band. */
    leaveCode(): void;
    /** Open the code band on method `ref` (from the method or code band, a loaded record with a slot); false when it cannot.
     *  From the code band it goes onto the trail (cut back to it when it is already there). */
    enterCode(ref: string): boolean;
    /** The methods drilled into at the code band, outermost first; the last is `code`. */
    trail: readonly { ref: string; name: string }[];
    /** Go back to the trail's `index`th method. */
    codeBack(index: number): void;
}

/** px around the zoom point a mark may be and still be the one zoomed into (or its own drawn radius, when larger). */
export const REACH_PX = 48;
/** The Sequence has no code band: its last is the method band. */
const SEQUENCE_LAST = 2;
const CODE = 3;

const cameraOf = (p: Placement): string => p.cacheKey.split('|')[1] ?? '';
const hasSemanticMap = (camera: string): boolean => camera === 'map' || camera === '3d';

interface Candidate { id: string; key: string }

/** The folder marks (systems, apps) the placement on show draws as its level's children, when the drill may enter them. */
function folderCandidates(p: Placement, drill: DrillModel): Candidate[] {
    return (p.level?.children ?? []).flatMap((c) => (folderOfKey(c.key) !== null && drill.canEnter(c.key).can ? [{ id: c.key, key: c.key }] : []));
}

/** What the frame-time evaluator reads (kept in a ref so it is never stale); the code key and trail are written back from it. */
interface ZoomState {
    drill: DrillModel; map: StageMap; entries: ReadonlyMap<string, NestEntry>;
    codeKey: string | null; trail: readonly string[]; seqBand: number; band: number; candidates: Candidate[];
}

export function useSemanticZoom(bus: StageBus, drill: DrillModel, map: StageMap, reducedMotion: boolean): SemanticZoom {
    const { entries, add, nest, setBasis, awaitsBasis, nests } = useNestEntries(drill);
    const [trail, setTrail] = useState<readonly string[]>([]);
    const codeKey: string | null = trail.at(-1) ?? null;
    const [seqBand, setSeqBand] = useState(0);
    // An enter / out asked for and not yet in the stack: no second step until it lands.
    const pending = useRef(false);
    // A method's calls are drawn (the host's `PlacementReq.method`, which an across-opened method also sets): the ONE condition the Sequence's zoom gates on.
    const methodOpen = useRef(false);
    const setMethodOpen = useCallback((open: boolean) => { methodOpen.current = open; }, []);
    useEffect(() => { pending.current = false; }, [drill.stack]);
    // The code layer belongs to the level it opened on.
    useEffect(() => { setTrail([]); }, [map.drill]);

    // A system or an app is no band of its own: the system band spans the world, the systems and the apps (each is entered
    // by the same zoom, and left by the same zoom out), so the bands count the frames from the package down.
    const depth = Math.min(drill.stack.length - structuralDepth(drill.stack), CODE - 1);
    const band = codeKey ? CODE : depth;
    // What the zoom may go into at this band: stations it can enter (system, class bands), loaded methods (method band).
    const candidates = useMemo((): Candidate[] => {
        if (band >= CODE) return [];
        const loaded = new Set(drill.symbols.map((r) => r.ref));
        return map.stations.stations.flatMap((s) => {
            if (drill.view?.leaves.has(s.id)) return [];
            const key = map.keyOfStation(s);
            if (band < CODE - 1) return drill.canEnter(s.id).can ? [{ id: s.id, key }] : [];
            return key.startsWith('node:') && loaded.has(key.slice('node:'.length)) ? [{ id: s.id, key }] : [];
        });
    }, [band, map.stations, map.keyOfStation, drill.view, drill.canEnter, drill.symbols]); // eslint-disable-line react-hooks/exhaustive-deps

    // The band the ladder is walking to (-1: none), and what to do when a step has nothing to enter.
    const goal = useRef(-1);
    const blocked = useRef<() => void>(() => {});

    const state = useRef<ZoomState>({ drill, map, entries, codeKey, trail, seqBand, band, candidates });
    state.current = { drill, map, entries, codeKey, trail, seqBand, band, candidates };

    const evaluate = useCallback(() => {
        const p = bus.placement, proj = bus.projector;
        if (!p || !proj || bus.tweening || pending.current) return;
        const s = state.current;
        const rig = rigOf(bus);
        if (rig && !rig.canChangeZoomLevel) return;
        const at = rig?.focusPoint ?? [proj.width / 2, proj.height / 2];
        const camera = cameraOf(p);
        // Sequence: the band follows the size of its participants at every level. At code depth (a method is open) it draws
        // that method's calls, which have no bands, so the zoom there steps nothing. Flow's level is the drill's, not a zoom's.
        if (camera === 'sequence') {
            if (s.codeKey || methodOpen.current) return;
            const f = focusOf(p, proj, p.a11y.map((a) => a.slot), at, Number.POSITIVE_INFINITY);
            const next = f ? stepBand(s.seqBand, f.px, f.px, SEQUENCE_LAST) : s.seqBand;
            if (next !== s.seqBand) { s.seqBand = next; setSeqBand(next); }
            return;
        }
        if (!hasSemanticMap(camera) || (drillOfPlacement(p) || null) !== s.map.drill) return;
        const px = proj.pxPerWorld;
        const entry = s.map.drill ? s.entries.get(s.map.drill) : undefined;
        const parentPx = s.band === CODE ? drawnPx(p, bus.slotOf(s.codeKey), px) : entry ? entry.diameter * px : Number.POSITIVE_INFINITY;
        const cands = s.band < CODE - 1 ? [...s.candidates, ...folderCandidates(p, s.drill)] : s.candidates;
        const slots = cands.map((c) => bus.slotOf(c.key));
        const focus = focusOf(p, proj, slots, at, REACH_PX);
        const next = stepBand(s.band, focus?.px ?? 0, parentPx);
        if (next > s.band && focus) {
            const c = cands[slots.indexOf(focus.slot)]!;
            if (s.band === CODE - 1 && !(s.drill.hasMembers?.(c.id) && s.drill.canEnter(c.id).can)) {
                s.drill.select(c.id); s.codeKey = c.key; setTrail([c.key]); return;
            }
            const check = s.drill.canEnter(c.id);
            if (!check.can) return;
            const file = check.level === 'package' ? entryFileOf(s.map.stations.byId.get(c.id)) : undefined;
            if (file && s.drill.openFile) {
                pending.current = true;
                s.drill.openFile(file);
                return;
            }
            const e = nestEntryOf(p, focus.slot, `${check.level}:${check.ref}`);
            if (e) add(e);
            pending.current = true;
            s.drill.enter(c.id);
        } else if (next < s.band) {
            if (s.band === CODE) { s.codeKey = null; setTrail([]); return; }
            pending.current = true;
            s.drill.out();
        } else if (s.band === 0 && s.drill.stack.length > 0 && parentPx < ZOOM_BANDS[1]!.exitPx) {
            // Inside a system or an app (the system band): its mark shrinking below the next band's exit goes back out, as the bands do.
            pending.current = true;
            s.drill.out();
        }
    }, [bus]);

    useEffect(() => {
        const offFrame = bus.onFrame(evaluate);
        const offSettle = bus.onSettle(evaluate);
        return () => { offFrame(); offSettle(); };
    }, [bus, evaluate]);
    // A level or its symbols arriving can make the mark under the zoom enterable without the camera moving.
    useEffect(() => { evaluate(); }, [evaluate, candidates]);

    // The skip rule: a system or an app that holds exactly one child is not stood on, its child is entered in its place. The
    // placement's own level descriptor says what the level holds; the nest entry follows the frame it was recorded for.
    useEffect(() => bus.onPlacement(() => {
        const p = bus.placement, s = state.current;
        const top = s.drill.stack.at(-1), level = p?.level;
        if (!p || !top || !level || level.level !== top.level || level.ref !== top.ref || level.children.length !== 1 || level.total !== 1) return;
        if (top.level !== 'system' && top.level !== 'app') return;
        const only = level.children[0]!;
        // A folder mark is asked about by its slot key, a station by its id.
        const id = only.key.startsWith('st:') ? only.key.slice('st:'.length) : only.key;
        const check = s.drill.canEnter(id);
        if (!check.can || pending.current) return;
        const was = s.entries.get(drillKeyOf(top) ?? '');
        if (was) add({ ...was, drill: `${check.level}:${check.ref}` });
        pending.current = true;
        s.drill.enter(id, true);
    }), [bus, add]);

    const ms = reducedMotion ? 0 : TWEEN_MS;
    const stepGoal = useRef<() => boolean>(() => false);
    const walk = useCallback(() => {
        if (goal.current < 0) return;
        // The goal is a rail rung (`levelRung.ts`): a system or an app is a rung of its own, though no band.
        if (rungOf(state.current.drill.stack, !!state.current.codeKey) >= goal.current) { goal.current = -1; return; }
        if (pending.current || bus.tweening) return;
        if (!stepGoal.current()) { goal.current = -1; blocked.current(); }
    }, [bus]);
    // The ladder walks on: each level reached, each level that finishes loading and each landed tween takes the next step toward its goal.
    useEffect(() => { walk(); }, [walk, band, candidates, drill.stack]);
    useEffect(() => bus.onSettle(walk), [bus, walk]);

    const zoomInto = useCallback((stationId: string) => {
        const s = state.current, p = bus.placement, rig = rigOf(bus);
        // A folder mark (a system, an app) is named by its slot key; a station by its id.
        const station = s.map.stations.byId.get(stationId);
        const slot = station ? bus.slotOf(s.map.keyOfStation(station)) : folderOfKey(stationId) !== null ? bus.slotOf(stationId) : -1;
        const scale = p && slot >= 0 ? p.scale[slot] ?? 0 : 0;
        if (!rig || !p || !(scale > 0) || s.band >= CODE || !hasSemanticMap(cameraOf(p))) { s.drill.enter(stationId); return; }
        rig.flyTo(p.position[slot * 3]!, p.position[slot * 3 + 2]!, zoomForBand(s.band + 1, scale), now(), ms, p.position[slot * 3 + 1]);
    }, [bus, ms]);

    // An explicit band click SETS the band (the one state), then the camera follows it: band 0 is a fit, the others fly to the threshold.
    const zoomToBand = useCallback((target: number) => {
        const band = Math.max(0, Math.min(SEQUENCE_LAST, target));
        state.current.seqBand = band;
        setSeqBand(band);
        const p = bus.placement, rig = rigOf(bus);
        if (!p || !rig) return;
        if (band <= 0) { rig.fit(now(), ms); return; }
        const slot = p.a11y[0]?.slot ?? -1, v = rig.current;
        if (slot >= 0) rig.flyTo(v.cx, v.cz, zoomForBand(band, p.scale[slot] ?? 0), now(), ms);
    }, [bus, ms]);

    // Fly to method `key`'s code-band threshold (when the stage has a rig and the method a slot).
    const flyToCode = useCallback((key: string) => {
        const slot = bus.slotOf(key), p = bus.placement, rig = rigOf(bus);
        const scale = p && slot >= 0 ? p.scale[slot] ?? 0 : 0;
        if (rig && p && scale > 0) rig.flyTo(p.position[slot * 3]!, p.position[slot * 3 + 2]!, zoomForBand(CODE, scale), now(), ms, p.position[slot * 3 + 1]);
    }, [bus, ms]);

    const codeBack = useCallback((index: number) => {
        const s = state.current, key = s.trail[index];
        if (!key) return;
        s.codeKey = key;
        s.trail = s.trail.slice(0, index + 1);
        setTrail(s.trail);
        flyToCode(key);
    }, [flyToCode]);

    const leaveCode = useCallback(() => {
        const s = state.current, key = s.codeKey, p = bus.placement, rig = rigOf(bus);
        const slot = bus.slotOf(key), scale = p && slot >= 0 ? p.scale[slot] ?? 0 : 0;
        if (!rig || !p || !(scale > 0)) { s.codeKey = null; s.trail = []; setTrail([]); return; }
        // Back under the code band's exit: the crossing closes it (the whole trail), and the method band is not re-entered from there.
        rig.flyTo(p.position[slot * 3]!, p.position[slot * 3 + 2]!, (ZOOM_BANDS[CODE]!.exitPx * 0.85) / (2 * scale), now(), ms, p.position[slot * 3 + 1]);
    }, [bus, ms]);

    const outToBand = useCallback((target: number) => {
        const s = state.current;
        goal.current = -1;
        if (target >= s.band) return;
        if (s.band === CODE) {
            if (target === CODE - 1) { leaveCode(); return; }
            s.codeKey = null; s.trail = []; setTrail([]);
        }
        pending.current = true;
        // Bands count from the package down: the system and app frames stay under them.
        s.drill.climb(structuralDepth(s.drill.stack) + target);
        // The camera is still zoomed in: fit it, or the crossing would go straight back in.
        rigOf(bus)?.fit(now(), ms);
    }, [bus, ms, leaveCode]);

    // The rail's click out to `rung`: close the code, then keep the frames up to that rung (System is the world).
    const outToRung = useCallback((rung: number) => {
        const s = state.current;
        goal.current = -1;
        if (s.codeKey) {
            if (rung >= RUNG_METHOD) { leaveCode(); return; }
            s.codeKey = null; s.trail = []; setTrail([]);
        }
        const keep = stackLengthForRung(s.drill.stack, rung);
        if (keep >= s.drill.stack.length) return;
        pending.current = true;
        s.drill.climb(keep);
        rigOf(bus)?.fit(now(), ms);
    }, [bus, ms, leaveCode]);

    // One step out: the code, else the band, else the system or app the drill is inside.
    const outOne = useCallback(() => {
        const s = state.current;
        if (s.band === CODE) { if (s.trail.length > 1) codeBack(s.trail.length - 2); else leaveCode(); return; }
        if (s.band > 0) { outToBand(s.band - 1); return; }
        if (s.drill.stack.length === 0) return;
        pending.current = true;
        s.drill.out();
        rigOf(bus)?.fit(now(), ms);
    }, [bus, ms, codeBack, leaveCode, outToBand]);

    const closeCode = useCallback(() => {
        const s = state.current;
        if (s.trail.length > 1) codeBack(s.trail.length - 2); else leaveCode();
    }, [codeBack, leaveCode]);

    // A drill from the code: at the code band the method goes onto the trail (cut back to it when it is already there),
    // from the method band it starts one; the rig flies to its threshold.
    const enterCode = useCallback((ref: string): boolean => {
        const s = state.current, key = `node:${ref}`;
        if (s.band < CODE - 1 || bus.slotOf(key) < 0 || !codeTargetOf(ref, s.drill.symbols)) return false;
        const at = s.trail.indexOf(key);
        s.trail = s.band === CODE ? (at >= 0 ? s.trail.slice(0, at + 1) : [...s.trail, key]) : [key];
        s.codeKey = key;
        if (s.map.stations.byId.has(ref)) s.drill.select(ref);
        setTrail(s.trail);
        flyToCode(key);
        return true;
    }, [bus, flyToCode]);

    const stepIn = useCallback((prefer: string | null): boolean => {
        const s = state.current, p = bus.placement, proj = bus.projector;
        if (s.band >= CODE || pending.current || bus.tweening) return false;
        const cands = s.band < CODE - 1 && p ? [...s.candidates, ...folderCandidates(p, s.drill)] : s.candidates;
        let c = cands.find((k) => k.key === prefer);
        // At the method band a loaded method that is not a station of this level still opens its code.
        if (!c && prefer?.startsWith('node:') && s.band === CODE - 1 && codeTargetOf(prefer.slice(5), s.drill.symbols)) return enterCode(prefer.slice(5));
        if (!c && p && proj) {
            const slots = cands.map((k) => bus.slotOf(k.key));
            const at = rigOf(bus)?.focusPoint ?? [proj.width / 2, proj.height / 2];
            const f = focusOf(p, proj, slots, at, Number.POSITIVE_INFINITY);
            if (f) c = cands[slots.indexOf(f.slot)];
        }
        if (!c) return false;
        if (s.band === CODE - 1 && !(s.drill.hasMembers?.(c.id) && s.drill.canEnter(c.id).can)) return enterCode(c.key.slice('node:'.length));
        zoomInto(c.id);
        return true;
    }, [bus, enterCode, zoomInto]);
    stepGoal.current = () => stepIn(null);

    // In toward rail rung `rung` step by step; `walk` takes the next step as each level lands.
    const walkIn = useCallback((rung: number, prefer: string | null, onBlocked: () => void) => {
        blocked.current = onBlocked;
        goal.current = rung;
        if (!stepIn(prefer)) { goal.current = -1; onBlocked(); }
    }, [stepIn]);

    const toBand = useCallback((target: number, prefer: string | null, onBlocked: () => void) => {
        const s = state.current;
        blocked.current = onBlocked;
        if (target < s.band) { goal.current = -1; outToBand(target); return; }
        const rung = RUNG_OF_BAND[Math.min(target, CODE)]!;
        if (target === s.band || rungOf(s.drill.stack, !!s.codeKey) >= rung) { goal.current = -1; return; }
        walkIn(rung, prefer, onBlocked);
    }, [outToBand, walkIn]);

    const rung = rungOf(drill.stack, !!codeKey);
    const toRung = useCallback((target: number, prefer: string | null, onBlocked: () => void) => {
        const s = state.current, now_ = rungOf(s.drill.stack, !!s.codeKey);
        if (target < now_) { outToRung(target); return; }
        if (target === now_) { goal.current = -1; return; }
        walkIn(target, prefer, onBlocked);
    }, [outToRung, walkIn]);

    const code = useMemo(() => {
        const target = codeKey ? codeTargetOf(codeKey.slice('node:'.length), drill.symbols) : null;
        return codeKey && target ? { key: codeKey, target } : null;
    }, [codeKey, drill.symbols]);

    const crumbs = useMemo(() => trail.map((k) => {
        const ref = k.slice('node:'.length);
        return { ref, name: codeTargetOf(ref, drill.symbols)?.name ?? ref };
    }), [trail, drill.symbols]);

    return {
        band: bandOf(band), sequenceLod: sequenceLodOf(seqBand), nest, setBasis, awaitsBasis, nests, zoomInto, zoomToBand, setMethodOpen, outToBand, stepIn, toBand, rung, toRung, outOne, code, closeCode, leaveCode, enterCode,
        trail: crumbs, codeBack,
    };
}
