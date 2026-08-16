/**
 * How much of an object a card draws — the board's third reading, after WHICH surface and
 * WHAT is on it.
 *
 * ── WHY A BOARD NEEDS THIS ───────────────────────────────────────────────────────
 * Every card on this canvas drew its full body, always. That is right for the two or
 * three objects somebody is working on and wrong for the twenty behind them: a business
 * plan renders four hundred words, a website renders its pages, a dashboard renders its
 * charts — and a board of fifteen such cards is a wall of documents with the SHAPE of the
 * work invisible underneath it. Zooming out does not help, because the cards shrink with
 * the graph and the text becomes a grey texture rather than a diagram.
 *
 * So density is a per-object choice with three values, and the smallest of them is what
 * turns a board into a graph you can read:
 *
 *   `expanded`  — the full body. What every card did, and still the default.
 *   `preview`   — header, plus a clamped few lines of body. Enough to recognise the
 *                 object without it claiming a screen.
 *   `minimized` — an ORB: the object's mark, its name underneath, its badges and its
 *                 connectors. No body at all.
 *
 * ── WHY IT LIVES ON THE NODE ─────────────────────────────────────────────────────
 * On the object's own data, beside its position and its size, and persisted with them —
 * NOT in a per-viewer preference store. Density is a layout fact about the board, and
 * position and size are already shared facts about the board; splitting one of the three
 * into a private preference would mean two people looking at "the same" board seeing
 * different graphs, and one of them tidying it for the other with no effect.
 *
 * The default is `expanded` and is DERIVED rather than written, so an object authored by
 * Brain, imported from a template or created before this existed reads correctly without
 * a migration.
 */

export const CANVAS_NODE_DENSITIES = ['minimized', 'preview', 'expanded'] as const;

export type CanvasNodeDensity = (typeof CANVAS_NODE_DENSITIES)[number];

export const DEFAULT_CANVAS_NODE_DENSITY: CanvasNodeDensity = 'expanded';

function isDensity(value: unknown): value is CanvasNodeDensity {
  return typeof value === 'string' && (CANVAS_NODE_DENSITIES as readonly string[]).includes(value);
}

/**
 * The density this object is drawn at. Anything unrecognised reads as the default rather
 * than throwing: node data is authored by models and by templates as well as by people,
 * and a board that fails to render because one card carries a typo is worse than a board
 * with one card too big.
 */
export function canvasNodeDensity(data: { readonly [key: string]: unknown }): CanvasNodeDensity {
  return isDensity(data.density) ? data.density : DEFAULT_CANVAS_NODE_DENSITY;
}

/**
 * The next density when the card's own toggle is pressed.
 *
 * Expanded → preview → minimized → expanded. It shrinks first because that is the
 * direction somebody presses it in: you reach for this control when a card is in the way,
 * and a toggle whose first press makes it bigger is a toggle pressed once and abandoned.
 */
export function nextCanvasNodeDensity(current: CanvasNodeDensity): CanvasNodeDensity {
  if (current === 'expanded') return 'preview';
  if (current === 'preview') return 'minimized';
  return 'expanded';
}

/** Catalog key under `creationCanvas.density` naming what the NEXT press does. */
export function canvasNodeDensityActionKey(current: CanvasNodeDensity): string {
  return `to${nextCanvasNodeDensity(current)[0].toUpperCase()}${nextCanvasNodeDensity(current).slice(1)}`;
}
