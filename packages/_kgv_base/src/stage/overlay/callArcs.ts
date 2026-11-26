/**
 * The open method's numbered calls on the stage (PRD 43 B1a rule 9, the code band), pure: which slots they run between
 * ({@link callTrackOf}) and the bent arc each is drawn as ({@link callArc}), with the point its number sits on
 * ({@link badgeAt}). The overlay draws the arcs (`OverlayLayer`) and the DOM numbers sit on the same points
 * (`CallBadges`), so a number is always on its own arc.
 */

import { fileRefOf } from '../../surface/stations';
import type { CallStep } from '../drill/codeText';

/** The open method's calls by slot: `from` the method, `to[i]` step i's callee (-1 when it has no mark), `current` the step on the reading line. */
export interface CallTrack { from: number; to: readonly number[]; current: number }

/** A ground point (world x, z). */
export interface GroundPt { x: number; y: number }

/** Points per arc. */
export const ARC_SAMPLES = 12;
/** How far an arc bows sideways, as a share of its length; each further call to the same callee bows this much more. */
const BEND = 0.12;
/** Where along its arc a call's number sits; each further call to the same callee sits this much nearer the method. */
const BADGE_T = 0.74, BADGE_STEP = 0.12;

/** `ref`'s mark on the stage: its own, else its file's (a symbol of a level not drilled into); -1 when neither has one. */
export function markOf(ref: string, slotOf: (key: string) => number): number {
    const own = slotOf(`node:${ref}`);
    return own >= 0 ? own : slotOf(`node:${fileRefOf(ref)}`);
}

/** The track of `method`'s calls on the stage, each callee at {@link markOf}. Null when the method has no mark of its own or no calls. */
export function callTrackOf(method: string | null, steps: readonly CallStep[], current: number, slotOf: (key: string) => number): CallTrack | null {
    const from = method ? slotOf(`node:${method}`) : -1;
    if (from < 0 || steps.length === 0) return null;
    return { from, to: steps.map((s) => markOf(s.to, slotOf)), current };
}

/** How many steps before `i` call the same slot (the 2nd call to a callee is 1): its arc bows further out. */
export function nthCallTo(to: ArrayLike<number>, i: number): number {
    let n = 0;
    for (let k = 0; k < i; k++) if (to[k] === to[i]) n++;
    return n;
}

function control(a: GroundPt, b: GroundPt, nth: number): GroundPt {
    const k = BEND * (1 + nth);
    return { x: (a.x + b.x) / 2 - (b.y - a.y) * k, y: (a.y + b.y) / 2 + (b.x - a.x) * k };
}

const quad = (a: GroundPt, c: GroundPt, b: GroundPt, t: number): GroundPt => {
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
};

/** The arc from the method `a` to the callee `b` for the `nth` call to it, as {@link ARC_SAMPLES} + 1 points. */
export function callArc(a: GroundPt, b: GroundPt, nth: number): GroundPt[] {
    const c = control(a, b, nth);
    return Array.from({ length: ARC_SAMPLES + 1 }, (_, i) => quad(a, c, b, i / ARC_SAMPLES));
}

/** Where the `nth` call to `b`'s number sits on its arc. */
export function badgeAt(a: GroundPt, b: GroundPt, nth: number): GroundPt {
    return quad(a, control(a, b, nth), b, Math.max(0, BADGE_T - nth * BADGE_STEP));
}
