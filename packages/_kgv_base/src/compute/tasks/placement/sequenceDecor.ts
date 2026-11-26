/**
 * The Sequence's decorations as link paths (PRD 43 B1a rule 10) — no new rendering, the stage's existing families:
 *
 *   - activation bars: a thick `route` segment down the callee's lifeline from its call to its return;
 *   - return markers: a dashed `arrow` back from callee to caller just under the last message inside the call (deeper
 *     calls return first, so nested returns never share a row);
 *   - association stubs (class band): a short dotted `describes` stub from a participant's head toward the class it
 *     `extends` / `implements` / `composes`, toned per kind.
 *
 * Row geometry is shared with `sequence.ts` through {@link SequenceRows}. Pure.
 */

import { toneIndex } from '../../../stage/tones';
import { DASH_DESCRIBES, DASH_SOLID, DASH_UNTESTED, type Vec3 } from '../../../stage/types';
import { ASSOCIATION_STYLE } from './associations';
import type { AssociationKind } from './callIndex';
import type { WorldPath } from './links';
import { SEQUENCE_MAX_DEPTH, type Flow, type FlowMessage } from './sequenceFlow';

export interface SequenceRows {
    /** World z of message row `i`. */
    rowZ(i: number): number;
    row: number;
    /** The participant's head position (x, y = its layer depth, z = the head row). */
    column: ReadonlyMap<string, Vec3>;
    mark: number;
}

/** Activation bar width (world units) and how far a stub reaches toward its target (world units). */
export const ACTIVATION_WIDTH = 6;
export const STUB_LENGTH = 28;

/** A stub's tone is its kind's in the ONE association style table (the class band's links read it too). */
const stubTone = (kind: AssociationKind): number => toneIndex(ASSOCIATION_STYLE[kind].tone);

/** The z a call's return (and its activation's end) sits at: under the call's last inner message, deeper calls first. */
export function returnZ(m: FlowMessage, rows: SequenceRows): number {
    return rows.rowZ(m.end) + rows.row * (0.3 + 0.12 * (SEQUENCE_MAX_DEPTH - 1 - Math.min(m.depth, SEQUENCE_MAX_DEPTH - 1)));
}

/** A call returns (and activates its callee) when it goes to another participant; a self-call is its own loop. */
const returns = (m: FlowMessage): boolean => m.from !== m.to;

export function activationPaths(messages: readonly FlowMessage[], rows: SequenceRows): WorldPath[] {
    const tone = toneIndex('plane');
    return messages.flatMap((m, i) => {
        if (!returns(m)) return [];
        const b = rows.column.get(m.to)!;
        return [{ pts: [[b[0], b[1], rows.rowZ(i)], [b[0], b[1], returnZ(m, rows)]], tone, width: ACTIVATION_WIDTH, dash: DASH_SOLID, flags: 0 }];
    });
}

export function returnPaths(messages: readonly FlowMessage[], rows: SequenceRows): WorldPath[] {
    const tone = toneIndex('muted');
    return messages.flatMap((m) => {
        if (!returns(m)) return [];
        const a = rows.column.get(m.from)!, b = rows.column.get(m.to)!, z = returnZ(m, rows);
        return [{ pts: [[b[0], b[1], z], [a[0], a[1], z]], tone, width: 1, dash: DASH_UNTESTED, flags: 0 }];
    });
}

export function stubPaths(stubs: Flow['stubs'], rows: SequenceRows): WorldPath[] {
    return stubs.map((s) => {
        const a = rows.column.get(s.from)!, b = rows.column.get(s.to)!;
        const dir = Math.sign(b[0] - a[0]) || 1, z = a[2] + rows.mark + 6;
        return { pts: [[a[0], a[1], z], [a[0] + dir * STUB_LENGTH, a[1], z]], tone: stubTone(s.kind), width: 1.5, dash: DASH_DESCRIBES, flags: 0 };
    });
}
