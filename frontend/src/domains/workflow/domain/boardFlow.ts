/**
 * THE SHAPES A BOARD IS COMPILED FROM AND INTO.
 *
 * Two vocabularies, and deliberately neither of them anybody else's. The INPUT
 * shapes (`BoardFlowObject`, `BoardFlowConnection`) are as much of a canvas as the
 * compiler is allowed to know: plain `{id, position, data}`, not React Flow nodes
 * and not canvas objects, so the canvas domain and this one stay uncoupled and the
 * whole lowering is unit-testable without mounting a board. The OUTPUT shapes are
 * isomorphic to the API's `WorkflowDefNode`/`WorkflowDefEdge` without importing
 * them, which is the same anti-corruption boundary in the other direction.
 *
 * They live here rather than beside the compiler because composition made them
 * shared: `compileBoardFlow.ts` produces them, `subflowLowering.ts` produces them
 * for a nested canvas, and `subflowInterface.ts` reads them. A type owned by one of
 * three peers is how a cycle starts.
 */

import type { WorkflowNodeKind } from '@/lib/builderforceApi';
import { FLOW_STEP_KIND } from './flowStepObject';
import type { SubflowResolver } from './subflow';

/** One board object, as much of it as the compiler is allowed to know. */
export interface BoardFlowObject {
  id: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

/** One board connection. `sourceHandle` is the outlet it leaves from. */
export interface BoardFlowConnection {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

/** The compiled node shape, isomorphic to the API's `WorkflowDefNode`. */
export interface CompiledFlowNode {
  id: string;
  kind: WorkflowNodeKind;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

/** The compiled edge shape, isomorphic to the API's `WorkflowDefEdge`. */
export interface CompiledFlowEdge {
  id: string;
  source: string;
  target: string;
  /** The outlet this edge leaves from. The executor prunes an arm whose label
   *  does not match the outlet the step actually took. */
  label?: string;
}

/** Why one step could not be compiled, in the author's terms. */
export interface BoardFlowIssue {
  /** The board object the message points at, so the canvas can select it. */
  objectId: string;
  title: string;
  /** A message key in `creationCanvas.flowIssue`, plus its values. */
  messageKey:
    | 'noSteps' | 'llmNeedsPrompt' | 'connectorNeedsConnector' | 'connectorNeedsAction' | 'agentNeedsTask'
    // COMPOSITION — every way a nested canvas can fail to be a runnable step.
    | 'subflowNeedsCanvas' | 'subflowUnresolved' | 'subflowCycle' | 'subflowTooDeep'
    | 'subflowEmpty' | 'subflowNotBuildable' | 'subflowNeedsBuild';
  values?: Record<string, string>;
}

export interface BoardFlowCompileResult {
  definition: { nodes: CompiledFlowNode[]; edges: CompiledFlowEdge[] };
  issues: BoardFlowIssue[];
  /** Steps that produced a node, excluding anything synthesized. */
  compiledCount: number;
}

/** Whether a board object is a step at all. */
export function isFlowStepObject(data: Record<string, unknown>): boolean {
  return data.kind === FLOW_STEP_KIND;
}

/** What a caller may tell the compiler that is not on the board. */
export interface BoardFlowCompileOptions {
  /**
   * How a `subflow` step reads the canvas it nests. Absent, a nested canvas
   * cannot be resolved and says so as an issue — never as a step quietly dropped
   * from the graph.
   */
  resolveSubflow?: SubflowResolver;
  /**
   * The canvas sessions already being compiled, outermost first. A board that
   * reaches itself is a cycle; the executor would deadlock on the graph it
   * produced, so it is refused here where the author can be told which canvas.
   */
  stack?: readonly string[];
  /**
   * Whether to put a manual trigger in front of the roots. False while inlining a
   * CHILD board: the parent supplies the entry, and a second trigger mid-graph is
   * an entry point that can never fire.
   */
  synthesizeTrigger?: boolean;
}

/**
 * The compiler itself, as a value.
 *
 * Composition is recursive — lowering a nested canvas means compiling a board —
 * and the module that lowers it is a peer of the one that compiles. Passing the
 * compiler IN is what keeps that a straight line instead of a cycle.
 */
export type BoardFlowCompiler = (
  objects: readonly BoardFlowObject[],
  connections: readonly BoardFlowConnection[],
  options?: BoardFlowCompileOptions,
) => BoardFlowCompileResult;
