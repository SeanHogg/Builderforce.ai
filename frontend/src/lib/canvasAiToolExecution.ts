import type { BrainAction, BrainToolSpec } from '@seanhogg/builderforce-brain-embedded';
import { NON_AUTHORING_TOOL_NAMES } from '@/lib/canvasTurnOutcome';
import { toolErrorMessage } from '@/lib/toolErrorMessage';

/**
 * How ONE tool call on a Creation Canvas turn is gated and run. Split out of
 * `creationCanvasAi.ts`: the runner tracks what the call did to the turn (canvas
 * changed, build armed, last error, trace); this module only decides whether the call
 * may run and returns its outcome. A refusal is an `{ error }` outcome the model reads,
 * never a throw.
 */

/** Approval callback for a mutating tenant (non-canvas) tool. */
export type CanvasConfirmAction = (request: { name: string; args: unknown }) => Promise<boolean>;

/** The turn's gating state at the moment a call arrives. */
export interface CanvasToolGate {
  /** The reserved authoring phase is armed: research and board re-reads are withdrawn. */
  authoringOnly: boolean;
  /** `builtin_web_search` already returned `MAX_NARROW_SEARCHES` encyclopedic results. */
  searchesExhausted: boolean;
  /** Mutating tenant tools run without an in-app confirmation. */
  autoApprove: boolean;
  /** In-app approval; absent, mutating tenant tools are refused. */
  confirmAction: CanvasConfirmAction | undefined;
}

export function specsFor(actions: BrainAction[]): BrainToolSpec[] {
  return actions.map((action) => ({
    type: 'function',
    function: { name: action.name, description: action.description, parameters: action.parameters },
  }));
}

function mutates(action: BrainAction, args: unknown): boolean {
  if (typeof action.mutates === 'function') {
    try { return !!action.mutates(args); } catch { return true; }
  }
  return !!action.mutates;
}

async function runAction(action: BrainAction, args: unknown): Promise<unknown> {
  try { return await action.run(args); } catch (error) { return { error: toolErrorMessage(error, 'Tool failed') }; }
}

/** Gate and run one parsed tool call, returning the outcome the model receives. */
export async function executeCanvasTool(
  name: string,
  action: BrainAction | undefined,
  args: unknown,
  gate: CanvasToolGate,
): Promise<unknown> {
  if (gate.authoringOnly && NON_AUTHORING_TOOL_NAMES.has(name)) {
    return { error: 'The bounded research phase has ended. Create the requested Canvas artifacts from the evidence already gathered and the board snapshot you already have.' };
  }
  if (name === 'builtin_web_search' && gate.searchesExhausted) {
    return { error: 'Search stopped after two encyclopedic results. Fetch a known official URL directly or create the requested Canvas artifacts with the evidence already gathered.' };
  }
  if (!action) return { error: `Unknown tool: ${name}` };
  if (!name.startsWith('canvas_') && mutates(action, args) && !gate.autoApprove) {
    const approved = gate.confirmAction ? await gate.confirmAction({ name, args }) : false;
    if (!approved) return { error: gate.confirmAction ? 'The user declined this tenant mutation.' : 'This tenant mutation requires in-app approval.' };
  }
  return runAction(action, args);
}
