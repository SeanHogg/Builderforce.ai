/**
 * Which drill the stage is in, as a key only a real navigation changes. The held frame (`useHeldFrame`) bridges a
 * regeneration of the SAME drill: a package the drill re-anchored onto a renumbered station of a rebuilt map is the same
 * drill (its ref moved, see `drill.reanchored`), while out-then-enter to a sibling at the same depth is another one and must
 * never show the old package's frame.
 */

import { useLayoutEffect, useRef } from 'react';
import type { DrillFrame } from '../../surface/transit/drillView';

export function useDrillIdentity(stack: readonly DrillFrame[], moves: ReadonlyMap<string, string>): number {
    const last = useRef<{ stack: readonly DrillFrame[]; id: number }>({ stack, id: 0 });
    const prev = last.current;
    const same = prev.stack === stack || (prev.stack.length === stack.length
        && stack.every((f, i) => { const was = prev.stack[i]!; return was.level === f.level && (was.ref === f.ref || moves.get(was.ref) === f.ref); }));
    const id = same ? prev.id : prev.id + 1;
    // Committed after the render (never during it): a re-render before the commit derives the same identity.
    useLayoutEffect(() => { last.current = { stack, id }; });
    return id;
}
