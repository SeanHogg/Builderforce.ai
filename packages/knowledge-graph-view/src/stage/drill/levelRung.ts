/**
 * The level rail's rung of a drill (the mockup's System / Component / Class / Method / Line), from the drill's innermost
 * frame: the world and a system are System, an app and a package are Component, a class Class, a function Method, and the
 * code band Line. ONE table, read by the rail (where it stands) and by the zoom ladder (where a rung click walks to). Pure.
 */

import type { DrillFrame, DrillLevel } from '../../surface/transit/drillView';

export const RUNG_SYSTEM = 0;
export const RUNG_COMPONENT = 1;
export const RUNG_CLASS = 2;
export const RUNG_METHOD = 3;
export const RUNG_LINE = 4;

const RUNG_OF_LEVEL: Readonly<Record<DrillLevel | 'world', number>> = {
    world: RUNG_SYSTEM, system: RUNG_SYSTEM, app: RUNG_COMPONENT, package: RUNG_COMPONENT, class: RUNG_CLASS, function: RUNG_METHOD,
};

/** The rung the drill stands on; the code band is always Line. */
export function rungOf(stack: readonly Pick<DrillFrame, 'level'>[], codeOpen: boolean): number {
    if (codeOpen) return RUNG_LINE;
    return stack.length === 0 ? RUNG_SYSTEM : RUNG_OF_LEVEL[stack[stack.length - 1]!.level];
}

/** The rung a zoom BAND (0 system … 3 code) reads as when it is asked for by number. */
export const RUNG_OF_BAND: readonly number[] = [RUNG_SYSTEM, RUNG_COMPONENT, RUNG_CLASS, RUNG_LINE];

/**
 * How many frames to keep to stand on rung `rung` (going OUT): none for System (the world), else the frames up to and
 * including the deepest one whose rung is at most `rung`.
 */
export function stackLengthForRung(stack: readonly Pick<DrillFrame, 'level'>[], rung: number): number {
    if (rung <= RUNG_SYSTEM) return 0;
    let keep = 0;
    stack.forEach((frame, i) => { if (RUNG_OF_LEVEL[frame.level] <= rung) keep = i + 1; });
    return keep;
}
