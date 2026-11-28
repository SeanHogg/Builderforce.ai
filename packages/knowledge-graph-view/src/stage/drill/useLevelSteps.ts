/**
 * The level ladder of the semantic zoom (`useSemanticZoom.ts`): the steps that move the drill between rail rungs and the
 * levels a system or an app adds above the bands.
 *
 *   - the folder candidates: the systems and apps the placement on show draws, entered by `dir:<path>` whatever slot they stand on;
 *   - the skip rule: a system or an app that holds exactly one child is not stood on, its child is entered in its place;
 *   - the rail's walk: out to a rung (climb), in toward it step by step (`walk` takes the next step as each level lands);
 *   - one step out.
 */

import { useCallback, useEffect, type MutableRefObject } from 'react';
import { drillKeyOf } from '../../compute/tasks/placement/request';
import { dirKey } from '../../compute/tasks/markSet';
import { folderIdOfMark } from '../../surface/transit/levelFrames';
import type { DrillModel } from '../../surface/transit/useDrill';
import type { StageBus } from '../anchor/stageBus';
import { rigOf } from '../rig/rigOfBus';
import { now } from '../tween';
import type { Placement } from '../types';
import { RUNG_METHOD, rungOf, stackLengthForRung } from './levelRung';
import type { NestEntry } from './nest';
import type { StageMap } from './useStageMap';

/** The code band's index (0 system … 3 code). */
export const CODE = 3;

export interface Candidate { id: string; key: string }

/** What the frame-time evaluator reads (kept in a ref so it is never stale); the code key and trail are written back from it. */
export interface ZoomState {
    drill: DrillModel; map: StageMap; entries: ReadonlyMap<string, NestEntry>;
    codeKey: string | null; trail: readonly string[]; seqBand: number; band: number; candidates: Candidate[];
}

/** The folder marks (systems, apps) the placement on show draws as its level's children, when the drill may enter them: `id` enters, `key` is the mark. */
export function folderCandidates(p: Placement, drill: DrillModel): Candidate[] {
    return (p.level?.children ?? []).flatMap((c) => {
        if (c.folder === undefined) return [];
        const id = dirKey(c.folder);
        return drill.canEnter(id).can ? [{ id, key: c.key }] : [];
    });
}

interface LevelStepsIn {
    bus: StageBus;
    state: MutableRefObject<ZoomState>;
    pending: MutableRefObject<boolean>;
    /** The rail rung the ladder is walking to (-1: none), and what to do when a step has nothing to enter. */
    goal: MutableRefObject<number>;
    blocked: MutableRefObject<() => void>;
    add(e: NestEntry): void;
    setTrail(trail: readonly string[]): void;
    ms: number;
    band: number;
    candidates: Candidate[];
    stack: DrillModel['stack'];
    leaveCode(): void;
    codeBack(index: number): void;
    outToBand(target: number): void;
    stepIn(prefer: string | null): boolean;
}

export interface LevelSteps {
    /** One step out: leave the code, else the band, else the system or app the drill is inside. */
    outOne(): void;
    /** In toward rail rung `rung` step by step; `walk` takes the next step as each level lands. */
    walkIn(rung: number, prefer: string | null, onBlocked: () => void): void;
    /** The rail's click: go out to rung `target`, or in toward it (`onBlocked` runs when a step has nothing to enter). */
    toRung(target: number, prefer: string | null, onBlocked: () => void): void;
}

export function useLevelSteps(i: LevelStepsIn): LevelSteps {
    const { bus, state, pending, goal, blocked, add, setTrail, ms, band, candidates, stack, leaveCode, codeBack, outToBand, stepIn } = i;

    // The skip rule: a system or an app that holds exactly one child is not stood on, its child is entered in its place. The
    // placement's own level descriptor says what the level holds; the nest entry follows the frame it was recorded for, and keeps
    // the mark it was entered from (the folder's), apart from the drill key it is rewritten to.
    useEffect(() => bus.onPlacement(() => {
        const p = bus.placement, s = state.current;
        const top = s.drill.stack.at(-1), level = p?.level;
        if (!p || !top || !level || level.level !== top.level || level.ref !== top.ref || level.children.length !== 1 || level.total !== 1) return;
        if (top.level !== 'system' && top.level !== 'app') return;
        const only = level.children[0]!;
        // A folder child is entered by its folder, a station child by its id.
        const id = folderIdOfMark(level, only.key) ?? s.map.stationOfKey(only.key)?.id;
        if (!id) return;
        const check = s.drill.canEnter(id);
        if (!check.can || pending.current) return;
        const was = s.entries.get(drillKeyOf(top) ?? '');
        if (was) add({ ...was, drill: `${check.level}:${check.ref}` });
        pending.current = true;
        s.drill.enter(id, true);
    }), [bus, add, state, pending]);

    const walk = useCallback(() => {
        if (goal.current < 0) return;
        // The goal is a rail rung (`levelRung.ts`): a system or an app is a rung of its own, though no band.
        if (rungOf(state.current.drill.stack, !!state.current.codeKey) >= goal.current) { goal.current = -1; return; }
        if (pending.current || bus.tweening) return;
        if (!stepIn(null)) { goal.current = -1; blocked.current(); }
    }, [bus, state, pending, goal, blocked, stepIn]);
    // The ladder walks on: each level reached, each level that finishes loading and each landed tween takes the next step toward its goal.
    useEffect(() => { walk(); }, [walk, band, candidates, stack]);
    useEffect(() => bus.onSettle(walk), [bus, walk]);

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
    }, [bus, ms, leaveCode, state, goal, pending, setTrail]);

    const outOne = useCallback(() => {
        const s = state.current;
        if (s.band === CODE) { if (s.trail.length > 1) codeBack(s.trail.length - 2); else leaveCode(); return; }
        if (s.band > 0) { outToBand(s.band - 1); return; }
        if (s.drill.stack.length === 0) return;
        pending.current = true;
        s.drill.out();
        rigOf(bus)?.fit(now(), ms);
    }, [bus, ms, codeBack, leaveCode, outToBand, state, pending]);

    const walkIn = useCallback((rung: number, prefer: string | null, onBlocked: () => void) => {
        blocked.current = onBlocked;
        goal.current = rung;
        if (!stepIn(prefer)) { goal.current = -1; onBlocked(); }
    }, [stepIn, blocked, goal]);

    const toRung = useCallback((target: number, prefer: string | null, onBlocked: () => void) => {
        const s = state.current, at = rungOf(s.drill.stack, !!s.codeKey);
        if (target < at) { outToRung(target); return; }
        if (target === at) { goal.current = -1; return; }
        walkIn(target, prefer, onBlocked);
    }, [outToRung, walkIn, state, goal]);

    return { outOne, walkIn, toRung };
}
