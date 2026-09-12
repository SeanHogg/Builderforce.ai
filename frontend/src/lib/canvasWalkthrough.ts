import { graphLayerRanks } from '@/lib/canvas/canvasGraph';
import type { CreationObjectKind } from '@builderforce/creation-canvas-contract';

/**
 * "IT MADE ME TWENTY-FOUR THINGS AND I DO NOT KNOW WHERE TO START."
 *
 * ── THE GAP ──────────────────────────────────────────────────────────────────
 * A generated board is the product working. It is also, for the person who asked
 * one question and got twenty-four objects back, a wall. The canvas already had
 * a tour — of its own CHROME: here is the Brain dock, here is the palette, here
 * is Share. That teaches the tool and says nothing about the work, which is the
 * half somebody who just generated a competitive landscape actually needs.
 *
 * So this derives a walkthrough of the ARTIFACTS: what you were given, in the
 * order the board itself says to read it, with the one action each group is
 * waiting for.
 *
 * ── WHY IT GROUPS BY KIND ────────────────────────────────────────────────────
 * One stop per object is the same wall with a Next button on it. The board that
 * prompted this held six competitors, two customer segments, a GTM plan, a
 * pricing model, a map and five agents — nine things worth saying, not
 * twenty-four. A kind IS the unit of meaning here: six `competitor` objects are
 * one answer ("here is who you are up against"), and reading them one at a time
 * tells you less than seeing that they are a set.
 *
 * ── WHY THE ORDER COMES FROM THE GRAPH ───────────────────────────────────────
 * The board knows what feeds what — that is what its connections are — so the
 * walkthrough follows dependency order and falls back to reading order (top
 * row first, left to right) on a board with no connections. A hand-written
 * running order over a hundred-odd object kinds would be a second registry to
 * keep in step with the first, and wrong the first time somebody added a kind.
 *
 * Pure, so the order and the grouping are unit-testable without mounting a
 * canvas; the copy and the pan-and-zoom live in `CanvasWalkthrough`.
 */

/** What a walkthrough needs to know about a board object. `CreationFlowNode` satisfies it. */
export interface CanvasWalkthroughObject {
  id: string;
  position: { x: number; y: number };
  hidden?: boolean;
  data: {
    kind: CreationObjectKind;
    title?: string;
    subtitle?: string;
    status?: string;
    placementHidden?: boolean;
  };
}

/** A connection, on the terms `graphLayerRanks` reads them. */
export interface CanvasWalkthroughLink { source: string; target: string }

export interface CanvasWalkthroughStop {
  /** Stable across re-derivations of the same board, so a step index means one thing. */
  id: string;
  kind: CreationObjectKind;
  /** Everything this stop speaks for, in reading order. */
  objectIds: readonly string[];
  /** The one the viewport lands on and the copy names. */
  focusObjectId: string;
  leadTitle: string;
  /** The lead object's own authored line, when it has one. Never invented here. */
  summary: string;
  count: number;
  /**
   * How many further KINDS this stop absorbed because the walkthrough was full.
   * Zero on every stop but (possibly) the last — see `MAX_WALKTHROUGH_STOPS`.
   */
  overflowKinds: number;
}

/**
 * Objects that are not artifacts and must not be walked.
 *
 * `chat` is the conversation that produced the board rather than a thing it
 * produced, and the chrome tour already introduces the Brain dock. `frame` is a
 * container — walking to one lands the viewport on a rectangle whose contents
 * are the stops either side of it.
 */
const NOT_AN_ARTIFACT = new Set<CreationObjectKind>(['chat', 'frame']);

/**
 * The most stops a walkthrough offers.
 *
 * Eight is where "let me show you round" stops being a favour. Anything past it
 * is absorbed into the final stop, which says how much it stands for rather than
 * dropping it silently — a walkthrough that quietly omits half the board would
 * be a worse version of the problem it is here to solve.
 */
export const MAX_WALKTHROUGH_STOPS = 8;

/**
 * Below this there is nothing to be lost in, and an offer to guide somebody
 * round three cards reads as the product not trusting them.
 */
export const MIN_WALKTHROUGH_OBJECTS = 4;

function readingOrder(a: CanvasWalkthroughObject, b: CanvasWalkthroughObject): number {
  // A row at a time: anything within a card's height of the same top edge is the
  // same row, and rows read left to right. Comparing raw `y` first would order a
  // tidy row by whichever card sits a pixel higher.
  const row = Math.floor(a.position.y / 240) - Math.floor(b.position.y / 240);
  return row || a.position.x - b.position.x || a.id.localeCompare(b.id);
}

/** The artifacts on this board, in the order somebody should be shown them. */
export function canvasWalkthroughStops(
  nodes: readonly CanvasWalkthroughObject[],
  links: readonly CanvasWalkthroughLink[] = [],
  options: { maxStops?: number } = {},
): CanvasWalkthroughStop[] {
  const artifacts = nodes.filter((node) => (
    node.hidden !== true
    && node.data.placementHidden !== true
    && !NOT_AN_ARTIFACT.has(node.data.kind)
  ));
  if (artifacts.length < MIN_WALKTHROUGH_OBJECTS) return [];

  const { ranks } = graphLayerRanks(
    artifacts.map((node) => ({ id: node.id, position: node.position })),
    links.map((link) => ({ source: link.source, target: link.target })),
  );

  const byKind = new Map<CreationObjectKind, CanvasWalkthroughObject[]>();
  for (const node of artifacts) {
    byKind.set(node.data.kind, [...(byKind.get(node.data.kind) ?? []), node]);
  }

  const groups = [...byKind.entries()].map(([kind, members]) => {
    const ordered = [...members].sort(readingOrder);
    const lead = ordered[0]!;
    return {
      kind,
      ordered,
      lead,
      // The SHALLOWEST member: a group is reached as soon as any of it is, so a
      // set whose first member sits at the top of the graph leads the tour even
      // if a straggler hangs off the bottom of it.
      rank: Math.min(...ordered.map((node) => ranks.get(node.id) ?? 0)),
    };
  }).sort((a, b) => a.rank - b.rank || readingOrder(a.lead, b.lead));

  const maxStops = Math.max(1, options.maxStops ?? MAX_WALKTHROUGH_STOPS);
  const kept = groups.slice(0, maxStops);
  const overflow = groups.slice(maxStops);

  return kept.map((group, index) => {
    // The last kept stop speaks for whatever did not fit, so nothing is dropped
    // without being counted.
    const absorbs = index === kept.length - 1 ? overflow : [];
    const ordered = [...group.ordered, ...absorbs.flatMap((extra) => extra.ordered)];
    return {
      id: group.kind,
      kind: group.kind,
      objectIds: ordered.map((node) => node.id),
      focusObjectId: group.lead.id,
      leadTitle: (group.lead.data.title ?? '').trim(),
      summary: (group.lead.data.subtitle ?? group.lead.data.status ?? '').trim(),
      count: ordered.length,
      overflowKinds: absorbs.length,
    };
  });
}
