/**
 * HOW WIDE THE BOARD IS, AND HOW MANY COLUMNS THAT WIDTH ACTUALLY HOLDS.
 *
 * ── THE BUG THIS ENDS ────────────────────────────────────────────────────────
 * Every canvas laid its objects out as if the screen were one fixed size. Three
 * separate places asked `window.innerWidth <= 760` and did nothing else with the
 * measurement, and two more picked a column count from `Math.ceil(Math.sqrt(n))`
 * — a number that depends only on how many objects there are and not at all on
 * how much room they have. On a 3440px ultrawide that put twelve generated
 * artifacts into four columns and left a third of the screen empty; and because
 * `freeCanvasSlot` could only ever grow DOWNWARD, a batch of objects Brain
 * authored without coordinates landed in a single column running off the bottom
 * of the window regardless of how wide the screen was.
 *
 * So the measurement is a primitive now, and the two questions a layout actually
 * asks — "is this a stacking screen" and "how many of these fit across" — have
 * one answer each. `creationCanvasLayout.ts` (authoring and arranging on the
 * creation canvas) and `CanvasCommands.tsx` (the arrange command every canvas
 * shares) both read it, so a board cannot be width-aware in one of them.
 *
 * Pure and DOM-free apart from the one documented `window` fallback, so the
 * packing maths stays unit-testable without a viewport.
 */

/** At or below this screen width a board stacks its objects into one readable column. */
export const NARROW_CANVAS_WIDTH = 760;

/** What a board is assumed to span when nothing has measured it (SSR, a test, a headless call). */
export const DEFAULT_CANVAS_LAYOUT_WIDTH = 1_440;

/**
 * The most columns any automatic layout will produce.
 *
 * Not a width limit — an eye limit. Past about a dozen columns a row of cards
 * stops reading as a row and starts reading as noise, which is the same problem
 * as the single column this file exists to fix, mirrored.
 */
export const MAX_CANVAS_GRID_COLUMNS = 12;

/** The board width the packer refuses to go below, so a sliver of a window still lays out. */
const MIN_LAYOUT_WIDTH = 480;

/** Beyond this a "measurement" is a bug (a zoom of 0.001), not a very wide monitor. */
const MAX_LAYOUT_WIDTH = 12_000;

export interface CanvasLayoutViewport {
  /**
   * How far a row of cards may run before it wraps, in the board's OWN coordinates
   * — i.e. the visible board width divided by its zoom, not screen pixels. Objects
   * are positioned in flow space, so a budget in screen pixels would shrink the
   * layout every time somebody zoomed out.
   */
  width: number;
  /**
   * Whether this is a stacking SCREEN. Deliberately read from the window and not
   * from `width`: a wide board zoomed right in has a small flow-space width and is
   * still not a phone, and a phone must stack whatever its zoom happens to be.
   */
  narrow: boolean;
}

function measured(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The layout budget, from whatever the caller was able to measure.
 *
 * `boardWidth` is the board element's width in FLOW coordinates; `screenWidth` is
 * the window. Both fall back to `window.innerWidth`, and that to a wide default,
 * so a caller with no DOM still gets a sane board rather than a single column.
 */
export function canvasLayoutViewport(
  measurements: { boardWidth?: number; screenWidth?: number } = {},
): CanvasLayoutViewport {
  const screen = measured(measurements.screenWidth)
    ?? (typeof window === 'undefined' ? DEFAULT_CANVAS_LAYOUT_WIDTH : window.innerWidth);
  const board = measured(measurements.boardWidth) ?? screen;
  return {
    width: Math.max(MIN_LAYOUT_WIDTH, Math.min(board, MAX_LAYOUT_WIDTH)),
    narrow: screen <= NARROW_CANVAS_WIDTH,
  };
}

/**
 * How many columns of `columnWidth` fit across `available`, never more than there
 * are objects to put in them and never more than the eye limit.
 *
 * The width of the WIDEST card is the right column width to ask about, because
 * the grid sizes every column to the widest thing in it: fitting by an average
 * would produce a last column that hangs off the edge of the board.
 */
export function canvasGridColumns({
  available, columnWidth, gap, count, max = MAX_CANVAS_GRID_COLUMNS,
}: {
  available: number;
  columnWidth: number;
  gap: number;
  count: number;
  max?: number;
}): number {
  if (count <= 1) return Math.max(1, count);
  const width = Math.max(1, columnWidth);
  // `available + gap` because the last column carries no trailing gap.
  const fits = Math.floor((Math.max(width, available) + gap) / (width + gap));
  return Math.max(1, Math.min(fits, count, max));
}
