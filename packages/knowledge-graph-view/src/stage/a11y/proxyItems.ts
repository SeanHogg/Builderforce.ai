/**
 * Which a11y proxies exist after a settle (PRD 43 B5): the placement's Tab stops (`Placement.a11y`, in its reading
 * order) that are drawn ON SCREEN, at most {@link MAX_PROXIES}, each at its mark's projected centre. Two kinds of
 * off-screen stop are kept so the keyboard can still reach past the viewport, clamped to its edge: the next stop after
 * the last one shown (arrow onto it and the camera pans there), and every `keep` slot (the selection, the focused one).
 * Hidden slots (scale 0) are never a stop. Pure.
 */

import type { PickIndex } from '../pick';
import type { A11yItem } from '../types';

export const MAX_PROXIES = 200;
/** A proxy's box: the 40 px target picking uses. */
export const PROXY_SIZE = 40;

export interface ProxyItem extends A11yItem {
    x: number;
    y: number;
    /** Drawn outside the viewport: focusing it pans the camera to the slot. */
    offscreen: boolean;
}

export function proxyItems(
    a11y: readonly A11yItem[], index: Pick<PickIndex, 'screenOf' | 'onScreen'>, view: { width: number; height: number },
    keep: readonly number[] = [], cap = MAX_PROXIES,
): ProxyItem[] {
    const out: ProxyItem[] = [];
    const kept = new Set(keep.filter((s) => s >= 0));
    let shown = 0, next = false;
    const clampX = (x: number) => Math.max(PROXY_SIZE / 2, Math.min(view.width - PROXY_SIZE / 2, x));
    const clampY = (y: number) => Math.max(PROXY_SIZE / 2, Math.min(view.height - PROXY_SIZE / 2, y));
    for (const item of a11y) {
        const at = index.screenOf(item.slot);
        if (!at) continue;
        if (index.onScreen(item.slot) && shown < cap) {
            shown++;
            out.push({ ...item, x: at[0], y: at[1], offscreen: false });
            continue;
        }
        const keepIt = kept.has(item.slot);
        // The first stop that is not shown (off screen, or over the cap) is the keyboard's way on.
        const isNext = !next;
        if (!keepIt && !isNext) continue;
        if (isNext) next = true;
        out.push({ ...item, x: clampX(at[0]), y: clampY(at[1]), offscreen: !index.onScreen(item.slot) });
    }
    return out;
}
