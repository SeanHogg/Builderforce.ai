/**
 * The phase lens — which object kinds a phase brings FORWARD on the board.
 *
 * A phase is a way of reading the same board. In Measure the KPI and experiment cards
 * are the subject and the code cards are context; in Make it is the other way round. So
 * the board does not hide anything — it dims what the phase is not about and rings what
 * it is, and a selected card is always drawn at full strength (see the stylesheet).
 *
 * Data, not branches: a phase's kinds are a row here. A kind in no row is `out` in every
 * phase but never hidden. Frames are never dimmed — they are the board's structure, not
 * a subject of any phase. Every kind named here is checked against the object registry
 * by `canvasPhaseLens.test.tsx`, so a renamed kind fails a test instead of silently
 * dimming its cards forever.
 *
 * Pure: no React, no DOM.
 */
import type { CanvasPhase } from './canvasPhases';

export const PHASE_FOCUS_KINDS: Readonly<Record<CanvasPhase, readonly string[]>> = {
  idea: ['idea', 'customerInterview', 'experiment', 'form', 'risk', 'targetMarket', 'customerSegment', 'competitor'],
  make: ['prd', 'website', 'prototype', 'mockup', 'code', 'flowStep', 'workflow', 'build', 'repository'],
  run: ['deployment', 'release', 'productionIncident', 'ciRun', 'pullRequest', 'environment', 'service'],
  measure: ['kpi', 'dashboard', 'chart', 'metric', 'liveMetric', 'experiment', 'evaluation', 'objective', 'funnel'],
  reach: ['socialPost', 'emailCampaign', 'socialCampaign', 'socialFeed', 'audience', 'pitch', 'brandKit', 'gtmPlan', 'salesCampaign', 'emailTemplate', 'pricing'],
};

/** Structure, not subject — never dimmed by any phase. */
const NEVER_DIMMED: ReadonlySet<string> = new Set(['frame']);

const FOCUS_SETS: Readonly<Record<CanvasPhase, ReadonlySet<string>>> = {
  idea: new Set(PHASE_FOCUS_KINDS.idea),
  make: new Set(PHASE_FOCUS_KINDS.make),
  run: new Set(PHASE_FOCUS_KINDS.run),
  measure: new Set(PHASE_FOCUS_KINDS.measure),
  reach: new Set(PHASE_FOCUS_KINDS.reach),
};

export type PhaseFocus = 'in' | 'out';

/** How a kind reads under a phase, or null when the lens does not apply to it. */
export function phaseFocusOf(kind: string, phase: CanvasPhase): PhaseFocus | null {
  if (NEVER_DIMMED.has(kind)) return null;
  return FOCUS_SETS[phase].has(kind) ? 'in' : 'out';
}

/** The first kind a phase would add — what the ghost card's "Add …" creates. */
export function phaseFirstKind(phase: CanvasPhase): string {
  return PHASE_FOCUS_KINDS[phase][0]!;
}

export interface LensNode {
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
  width?: number;
  height?: number;
}

/**
 * The part of the board a card can be SEEN in, in FLOW coordinates: the pane minus the
 * floating chrome over it (the top chrome, the prompt and command bar, a docked Brain).
 */
export interface LensViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Same width a card is drawn at, for a node React Flow has not measured yet. */
export const GHOST_CARD_WIDTH = 260;
/** The ghost's own height, near enough to keep it clear of the chrome. */
export const GHOST_CARD_HEIGHT = 150;
/** A card's height before React Flow has measured it. */
const UNMEASURED_CARD_HEIGHT = 120;
/** Clear space between the board's edge and the ghost card. */
export const GHOST_CARD_GAP = 80;

type Point = { x: number; y: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Where the ghost card stands, in FLOW coordinates — the place the phase's first object
 * would go next, and somewhere the reader can SEE it. Tried in order, each pulled into
 * the clear area along the axis that does not touch the board:
 * - an empty board: the centre of the clear area;
 * - just right of everything on the board, top-aligned with it;
 * - just left of it;
 * - under it, left-aligned;
 * - above it.
 * Null when none fits: the ghost then stands down, and the path card above says the same
 * thing. A ghost half under the prompt or the Brain panel reads as a rendering bug.
 * A viewport with no measured size (no layout yet) places beside the board unchecked.
 */
export function ghostPosition(nodes: readonly LensNode[], clear: LensViewport): Point | null {
  const unmeasured = clear.width <= 0 || clear.height <= 0;
  const fits = (point: Point) => point.x >= clear.x && point.y >= clear.y
    && point.x + GHOST_CARD_WIDTH <= clear.x + clear.width && point.y + GHOST_CARD_HEIGHT <= clear.y + clear.height;
  const clampX = (x: number) => clamp(x, clear.x, clear.x + clear.width - GHOST_CARD_WIDTH);
  const clampY = (y: number) => clamp(y, clear.y, clear.y + clear.height - GHOST_CARD_HEIGHT);

  if (!nodes.length) {
    const centre = { x: clear.x + clear.width / 2 - GHOST_CARD_WIDTH / 2, y: clear.y + clear.height / 2 - GHOST_CARD_HEIGHT / 2 };
    return unmeasured || fits(centre) ? centre : null;
  }
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    const width = node.measured?.width ?? node.width ?? GHOST_CARD_WIDTH;
    const height = node.measured?.height ?? node.height ?? UNMEASURED_CARD_HEIGHT;
    left = Math.min(left, node.position.x);
    right = Math.max(right, node.position.x + width);
    top = Math.min(top, node.position.y);
    bottom = Math.max(bottom, node.position.y + height);
  }
  if (unmeasured) return { x: right + GHOST_CARD_GAP, y: top };
  const candidates: Point[] = [
    { x: right + GHOST_CARD_GAP, y: clampY(top) },
    { x: left - GHOST_CARD_GAP - GHOST_CARD_WIDTH, y: clampY(top) },
    { x: clampX(left), y: bottom + GHOST_CARD_GAP },
    { x: clampX(left), y: top - GHOST_CARD_GAP - GHOST_CARD_HEIGHT },
  ];
  return candidates.find(fits) ?? null;
}
