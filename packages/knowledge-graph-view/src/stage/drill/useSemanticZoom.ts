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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DrillModel } from '../../surface/transit/useDrill';
import type { StageBus } from '../anchor/stageBus';
import { ZOOM_BANDS, type ZoomBand } from '../labels/lod';
import { rigOf } from '../rig/rigOfBus';
import { bandOf, drawnPx, focusOf, sequenceLodOf, stepBand, zoomForBand } from '../rig/zoomBand';
import { now, TWEEN_MS } from '../tween';
import type { Placement } from '../types';
import { codeTargetOf, type CodeTarget } from './codeText';
import { drillOfPlacement, nestEntryOf, nestPlacement, type NestEntry } from './nest';
import type { StageMap } from './useStageMap';

export interface SemanticZoom {
    /** The Map's band on show. */
    band: ZoomBand;
    /** The Sequence's `req.lod`, from its own zoom (rule 10). */
    sequenceLod: number;
    /** The Map placement nested into the mark the zoom entered (the same placement when the zoom did not enter it). */
    nest(p: Placement): Placement;
    /** "Go inside": fly to the station at the next band's threshold (the zoom crossing enters it). */
    zoomInto(stationId: string): void;
    /** The Map's ladder: go back out to band `target` (0 system … CODE-1 method). Bands at or past the current one stay. */
    outToBand(target: number): void;
    /** The Sequence's band control: fly to band `band`'s threshold (0 = Fit). */
    zoomToBand(band: number): void;
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

interface Candidate { id: string; key: string }

/** What the frame-time evaluator reads (kept in a ref so it is never stale); the code key and trail are written back from it. */
interface ZoomState {
    drill: DrillModel; map: StageMap; entries: ReadonlyMap<string, NestEntry>;
    codeKey: string | null; trail: readonly string[]; seqBand: number; band: number; candidates: Candidate[];
}

export function useSemanticZoom(bus: StageBus, drill: DrillModel, map: StageMap, reducedMotion: boolean): SemanticZoom {
    const [entries, setEntries] = useState<ReadonlyMap<string, NestEntry>>(() => new Map());
    const [trail, setTrail] = useState<readonly string[]>([]);
    const codeKey: string | null = trail.at(-1) ?? null;
    const [seqBand, setSeqBand] = useState(0);
    // An enter / out asked for and not yet in the stack: no second step until it lands.
    const pending = useRef(false);
    useEffect(() => { pending.current = false; }, [drill.stack]);
    // The code layer belongs to the level it opened on.
    useEffect(() => { setTrail([]); }, [map.drill]);

    const depth = Math.min(drill.stack.length, CODE - 1);
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

    const state = useRef<ZoomState>({ drill, map, entries, codeKey, trail, seqBand, band, candidates });
    state.current = { drill, map, entries, codeKey, trail, seqBand, band, candidates };

    const evaluate = useCallback(() => {
        const p = bus.placement, proj = bus.projector;
        if (!p || !proj || bus.tweening || pending.current) return;
        const s = state.current;
        const at = rigOf(bus)?.focusPoint ?? [proj.width / 2, proj.height / 2];
        const camera = cameraOf(p);
        if (camera === 'sequence') {
            const f = focusOf(p, proj, p.a11y.map((a) => a.slot), at, Number.POSITIVE_INFINITY);
            const next = f ? stepBand(s.seqBand, f.px, f.px, SEQUENCE_LAST) : s.seqBand;
            if (next !== s.seqBand) { s.seqBand = next; setSeqBand(next); }
            return;
        }
        if (camera !== 'map') return;
        const px = proj.pxPerWorld;
        const entry = s.map.drill ? s.entries.get(s.map.drill) : undefined;
        const parentPx = s.band === CODE ? drawnPx(p, bus.slotOf(s.codeKey), px) : entry ? entry.diameter * px : Number.POSITIVE_INFINITY;
        const slots = s.candidates.map((c) => bus.slotOf(c.key));
        const focus = focusOf(p, proj, slots, at, REACH_PX);
        const next = stepBand(s.band, focus?.px ?? 0, parentPx);
        if (next > s.band && focus) {
            const c = s.candidates[slots.indexOf(focus.slot)]!;
            if (s.band === CODE - 1) { s.codeKey = c.key; setTrail([c.key]); return; }
            const check = s.drill.canEnter(c.id);
            if (!check.can) return;
            const e = nestEntryOf(p, focus.slot, `${check.level}:${c.id}`);
            if (e) setEntries((m) => new Map(m).set(e.drill, e));
            pending.current = true;
            s.drill.enter(c.id);
        } else if (next < s.band) {
            if (s.band === CODE) { s.codeKey = null; setTrail([]); return; }
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

    const ms = reducedMotion ? 0 : TWEEN_MS;
    const zoomInto = useCallback((stationId: string) => {
        const s = state.current, p = bus.placement, rig = rigOf(bus);
        const station = s.map.stations.byId.get(stationId);
        const slot = station ? bus.slotOf(s.map.keyOfStation(station)) : -1;
        const scale = p && slot >= 0 ? p.scale[slot] ?? 0 : 0;
        if (!rig || !p || !(scale > 0) || s.band >= CODE || cameraOf(p) !== 'map') { s.drill.enter(stationId); return; }
        rig.flyTo(p.position[slot * 3]!, p.position[slot * 3 + 2]!, zoomForBand(s.band + 1, scale), now(), ms);
    }, [bus, ms]);

    const zoomToBand = useCallback((target: number) => {
        const p = bus.placement, rig = rigOf(bus);
        if (!p || !rig) { setSeqBand(Math.max(0, Math.min(SEQUENCE_LAST, target))); return; }
        if (target <= 0) { rig.fit(now(), ms); return; }
        const slot = p.a11y[0]?.slot ?? -1, v = rig.current;
        if (slot >= 0) rig.flyTo(v.cx, v.cz, zoomForBand(Math.min(SEQUENCE_LAST, target), p.scale[slot] ?? 0), now(), ms);
    }, [bus, ms]);

    // Fly to method `key`'s code-band threshold (when the stage has a rig and the method a slot).
    const flyToCode = useCallback((key: string) => {
        const slot = bus.slotOf(key), p = bus.placement, rig = rigOf(bus);
        const scale = p && slot >= 0 ? p.scale[slot] ?? 0 : 0;
        if (rig && p && scale > 0) rig.flyTo(p.position[slot * 3]!, p.position[slot * 3 + 2]!, zoomForBand(CODE, scale), now(), ms);
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
        rig.flyTo(p.position[slot * 3]!, p.position[slot * 3 + 2]!, (ZOOM_BANDS[CODE]!.exitPx * 0.85) / (2 * scale), now(), ms);
    }, [bus, ms]);

    const outToBand = useCallback((target: number) => {
        const s = state.current;
        if (target >= s.band) return;
        if (s.band === CODE) {
            if (target === CODE - 1) { leaveCode(); return; }
            s.codeKey = null; s.trail = []; setTrail([]);
        }
        pending.current = true;
        s.drill.climb(target);
        // The camera is still zoomed in: fit it, or the crossing would go straight back in.
        rigOf(bus)?.fit(now(), ms);
    }, [bus, ms, leaveCode]);

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
        setTrail(s.trail);
        flyToCode(key);
        return true;
    }, [bus, flyToCode]);

    const nested = useMemo(() => new WeakMap<Placement, Placement>(), [entries]);
    const nest = useCallback((p: Placement): Placement => {
        const e = entries.get(drillOfPlacement(p));
        if (!e || e.outer.generation !== p.generation) return p;
        let out = nested.get(p);
        if (!out) { out = nestPlacement(p, e); nested.set(p, out); }
        return out;
    }, [entries, nested]);

    const code = useMemo(() => {
        const target = codeKey ? codeTargetOf(codeKey.slice('node:'.length), drill.symbols) : null;
        return codeKey && target ? { key: codeKey, target } : null;
    }, [codeKey, drill.symbols]);

    const crumbs = useMemo(() => trail.map((k) => {
        const ref = k.slice('node:'.length);
        return { ref, name: codeTargetOf(ref, drill.symbols)?.name ?? ref };
    }), [trail, drill.symbols]);

    return {
        band: bandOf(band), sequenceLod: sequenceLodOf(seqBand), nest, zoomInto, zoomToBand, outToBand, code, closeCode, leaveCode, enterCode,
        trail: crumbs, codeBack,
    };
}
