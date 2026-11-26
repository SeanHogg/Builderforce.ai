/**
 * Where the station card sits: beside its station, flipped to the other side when it would leave the
 * container or cover something it must keep clear (the unfolded satellites), and never outside the
 * container. Pure; the card measures the rectangles.
 */

export interface Rect { left: number; top: number; width: number; height: number }

export const CARD_WIDTH = 270;
/** A height to plan with before the card has been measured. */
export const CARD_HEIGHT = 230;
const GAP = 10;

const meets = (a: Rect, b: Rect): boolean =>
    a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

export function placeCard(
    anchor: Rect,
    container: { width: number; height: number },
    card: { width: number; height: number } = { width: CARD_WIDTH, height: CARD_HEIGHT },
    avoid: readonly Rect[] = [],
): { left: number; top: number } {
    const top = Math.round(Math.max(0, Math.min(anchor.top + anchor.height / 2 - card.height / 2, container.height - card.height)));
    const right = anchor.left + anchor.width + GAP, left = anchor.left - GAP - card.width;
    // The sides that fit, the right first; then the first of them that keeps clear of what must stay visible.
    const fitting = [right + card.width <= container.width ? right : undefined, left >= 0 ? left : undefined].filter((x): x is number => x !== undefined);
    const clear = fitting.find((x) => !avoid.some((r) => meets({ left: x, top, width: card.width, height: card.height }, r)));
    const chosen = clear ?? fitting[0] ?? right;
    return { left: Math.round(Math.max(0, Math.min(chosen, container.width - card.width))), top };
}
