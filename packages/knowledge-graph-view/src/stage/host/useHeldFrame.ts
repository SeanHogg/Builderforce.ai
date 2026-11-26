/**
 * The stage's last READY frame, held while a regenerated one is computing. A live or growth repaint gives the graph a
 * new generation: its MarkSet is dropped at once (`keep: false`) and its placement lands a moment later, so without a
 * hold the stage would unmount or show the "laying out" state on every refresh. The frame is the PAIR that matched
 * (marks + placement of one generation, with the paint beside them), kept whole: held marks are never shown with a new
 * placement or the reverse, so picking and selection keep mapping onto what is on screen.
 *
 * A frame is held only for the key it was ready on (root, camera, drill level): a camera switch, another root or a
 * drill step must show the new level, never the old one, so a different key returns nothing until its own frame is ready.
 */

import { useLayoutEffect, useRef } from 'react';

/**
 * `live` is the frame being computed, or null while it is not ready (marks and placement of ONE generation). Returns the
 * live frame once ready, else the last ready frame of the same `key`, else null.
 */
export function useHeldFrame<T>(key: string, live: T | null): T | null {
    const held = useRef<{ key: string; frame: T } | null>(null);
    // Written after the commit (never during render), read by the next render: what is held is what the last commit showed.
    useLayoutEffect(() => {
        if (live) held.current = { key, frame: live };
        else if (held.current && held.current.key !== key) held.current = null;
    });
    return live ?? (held.current && held.current.key === key ? held.current.frame : null);
}
