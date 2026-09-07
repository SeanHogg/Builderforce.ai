/**
 * A CANVAS, AS A STEP ON ANOTHER CANVAS.
 *
 * ── WHY COMPOSITION NEEDED A VOCABULARY AT ALL ───────────────────────────────
 * The canvas IS the workflow (`flowStepObject.ts`), which made every board a
 * closed system: the steps you could run were the steps you had drawn, on that
 * board, that day. So "offboard an employee" — a real sequence of revoke, final
 * payroll, asset return, notify — had to be redrawn inside every flow that needed
 * it, and the copy that was fixed was never the copy that ran.
 *
 * A `subflow` step is the missing sentence: THIS canvas, here, as one step. The
 * promotion flow says "then offboard the backfilled contractor" the same way it
 * says "then send the letter", and the offboarding lives in exactly one place —
 * its own canvas, with its own author, its own history and its own runs.
 *
 * ── ONE KIND, A VALUE, THE SAME RULE AS EVERY OTHER STEP ─────────────────────
 * There is no new CANVAS object kind for this. A nested canvas is a `flowStep`
 * whose `stepKind` is `subflow`, exactly as a switch is a `flowStep` whose
 * `stepKind` is `switch` — which is what keeps the palette, the node renderer and
 * the compiler from each growing a branch for it.
 *
 * ── THE TWO BINDINGS, AND WHY BOTH ARE REAL ──────────────────────────────────
 * `snapshot` (the default) INLINES the child's steps into the parent definition at
 * build time. One definition, one run, one timeline, and nothing new for the
 * executor to understand — the child is frozen into the parent exactly as it read
 * on the day it was built.
 *
 * `live` stores a reference to the child's OWN definition and resolves it when a
 * run is instantiated (`api/src/application/workflow/expandSubflows.ts`). Edit the
 * offboarding canvas, rebuild it there, and every parent flow that calls it runs
 * the new version without being rebuilt. The cost is the precondition: a live
 * child must have been built at least once, because a reference to a definition
 * that does not exist is a step that would succeed at nothing.
 *
 * Plain data and pure functions. No React, no transport, no canvas — the compiler,
 * the inspector and the card all read the same three fields from here rather than
 * each reaching into `stepConfig` with their own idea of what is in it.
 */

import type { WorkflowNodeKind } from '@/lib/builderforceApi';
import { FLOW_STEP_KIND, stepConfigOf, stepKindOf } from './flowStepObject';

/** The step kind a nested canvas is placed as. */
export const SUBFLOW_STEP_KIND = 'subflow' satisfies WorkflowNodeKind;

/** How a nested canvas reaches the run. See the header. */
export type SubflowBinding = 'snapshot' | 'live';

export const SUBFLOW_BINDINGS: readonly SubflowBinding[] = ['snapshot', 'live'];

/** How deep composition may go before it is a design problem rather than a graph. */
export const MAX_SUBFLOW_DEPTH = 5;

/**
 * One child canvas, as much of it as composition is allowed to know.
 *
 * Deliberately the SAME plain shapes the compiler already takes (`{id, position,
 * data}` / `{id, source, target, sourceHandle}`) rather than canvas objects or
 * React Flow nodes: the workflow domain must not learn the canvas's model to be
 * able to nest one, and the resolver that produces this can be a test fixture.
 */
export interface SubflowBoard {
  sessionId: string;
  /** What the child canvas is called, for the card and for an error that names it. */
  title: string;
  objects: ReadonlyArray<{ id: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  connections: ReadonlyArray<{ id: string; source: string; target: string; sourceHandle?: string | null }>;
  /**
   * The child's OWN built definition, when it has one — the `workflow:<id>`
   * resource a build writes onto the child's flow frame. Required by `live`
   * binding and ignored by `snapshot`.
   */
  definitionId: string | null;
}

/**
 * Reads a child canvas by session id, or null when it is not available.
 *
 * SYNCHRONOUS on purpose. The compiler is pure and runs on every build; making it
 * await a fetch would make the one thing that must be deterministic depend on the
 * network. The surface loads the boards it can see referenced and hands over a
 * resolver reading that cache — an unresolved child is a compile ISSUE naming the
 * canvas, not a build that silently omits a step.
 */
export type SubflowResolver = (sessionId: string) => SubflowBoard | null;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The canvas session this step nests, or '' when the author has not chosen one. */
export function subflowSessionId(config: Record<string, unknown>): string {
  return text(config.canvasSessionId);
}

/** How this step reaches its child. Unknown values resolve to the safe default. */
export function subflowBinding(config: Record<string, unknown>): SubflowBinding {
  return config.binding === 'live' ? 'live' : 'snapshot';
}

/** The child's name as the author last saw it — a label, never the source of truth. */
export function subflowCanvasTitle(config: Record<string, unknown>): string {
  return text(config.canvasTitle);
}

/** Whether a step of this kind nests a canvas. */
export function isSubflowKind(kind: WorkflowNodeKind): boolean {
  return kind === SUBFLOW_STEP_KIND;
}

/**
 * Which canvases a board reaches for, deduplicated.
 *
 * The surface has to have those boards IN MEMORY before the compiler runs, because
 * the compiler is synchronous on purpose. This is the one question it asks to know
 * what to load, and it is asked of the same plain objects the compiler takes, so
 * nothing has to mount to answer it.
 */
export function subflowSessionIdsOn(objects: ReadonlyArray<{ data: Record<string, unknown> }>): string[] {
  const ids = new Set<string>();
  for (const object of objects) {
    if (object.data.kind !== FLOW_STEP_KIND) continue;
    if (stepKindOf(object.data) !== SUBFLOW_STEP_KIND) continue;
    const id = subflowSessionId(stepConfigOf(object.data));
    if (id) ids.add(id);
  }
  return [...ids];
}
