/**
 * THE connector's LOOK, kept apart from its MEANING.
 *
 * ── THE DISTINCTION THIS MODULE EXISTS TO HOLD ──────────────────────────────────
 * `CREATION_CONNECTION_KINDS` says what an edge MEANS — a value moves, a step triggers,
 * one task blocks another, a test verifies a requirement. Those are semantics the board
 * computes over: the critical path is a fold over `blocks`, coverage is a fold over
 * `verifies`. They must never be chosen for how they look.
 *
 * A person drawing a diagram needs the other axis, and the board had none of it: every
 * edge was a smoothstep line with a closed arrow, so a dependency, an annotation and a
 * two-way sync were the same stroke. That is the "no arrow styling" half of the roadmap's
 * freeform-primitives entry, and folding it into the kind list would have been the worst
 * possible fix — a dashed line is not a kind of relationship, and adding `dashed` beside
 * `blocks` would put a rendering choice into the vocabulary the critical path is computed
 * from.
 *
 * So: kind is semantics, style is appearance, they are stored side by side, and neither
 * is derived from the other.
 *
 * ── WHY THE VALUES ARE CLOSED ───────────────────────────────────────────────────
 * Three small closed sets rather than free CSS. Every value maps to something React Flow
 * can actually draw, so a stored style always renders; a free `strokeDasharray` string
 * would let a board hold a value the renderer silently drops, which is the same silent
 * degradation `STENCIL_SHAPES` is a single list to prevent.
 */

import { MarkerType, type Edge, type EdgeMarker } from '@xyflow/react';

/** How the stroke is drawn. */
export const CONNECTION_LINES = ['solid', 'dashed', 'dotted'] as const;
export type ConnectionLine = typeof CONNECTION_LINES[number];

/**
 * What sits on the ends.
 *
 * `open` and `arrow` are a real distinction rather than a flourish: on a dense diagram a
 * filled head reads as a directed dependency and an open one as a reference, which is the
 * convention every notation from UML to a flowchart already uses. `both` is what a
 * two-way sync needs and what nothing on this board could previously draw.
 */
export const CONNECTION_ENDS = ['arrow', 'open', 'both', 'none'] as const;
export type ConnectionEnds = typeof CONNECTION_ENDS[number];

/**
 * How the line gets there.
 *
 * The four React Flow already routes. `elbow` is `step`'s name in every diagramming tool
 * a person has used before this one, so the LABEL says elbow and the value stays React
 * Flow's own — translating at the boundary is what this codebase refuses to do for shape
 * names, and the same argument holds here.
 */
export const CONNECTION_ROUTERS = ['smoothstep', 'step', 'straight', 'bezier'] as const;
export type ConnectionRouter = typeof CONNECTION_ROUTERS[number];

export interface ConnectionStyle {
  line: ConnectionLine;
  ends: ConnectionEnds;
  router: ConnectionRouter;
}

/** What every edge drawn before this module existed looked like. Keeping the default
 *  identical to the old hard-coded appearance is what stops this feature silently
 *  restyling every board that already exists. */
export const DEFAULT_CONNECTION_STYLE: ConnectionStyle = { line: 'solid', ends: 'arrow', router: 'smoothstep' };

const has = <T extends string>(set: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (set as readonly string[]).includes(value);

/** Read a stored style back, falling back per FIELD rather than per object: a board
 *  holding `{ line: 'dashed', ends: 'nonsense' }` keeps the dashes. */
export function readConnectionStyle(raw: unknown): ConnectionStyle {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Partial<ConnectionStyle>;
  return {
    line: has(CONNECTION_LINES, row.line) ? row.line : DEFAULT_CONNECTION_STYLE.line,
    ends: has(CONNECTION_ENDS, row.ends) ? row.ends : DEFAULT_CONNECTION_STYLE.ends,
    router: has(CONNECTION_ROUTERS, row.router) ? row.router : DEFAULT_CONNECTION_STYLE.router,
  };
}

/** Dashes, in the stroke's own units so the pattern holds at every zoom. */
const DASH: Record<ConnectionLine, string | undefined> = {
  solid: undefined,
  dashed: '8 5',
  dotted: '1 5',
};

const closed: EdgeMarker = { type: MarkerType.ArrowClosed, width: 16, height: 16 };
const open: EdgeMarker = { type: MarkerType.Arrow, width: 18, height: 18 };

/**
 * The React Flow props one style produces.
 *
 * ONE translation, used when an edge is created, when a selection is restyled and when a
 * saved board is read back. Three call sites computing this themselves is three edges
 * that can look different while claiming the same style — and the third one is the
 * reload, so the difference would only ever be noticed by somebody reopening their work.
 */
export function edgeVisuals(style: ConnectionStyle): Pick<Edge, 'type' | 'style' | 'markerEnd' | 'markerStart'> {
  const dash = DASH[style.line];
  return {
    // React Flow spells its bezier router `default`; every other value is its own name.
    type: style.router === 'bezier' ? 'default' : style.router,
    style: {
      stroke: 'var(--canvas-edge)',
      strokeWidth: 1.5,
      ...(dash ? { strokeDasharray: dash } : {}),
    },
    ...(style.ends === 'none' ? {} : { markerEnd: style.ends === 'open' ? open : closed }),
    ...(style.ends === 'both' ? { markerStart: closed } : {}),
  };
}

/** The style an existing edge is carrying, for the control that shows what is selected. */
export function connectionStyleOf(edge: Pick<Edge, 'data'>): ConnectionStyle {
  return readConnectionStyle((edge.data as { connectionStyle?: unknown } | undefined)?.connectionStyle);
}
