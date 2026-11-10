/**
 * The simulation, as a pure walk of a path's hops. Nothing is executed: each step shows the
 * values known at that point, where a value is either RECORDED (the host captured it) or EDITED
 * (the person typed it). A result is shown only when it was recorded AND nothing upstream of it
 * was edited (or the stop is stubbed to its recorded value); otherwise it is unknown and the real
 * run is the agent's. The words (code lines, notes) are catalog templates filled from the path.
 */

import type { RecordedRun, RecordedValue } from '../../fixPorts';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import type { PathModel } from '../path';
import { hopText } from '../sequenceText';
import type { Station } from '../stations';
import { hopProbabilityText, hopTransition, likelyWalk, type TransitionTable, type WalkHop } from '../transitionTable';

export type ValueOrigin = 'recorded' | 'edited';

export interface SimVar { name: string; value: string; origin: ValueOrigin; stopId: string; bytes?: number }
export interface SimLine { n: number; text: string; note?: string }
export interface SimResult { value: string; origin: 'recorded' | 'unknown' }

export interface SimStep {
    index: number;
    stopId: string;
    stubbed: boolean;
    lines: SimLine[];
    /** Every input known by this step (edits applied) and each output recorded up to it. */
    vars: SimVar[];
    /** The result at this step: a recorded value, or unknown (an upstream input was edited and the stop is not stubbed). */
    result: SimResult | null;
    /** The most likely walk out of this stop (PRD 38 P7, memory's `mostLikelyWalk`); null without a transition table. */
    walk: WalkHop[] | null;
}

export interface SimInputs {
    path: PathModel;
    recorded: RecordedRun | null;
    /** Edited argument values by name; absent ⇒ the recorded one. */
    edits: Readonly<Record<string, string>>;
    /** Stop ids whose port is stubbed: they answer with their recorded output whatever came in. */
    stubs: ReadonlySet<string>;
    labels: KnowledgeGraphLabels;
    /** The note per stop (stationNote), by stop id. */
    notes?: ReadonlyMap<string, string>;
    /** The route label per hop (hopRouteLabels), indexed like `path.hops`. */
    routeLabels?: readonly (string | null)[];
    /** The station transition table (`transitionTableOf`): each call line shows its hop's probability, each step its likely walk. */
    transitions?: TransitionTable | null;
    /** The stations by id, to name the walk's stops (a walk may leave the path). */
    stations?: ReadonlyMap<string, Pick<Station, 'name'>>;
}

const inputsOf = (run: RecordedRun | null): RecordedValue[] => (run?.values ?? []).filter((v) => v.direction === 'in');

/** The argument names a run takes, once each, in the order they were recorded. */
export function argumentNames(run: RecordedRun | null): string[] {
    return [...new Set(inputsOf(run).map((v) => v.name))];
}

export function simulate({ path, recorded, edits, stubs, labels, notes, routeLabels, transitions, stations }: SimInputs): SimStep[] {
    const names = stations ?? new Map(path.stops.map((s) => [s.id, s]));
    const t = labels.surface.simulate;
    const values = recorded?.values ?? [];
    const edited = (name: string) => Object.prototype.hasOwnProperty.call(edits, name) && edits[name] !== (inputsOf(recorded).find((v) => v.name === name)?.value);
    const anyEdit = (upTo: number): boolean => inputsOf(recorded).some((v) => {
        const at = path.stops.findIndex((s) => s.id === v.stopId);
        return at >= 0 && at <= upTo && edited(v.name);
    });

    return path.stops.map((stop, i) => {
        const next = path.stops[i + 1];
        const hop = path.hops[i];
        const lines: SimLine[] = [{ n: 1, text: fillTemplate(t.lineEnter, { name: stop.name }), ...(notes?.get(stop.id) ? { note: notes.get(stop.id)! } : {}) }];
        if (next && hop) {
            const route = routeLabels?.[i];
            const p = hopProbabilityText(labels, hopTransition(transitions, stop.id, next.id));
            const note = [hopText(labels, hop), p, route].filter((x): x is string => !!x).join(' · ');
            lines.push({ n: 2, text: fillTemplate(t.lineCall, { name: next.name }), note });
        } else {
            lines.push({ n: 2, text: fillTemplate(t.lineReturn, { name: stop.name }) });
        }

        const known = values.filter((v) => {
            const at = path.stops.findIndex((s) => s.id === v.stopId);
            return at >= 0 && at <= i;
        });
        const vars: SimVar[] = known.map((v) => {
            const isEdit = v.direction === 'in' && edited(v.name);
            return { name: v.name, value: isEdit ? edits[v.name]! : v.value, origin: isEdit ? 'edited' : 'recorded', stopId: v.stopId, ...(v.bytes !== undefined ? { bytes: v.bytes } : {}) };
        });

        const out = [...known].reverse().find((v) => v.direction === 'out');
        const stubbed = stubs.has(stop.id);
        const result: SimResult | null = !out ? null : anyEdit(i) && !stubbed ? { value: t.unknownResult, origin: 'unknown' } : { value: out.value, origin: 'recorded' };
        const walk = transitions ? likelyWalk(transitions, stop.id, names, labels) : null;
        return { index: i, stopId: stop.id, stubbed, lines, vars, result, walk };
    });
}

/** The step at `at`, clamped into the walk (the strip's step is shared and may sit outside). */
export const stepAt = (steps: readonly SimStep[], at: number): SimStep | null => steps[Math.min(Math.max(at, 0), steps.length - 1)] ?? null;
