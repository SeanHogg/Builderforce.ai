/**
 * The figure vocabulary — its types, its palette and its parser.
 *
 * Split out of `BlogFigure.tsx` when the ninth kind landed: one file holding
 * the union, every renderer and the dispatcher had become the file anybody
 * adding a figure has to edit. Now a kind is a spec here, a component beside
 * this file and one line in `registry.tsx` — three small edits instead of one
 * growing switch.
 *
 * Figures are DATA inside a markdown file. Nothing here renders markup a post
 * supplied, because the shared markdown pipeline deliberately has no
 * `rehype-raw` — see the header of `BlogFigure.tsx` for that argument in full.
 */

/** Hues a figure may name. An allow-list rather than a free string: an
 *  undeclared custom property drops the declaration that uses it, silently and
 *  in both themes, and a typo in a markdown file is exactly the place nobody
 *  would look for a missing colour. */
export const HUES = {
  idea: 'var(--stage-idea)',
  make: 'var(--stage-make)',
  run: 'var(--stage-run)',
  measure: 'var(--stage-measure)',
  growth: 'var(--stage-growth)',
  expand: 'var(--stage-expand)',
  read: 'var(--stage-read)',
  prove: 'var(--stage-prove)',
  build: 'var(--stage-buildWith)',
  accent: 'var(--coral-bright)',
  good: 'var(--success)',
  bad: 'var(--danger)',
  muted: 'var(--text-muted)',
} as const;

export type FigureHue = keyof typeof HUES;

export const hueOf = (hue?: string): string => HUES[(hue ?? 'accent') as FigureHue] ?? HUES.accent;

export interface FigureBase {
  title?: string;
  caption?: string;
}

/** A sequence — Read → Prove → Build, or any ordered set of acts. */
export interface FlowFigure extends FigureBase {
  kind: 'flow';
  steps: Array<{ label: string; note?: string; hue?: FigureHue; tag?: string }>;
}

/** A trade-off on two axes. `dx`/`dy` nudge a LABEL, never its point — two
 *  proofs genuinely sit on the same coordinates and the author, not a collision
 *  heuristic, decides which way each name leans. */
export interface MatrixFigure extends FigureBase {
  kind: 'matrix';
  xLabel: string;
  yLabel: string;
  /** Axis extent. Both axes share it; the product's own meters are 1–5. */
  max?: number;
  points: Array<{ label: string; x: number; y: number; hue?: FigureHue; dx?: number; dy?: number }>;
}

/** A ladder — stages of an arc, each with a question. */
export interface StackFigure extends FigureBase {
  kind: 'stack';
  bands: Array<{ label: string; note?: string; hue?: FigureHue; tag?: string }>;
}

/** A ranking with a value track. */
export interface BarsFigure extends FigureBase {
  kind: 'bars';
  max?: number;
  rows: Array<{ label: string; value: number; note?: string; hue?: FigureHue }>;
}

/** A contrast — what people do, against what the method does. */
export interface CompareFigure extends FigureBase {
  kind: 'compare';
  columns: Array<{ title: string; hue?: FigureHue; items: string[] }>;
}

/**
 * A picture of an interface — named regions on a frame.
 *
 * The kind that exists because a capability with a SHAPE cannot be argued in a
 * bulleted list: where the board is, what floats over it, which band was
 * removed, which pane holds the run. Coordinates are percentages of the frame
 * (0–100 across, 0–100 down) so a region is authored the way it is described —
 * "the bar sits across the bottom eighth" — and the drawing scales with the
 * column instead of needing a breakpoint.
 *
 * Deliberately NOT a screenshot: a screenshot is stale the day the product
 * moves, carries whatever data was on screen when it was taken, and is one flat
 * image in two themes. This draws from tokens and stays legible in both.
 */
export interface ScreenFigure extends FigureBase {
  kind: 'screen';
  /** Drawn in the frame's title bar — what this screen IS. */
  frame?: string;
  /** Aspect ratio of the frame, width ÷ height. Defaults to 16:10. */
  ratio?: number;
  regions: Array<{
    label: string;
    /** Percentages of the frame. */
    x: number;
    y: number;
    w: number;
    h: number;
    note?: string;
    hue?: FigureHue;
    /** `ghost` is a region that is GONE or proposed — dashed, unfilled. */
    style?: 'solid' | 'ghost';
  }>;
}

/**
 * Frames at real widths, drawn to scale against each other.
 *
 * For the capabilities whose whole point is a MEASUREMENT — three device
 * readings that are actually 1280, 834 and 390 CSS pixels rather than three
 * labels on the same box. The frames are scaled off the widest entry, so the
 * figure cannot claim a difference the numbers do not have.
 */
export interface DevicesFigure extends FigureBase {
  kind: 'devices';
  devices: Array<{ label: string; width: number; height?: number; note?: string; hue?: FigureHue }>;
}

/**
 * Résumé templates, drawn from the registry the editor reads.
 *
 * The ported hired.video posts carried `previewTemplateIds` and rendered a
 * scaled card per template; the port dropped them because there was no fence
 * for a figure that resolves an ID against a registry rather than carrying its
 * own data. This is that fence. It stays DATA — the post names ids, the
 * renderer owns every pixel — so it does not reopen the raw-HTML hole the whole
 * figure vocabulary exists to keep shut.
 */
export interface TemplatesFigure extends FigureBase {
  kind: 'templates';
  templateIds: string[];
}

/**
 * A deep link into a Studio project the post is teaching. `href` is validated
 * as site-relative for the same reason the pipeline has no `rehype-raw`: a
 * figure is authored content, and an absolute href in authored content is an
 * open redirect waiting to be pasted into a shared canvas note.
 */
export interface LaunchFigure extends FigureBase {
  kind: 'launch';
  links: Array<{ label: string; href: string; note?: string; hue?: FigureHue }>;
}

export type FigureSpec =
  | FlowFigure
  | MatrixFigure
  | StackFigure
  | BarsFigure
  | CompareFigure
  | ScreenFigure
  | DevicesFigure
  | TemplatesFigure
  | LaunchFigure;

/** Parse a fenced block's body. A malformed figure returns null and the caller
 *  falls back to rendering the block as code — a post with a typo shows its
 *  source rather than a blank space where an argument used to be. */
export function parseFigure(source: string): FigureSpec | null {
  try {
    const parsed = JSON.parse(source) as FigureSpec;
    if (!parsed || typeof parsed !== 'object' || !('kind' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
