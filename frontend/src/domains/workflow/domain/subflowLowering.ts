/**
 * ONE NESTED CANVAS, LOWERED INTO THE PARENT'S GRAPH.
 *
 * ── THE TWO BINDINGS ─────────────────────────────────────────────────────────
 * `live` is ONE node carrying the child's own definition id. The run resolves it
 * when it is instantiated (`api/src/application/workflow/expandSubflows.ts`), so a
 * rebuilt child reaches every parent that calls it without any of them being
 * rebuilt. It needs the child to have been built once, and refuses rather than
 * emitting a reference to a definition that does not exist.
 *
 * `snapshot` compiles the child board HERE, with the same compiler the parent was
 * compiled by, and splices it between two pass-through nodes. The child is frozen
 * into the parent exactly as it read on the day it was built.
 *
 * ── WHY EVERY CHILD FAILURE IS A PARENT FAILURE ──────────────────────────────
 * A subflow that compiled to nothing would be a step that runs, reports success,
 * and does nothing that was asked for — the one outcome the compiler exists to
 * prevent. So an unresolved canvas, an empty one, a cycle, and a child holding an
 * unbuildable step are all refusals that NAME the canvas, pinned to the step on
 * the parent board that reaches for it.
 *
 * ── WHY THE COMPILER IS AN ARGUMENT ──────────────────────────────────────────
 * Lowering a nested canvas means compiling a board, and the module that compiles
 * boards lowers nested canvases. Taking the compiler as a parameter is what makes
 * that a straight line rather than an import cycle — and it is what lets a test
 * lower a subflow against a stub compiler.
 */

import {
  MAX_SUBFLOW_DEPTH, subflowBinding, subflowCanvasTitle, subflowSessionId,
} from './subflow';
import { stepInputsOf } from './flowStepObject';
import { subflowInterface } from './subflowInterface';
import type {
  BoardFlowCompileOptions, BoardFlowCompiler, BoardFlowIssue, BoardFlowObject,
  CompiledFlowEdge, CompiledFlowNode,
} from './boardFlow';

/** A nested canvas, lowered into nodes the parent definition can hold. */
export interface SubflowSplice {
  nodes: CompiledFlowNode[];
  edges: CompiledFlowEdge[];
  /** The compiled node an edge INTO the subflow step should enter. */
  entry: string;
  /** The compiled node an edge OUT of the subflow step should leave. */
  exit: string;
}

export type SubflowOutcome =
  | { ok: true; splice: SubflowSplice }
  | { ok: false; messageKey: BoardFlowIssue['messageKey']; values?: Record<string, string> };

/**
 * A pass-through node — the visible boundary of a nested canvas in the run.
 *
 * An empty `transform` expression forwards its input untouched (see the executor's
 * `transform` case), so the boundary costs one row in the timeline and nothing
 * else. It earns that row: without it, a child with three entry steps would need
 * the parent's incoming connection duplicated onto each of them, and the run would
 * show no sign that the steps in the middle came from somewhere else.
 */
function passThrough(id: string, label: string, position: { x: number; y: number }): CompiledFlowNode {
  return { id, kind: 'transform', label, position, config: { expression: '' } };
}

/**
 * A child canvas's own trigger is THAT canvas's entry point. Inlining it would put
 * a webhook or a schedule in the middle of somebody else's graph — an entry that
 * can never fire, feeding steps that would then wait on it forever. Dropping it
 * makes whatever it fed a root, which is exactly what the parent's entry feeds.
 */
function withoutTriggers(
  definition: { nodes: CompiledFlowNode[]; edges: CompiledFlowEdge[] },
): { nodes: CompiledFlowNode[]; edges: CompiledFlowEdge[] } {
  const triggers = new Set(definition.nodes.filter((node) => node.kind === 'trigger').map((node) => node.id));
  if (triggers.size === 0) return definition;
  return {
    nodes: definition.nodes.filter((node) => !triggers.has(node.id)),
    edges: definition.edges.filter((edge) => !triggers.has(edge.source) && !triggers.has(edge.target)),
  };
}

export function lowerSubflow(
  step: BoardFlowObject,
  title: string,
  config: Record<string, unknown>,
  options: BoardFlowCompileOptions,
  compile: BoardFlowCompiler,
): SubflowOutcome {
  const sessionId = subflowSessionId(config);
  const canvas = subflowCanvasTitle(config) || sessionId;
  if (!sessionId) return { ok: false, messageKey: 'subflowNeedsCanvas' };

  const stack = options.stack ?? [];
  if (stack.includes(sessionId)) return { ok: false, messageKey: 'subflowCycle', values: { canvas } };
  if (stack.length >= MAX_SUBFLOW_DEPTH) {
    return { ok: false, messageKey: 'subflowTooDeep', values: { canvas, depth: String(MAX_SUBFLOW_DEPTH) } };
  }

  const child = options.resolveSubflow?.(sessionId) ?? null;
  if (!child) return { ok: false, messageKey: 'subflowUnresolved', values: { canvas } };
  const named = child.title || canvas;

  /**
   * WHAT THE PARENT HANDS OVER, AGAINST WHAT THE CHILD ASKED FOR.
   *
   * A step that declares NOTHING passes the payload through untouched, which is a
   * legitimate and common way to call a canvas — so the check only applies once the
   * author has started describing the handover. From that moment the declaration IS
   * the statement of what the child receives, and a parameter missing from it is
   * missing at run time: `employe` where the child needs `employee` builds green,
   * runs green, and hands the child a payload without the one field it reads.
   *
   * Blocking, like every other issue, because it is the same defect class the
   * compiler already refuses — a step that succeeds at nothing — and not a matter of
   * taste the author might mean.
   */
  const declared = stepInputsOf(step.data);
  if (declared.length > 0) {
    const handed = new Set(declared.map((binding) => binding.key));
    const missing = subflowInterface(child).inputs.find((port) => !handed.has(port.key));
    if (missing) {
      return { ok: false, messageKey: 'subflowMissingInput', values: { canvas: named, key: missing.key } };
    }
  }

  if (subflowBinding(config) === 'live') {
    if (!child.definitionId) return { ok: false, messageKey: 'subflowNeedsBuild', values: { canvas: named } };
    return {
      ok: true,
      splice: {
        nodes: [{
          id: step.id,
          kind: 'subflow',
          label: title,
          position: step.position,
          // `canvas` rides along so the run's timeline and the expansion's own
          // errors can name the canvas rather than a uuid.
          config: { ...config, definitionId: child.definitionId, canvas: named, canvasSessionId: sessionId },
        }],
        edges: [],
        entry: step.id,
        exit: step.id,
      },
    };
  }

  const inner = compile(child.objects, child.connections, {
    ...options,
    stack: [...stack, sessionId],
    synthesizeTrigger: false,
  });
  // ORDER MATTERS. A child holding one unbuildable step compiles to zero nodes AND
  // an issue, and reading emptiness first would tell the author their canvas is
  // empty when what it actually has is a step that still needs a prompt. Ask what
  // the child SAID before asking what it produced.
  if (inner.issues.some((issue) => issue.messageKey === 'noSteps')) {
    return { ok: false, messageKey: 'subflowEmpty', values: { canvas: named } };
  }
  if (inner.issues.length > 0) {
    return { ok: false, messageKey: 'subflowNotBuildable', values: { canvas: named, step: inner.issues[0]!.title } };
  }
  if (inner.definition.nodes.length === 0) {
    return { ok: false, messageKey: 'subflowEmpty', values: { canvas: named } };
  }

  const { nodes: childNodes, edges: childEdges } = withoutTriggers(inner.definition);
  if (childNodes.length === 0) return { ok: false, messageKey: 'subflowEmpty', values: { canvas: named } };

  // Ids are namespaced by the STEP, not by the canvas: the same child nested twice
  // in one flow is two independent runs of it, and sharing ids would silently merge
  // them into one.
  const scoped = (id: string) => `${step.id}~${id}`;
  const originX = Math.min(...childNodes.map((node) => node.position.x));
  const originY = Math.min(...childNodes.map((node) => node.position.y));
  const width = Math.max(...childNodes.map((node) => node.position.x)) - originX;
  const exitId = `${step.id}:exit`;

  const nodes: CompiledFlowNode[] = [
    passThrough(step.id, title, step.position),
    ...childNodes.map((node) => ({
      ...node,
      id: scoped(node.id),
      label: `${named} · ${node.label}`,
      position: {
        x: step.position.x + 220 + (node.position.x - originX),
        y: step.position.y + (node.position.y - originY),
      },
    })),
    passThrough(exitId, `${title} · end`, { x: step.position.x + width + 440, y: step.position.y }),
  ];

  const fed = new Set(childEdges.map((edge) => edge.target));
  const feeds = new Set(childEdges.map((edge) => edge.source));
  const edges: CompiledFlowEdge[] = [
    ...childEdges.map((edge) => ({ ...edge, id: scoped(edge.id), source: scoped(edge.source), target: scoped(edge.target) })),
    ...childNodes.filter((node) => !fed.has(node.id))
      .map((node) => ({ id: `${step.id}->${scoped(node.id)}`, source: step.id, target: scoped(node.id) })),
    ...childNodes.filter((node) => !feeds.has(node.id))
      .map((node) => ({ id: `${scoped(node.id)}->${exitId}`, source: scoped(node.id), target: exitId })),
  ];

  return { ok: true, splice: { nodes, edges, entry: step.id, exit: exitId } };
}
