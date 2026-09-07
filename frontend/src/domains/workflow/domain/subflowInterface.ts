/**
 * WHAT A CANVAS ACCEPTS AND WHAT IT RETURNS — derived, never declared twice.
 *
 * ── WHY DERIVED ──────────────────────────────────────────────────────────────
 * The tempting shape is a contract object on the child canvas: a card listing its
 * parameters and its returns, which the parent binds against. It is stable, it is
 * explicit, and it is wrong for the same reason `canvasFlowTarget.ts` refuses a
 * `framePurpose` marker — it is a SECOND statement of something the board already
 * makes. The moment somebody adds a step to the offboarding canvas, the declared
 * contract and the actual flow disagree, and the one that runs is the one nobody
 * was reading.
 *
 * So the interface is read off the board, from what the author already wrote:
 *
 *  · A PARAMETER is a `stepInputs` binding on a step that nothing upstream feeds.
 *    An unfed root is where the payload enters; what it declares it needs IS what
 *    the canvas needs handed to it.
 *
 *  · A RETURN is a `stepOutputs` binding no other step on the same board consumes.
 *    A variable a later step reads is internal plumbing; one nothing reads is the
 *    only thing the child could have published for somebody else.
 *
 * A canvas whose roots declare nothing still runs — it takes the parent's payload
 * whole — and {@link SubflowInterface.acceptsRawInput} is how the inspector says
 * so rather than showing an empty list that reads like a missing answer.
 *
 * Pure over the same plain shapes the compiler takes, so the inspector, the card
 * and the tests all ask one module.
 */

import { stepInputsOf, stepOutputsOf } from './flowStepObject';
import { isFlowStepObject } from './compileBoardFlow';
import type { SubflowBoard } from './subflow';

/** One named thing crossing the boundary, and the step that named it. */
export interface SubflowPort {
  key: string;
  /** The path the binding reads from, for the hint under the field. */
  from: string;
  /** The step that declared it, so an author can find it on the child board. */
  stepTitle: string;
}

export interface SubflowInterface {
  /** What the parent should hand over, by name. */
  inputs: SubflowPort[];
  /** What the child publishes that nothing inside it reads. */
  outputs: SubflowPort[];
  /**
   * True when at least one entry step declares no inputs — it consumes whatever
   * arrives, so the parent's payload is passed through untouched.
   */
  acceptsRawInput: boolean;
  /** How many steps the child board actually holds. Zero = nothing to nest. */
  stepCount: number;
}

function title(data: Record<string, unknown>): string {
  return typeof data.title === 'string' && data.title.trim() ? data.title.trim() : '';
}

/**
 * Whether a binding path reads this variable.
 *
 * Only the FIRST path segment counts: `settlement.amount` and `settlement[0]` both
 * consume `settlement`, while `settlement_note` consumes something else entirely.
 * Getting that wrong in the permissive direction would hide a real return; getting
 * it wrong in the strict direction would advertise plumbing as an output.
 */
function referencesKey(from: string, key: string): boolean {
  const head = from.trim().split(/[.[]/, 1)[0]?.trim() ?? '';
  return head !== '' && head === key;
}

/**
 * The interface of one child board.
 *
 * Takes the board rather than a session id: this is a pure projection, and the
 * module that knows how to FETCH a canvas is deliberately somewhere else.
 */
export function subflowInterface(board: Pick<SubflowBoard, 'objects' | 'connections'>): SubflowInterface {
  const steps = board.objects.filter((object) => isFlowStepObject(object.data));
  const stepIds = new Set(steps.map((step) => step.id));

  // Only step-to-step connections count as "fed". A step wired to the dataset it
  // reads is documentation of where the data came from — the same distinction the
  // compiler draws when it skips a connection to a non-step.
  const fed = new Set(
    board.connections
      .filter((connection) => stepIds.has(connection.source) && stepIds.has(connection.target))
      .map((connection) => connection.target),
  );

  const roots = steps.filter((step) => !fed.has(step.id));
  const inputs: SubflowPort[] = [];
  let acceptsRawInput = false;
  for (const root of roots) {
    const declared = stepInputsOf(root.data);
    if (declared.length === 0) { acceptsRawInput = true; continue; }
    for (const binding of declared) {
      if (!inputs.some((port) => port.key === binding.key)) {
        inputs.push({ key: binding.key, from: binding.from, stepTitle: title(root.data) });
      }
    }
  }

  const consumed = steps.flatMap((step) => stepInputsOf(step.data).map((binding) => binding.from));
  const outputs: SubflowPort[] = [];
  for (const step of steps) {
    for (const published of stepOutputsOf(step.data)) {
      if (consumed.some((from) => referencesKey(from, published.key))) continue;
      if (outputs.some((port) => port.key === published.key)) continue;
      outputs.push({ key: published.key, from: published.from, stepTitle: title(step.data) });
    }
  }

  return { inputs, outputs, acceptsRawInput, stepCount: steps.length };
}
