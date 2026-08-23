import { frameMemberIds } from '@/domains/canvas/domain/canvasFrame';
import { toFrameBox } from './useFramedBoard';
import type { CreationFlowNode } from './CreationNode';

/**
 * WHAT "RUN" ACTS ON — one predicate, for every control that offers to run this board.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * The board used to carry a `workflow` CARD: one object holding a list of steps, with
 * its own Run button drawn on it. Then the card became the thing it always stood for —
 * `expandTemplateWorkflows` unpacks it into a `frame` bounding real `flowStep` objects,
 * because the board IS the workflow and a card listing steps was a picture of one.
 *
 * The unpack shipped ahead of the controls, and this is the seam that was missing.
 * `resolveWorkflowNode` recognised a frame ONLY once it carried `resourceId:
 * 'workflow:…'` — the id a COMPILE writes. So a freshly seeded section had no run
 * target, Run could not find it, and the "build it first" path inside `runWorkflow`
 * (its own comment describes it: "A draft that has never been built has nothing to
 * run. It is BUILT first") was unreachable for the only shape the board now produces.
 * A section you could see, could edit, and could never run.
 *
 * ── WHY MEMBERSHIP AND NOT A MARKER FIELD ────────────────────────────────────────
 * The tempting shortcut is a flag on the frame — `framePurpose`, or an `isFlow` boolean
 * written at unpack time. Both are a second source of truth about something the board
 * already states: `framePurpose` is free text a person edits (and is localized), and a
 * flag set at creation is wrong the moment somebody drags a step out of the section or
 * groups three steps into a new one by hand. What makes a frame a flow is that it HOLDS
 * STEPS, so that is what is asked, through the same containment the board draws with.
 */

/** A frame that bounds at least one `flowStep`, or already links a compiled definition. */
function framesAFlow(node: CreationFlowNode, nodes: readonly CreationFlowNode[]): boolean {
  if (node.data.kind !== 'frame') return false;
  // A compiled section stays runnable even if its steps were moved out from under it:
  // the definition exists on the server and this object is what points at it.
  if (typeof node.data.resourceId === 'string' && node.data.resourceId.startsWith('workflow:')) return true;
  const boxes = nodes.map(toFrameBox);
  const members = new Set(frameMemberIds(node.id, boxes));
  return nodes.some((candidate) => members.has(candidate.id) && candidate.data.kind === 'flowStep');
}

/**
 * Is this object the flow on this board?
 *
 * `workflow` is the legacy card, still honoured because boards saved before the unpack
 * still hold one — a migration that stops old work running is not a migration.
 */
export function isCanvasFlowNode(node: CreationFlowNode, nodes: readonly CreationFlowNode[]): boolean {
  return node.data.kind === 'workflow' || framesAFlow(node, nodes);
}

/**
 * Which flow an action applies to: the one named, else the selection, else the only one
 * on the board.
 *
 * The same order for Run, for Build, and for deciding whether to OFFER Run at all — so
 * the button cannot be shown for one object and then act on another.
 */
export function resolveCanvasFlowNode(
  nodes: readonly CreationFlowNode[],
  { preferredId, selected }: { preferredId?: string; selected?: CreationFlowNode | null } = {},
): CreationFlowNode | null {
  const runnable = (node: CreationFlowNode) => isCanvasFlowNode(node, nodes);
  const requested = typeof preferredId === 'string'
    ? nodes.find((node) => node.id === preferredId && runnable(node))
    : null;
  if (requested) return requested;
  if (selected && runnable(selected)) return selected;
  return nodes.find(runnable) ?? null;
}
