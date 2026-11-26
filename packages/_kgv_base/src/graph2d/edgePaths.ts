/**
 * The 2D graph's edges as SVG path data: ONE `d` string per tone bucket. Pure, so the compute worker builds the big
 * (drawn) set off the main thread and the component builds the small (selection) set with the same function.
 */

import type { EdgeGroup } from '../scene/buffers';
import type { ThemeTone } from '../scene/themeColors';

export interface EdgePath { bucket: string; tone: ThemeTone; d: string }

const segments = (pairs: ReadonlyArray<readonly [readonly [number, number], readonly [number, number]]>): string =>
    pairs.map(([a, b]) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`).join('');

/** Path data per tone bucket, built once per set of groups (not on every render of a selection). */
export const pathsOf = (groups: Array<EdgeGroup<readonly [number, number]>>): EdgePath[] => groups.map((g) => ({ bucket: g.bucket, tone: g.tone, d: segments(g.pairs) }));
