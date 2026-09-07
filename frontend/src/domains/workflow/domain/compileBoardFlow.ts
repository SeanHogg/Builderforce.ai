/**
 * THE BOARD IS THE DEFINITION — lowering canvas steps into a runnable graph.
 *
 * ── WHAT THIS REPLACES ───────────────────────────────────────────────────────
 * A `workflow` card used to hold an authored STEP LIST, lowered server-side into a
 * linear chain by a second compiler (`api/src/domain/canvasWorkflowSpec.ts`, since
 * deleted). That was the right shape while the canvas could only describe a workflow
 * in words: a list has one continuation, so the compiler could not invent fan-out
 * without inventing structure the author never wrote, and it said so. A legacy card's
 * list is now unpacked onto the board instead (`flowStepsFromCanvasSteps.ts`), so this
 * is the only compiler left.
 *
 * A board is not a list. The author has drawn the fan-out, drawn which outlet of
 * the switch goes where, and drawn what joins back together — so this compiler
 * does not infer any of it. It reads the objects and the connections that are
 * there. That is the whole difference, and it is why the modal editor is gone:
 * there is nothing left for it to edit that the board does not already hold.
 *
 * ── WHAT IT REFUSES ──────────────────────────────────────────────────────────
 * The same refusal, for the same reason: a step carrying no call is an intention,
 * not an action. Emitting a node for it produces a graph that runs, reports
 * success, and does nothing that was asked for. Such a step becomes an `issue`
 * naming what it needs and is NOT compiled.
 *
 * ── PURE, AND OVER PLAIN SHAPES ──────────────────────────────────────────────
 * It takes `{id, position, data}` and `{id, source, target, sourceHandle}`, not
 * React Flow nodes and not canvas objects. So the canvas domain and this one stay
 * uncoupled, and the whole lowering is unit-testable without mounting a board.
 */

import type { WorkflowNodeKind } from '@/lib/builderforceApi';
import { NODE_KIND_MAP } from './stepCatalog';
import {
  FLOW_STEP_KIND, stepConfigOf, stepInputsOf, stepKindOf, stepOutputsOf,
  type FlowStepBinding, type FlowStepOutput,
} from './flowStepObject';
import { isMultiOutletKind, outletForHandle } from './stepOutlets';
import {
  MAX_SUBFLOW_DEPTH, isSubflowKind, subflowBinding, subflowCanvasTitle, subflowSessionId,
  type SubflowResolver,
} from './subflow';

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

const SYNTHETIC_TRIGGER_ID = 'trigger';

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

/** A nested canvas, lowered into nodes the parent definition can hold. */
interface SubflowSplice {
  nodes: CompiledFlowNode[];
  edges: CompiledFlowEdge[];
  /** The compiled node an edge INTO the subflow step should enter. */
  entry: string;
  /** The compiled node an edge OUT of the subflow step should leave. */
  exit: string;
}

type SubflowOutcome =
  | { ok: true; splice: SubflowSplice }
  | { ok: false; messageKey: BoardFlowIssue['messageKey']; values?: Record<string, string> };

/**
 * A pass-through node — the visible boundary of a nested canvas in the run.
 *
 * An empty `transform` expression forwards its input untouched (see the executor's
 * `transform` case), so the boundary costs one row in the timeline and nothing
 * else. It earns that row: without it a child with three roots would need the
 * parent's incoming edge duplicated three times, and the run would show no sign
 * that the steps in the middle came from somewhere else.
 */
function passThrough(id: string, label: string, position: { x: number; y: number }): CompiledFlowNode {
  return { id, kind: 'transform', label, position, config: { expression: '' } };
}

/**
 * A child canvas's own trigger is that canvas's entry point, and inlining it would
 * put a webhook/schedule node in the middle of somebody else's graph — an entry
 * that can never fire, feeding steps that would then wait on it. Dropping it makes
 * whatever it fed a root, which is exactly what the parent's entry should feed.
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

/**
 * ONE NESTED CANVAS, LOWERED.
 *
 * `live` is one node carrying the child's own definition id: the run resolves it
 * when it is instantiated, so a rebuilt child reaches every parent without any of
 * them being rebuilt. It needs the child to have been built once, and refuses
 * rather than emitting a reference to a definition that does not exist.
 *
 * `snapshot` compiles the child board HERE, with the same compiler, and splices it
 * between two pass-through nodes. Every failure the child has is the parent's
 * failure to build — a subflow that compiled to nothing would be a step that runs,
 * reports success and does nothing that was asked for, which is the one outcome
 * this compiler exists to prevent.
 */
function compileSubflow(
  step: BoardFlowObject,
  title: string,
  config: Record<string, unknown>,
  options: BoardFlowCompileOptions,
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
          // `canvas` rides along so a run's timeline and the expansion's own
          // errors can name the canvas rather than a uuid.
          config: { ...config, definitionId: child.definitionId, canvas: named, canvasSessionId: sessionId },
        }],
        edges: [],
        entry: step.id,
        exit: step.id,
      },
    };
  }

  const inner = compileBoardFlow(child.objects, child.connections, {
    ...options,
    stack: [...stack, sessionId],
    synthesizeTrigger: false,
  });
  if (inner.definition.nodes.length === 0 || inner.issues.some((issue) => issue.messageKey === 'noSteps')) {
    return { ok: false, messageKey: 'subflowEmpty', values: { canvas: named } };
  }
  if (inner.issues.length > 0) {
    return { ok: false, messageKey: 'subflowNotBuildable', values: { canvas: named, step: inner.issues[0]!.title } };
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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Whether a board object is a step at all. */
export function isFlowStepObject(data: Record<string, unknown>): boolean {
  return data.kind === FLOW_STEP_KIND;
}

/**
 * The one call a step of this kind cannot run without.
 *
 * Deliberately short: every other field has a defensible default, and a compiler
 * that refuses a step for a missing optional teaches people to fill boxes rather
 * than to describe work. These three are the ones where the step would otherwise
 * succeed at nothing.
 */
function configIssue(kind: WorkflowNodeKind, config: Record<string, unknown>): BoardFlowIssue['messageKey'] | null {
  if (kind === 'llm' && !text(config.prompt)) return 'llmNeedsPrompt';
  if (kind === 'connector') {
    if (!text(config.connector)) return 'connectorNeedsConnector';
    if (!text(config.action) && !text(config.actionKey)) return 'connectorNeedsAction';
  }
  if (kind === 'agent' && !text(config.task) && !text(config.role)) return 'agentNeedsTask';
  return null;
}

/** The `transform` step that BUILDS this step's declared input. See `FlowStepBinding`. */
function inputMapExpression(bindings: readonly FlowStepBinding[]): string {
  const entries = bindings.map((binding) => {
    const path = binding.from || 'input';
    return `${JSON.stringify(binding.key)}: {{ json ${path} }}`;
  });
  return `{${entries.join(', ')}}`;
}

/** The `set-variables` step that PUBLISHES this step's declared output. */
function outputCaptureValues(outputs: readonly FlowStepOutput[]): string {
  return JSON.stringify(Object.fromEntries(outputs.map((output) => [output.key, `{{ ${output.from || 'input'} }}`])));
}

/**
 * Lower the steps on a board into an executable definition.
 *
 * `objects` may be the whole board — anything that is not a step is ignored, so a
 * flow drawn beside the dataset it reads and the report it writes compiles to the
 * flow, not to the furniture around it.
 *
 * Re-entrant: a `subflow` step compiles its child canvas through this same
 * function, one level deeper (`options.stack`). There is deliberately no second
 * compiler for nested boards — a child that lowered differently from a parent is
 * two answers to one question, and the answer that drifts is the one on the board
 * nobody opened.
 */
export function compileBoardFlow(
  objects: readonly BoardFlowObject[],
  connections: readonly BoardFlowConnection[],
  options: BoardFlowCompileOptions = {},
): BoardFlowCompileResult {
  const steps = objects.filter((object) => isFlowStepObject(object.data));
  if (steps.length === 0) {
    return { definition: { nodes: [], edges: [] }, issues: [{ objectId: '', title: '', messageKey: 'noSteps' }], compiledCount: 0 };
  }

  const issues: BoardFlowIssue[] = [];
  const nodes: CompiledFlowNode[] = [];
  const edges: CompiledFlowEdge[] = [];
  /** Board object id → the compiled node an incoming edge should ENTER. */
  const entryOf = new Map<string, string>();
  /** Board object id → the compiled node an outgoing edge should LEAVE. */
  const exitOf = new Map<string, string>();
  /** Board object id → its step kind, for resolving outlet labels. */
  const kindOf = new Map<string, WorkflowNodeKind>();
  const configOf = new Map<string, Record<string, unknown>>();
  /**
   * Whether the AUTHOR drew a trigger on THIS board. It cannot be read back off
   * `nodes` any more: a nested canvas contributes its own steps, and inlining one
   * that happened to hold a trigger would otherwise suppress this board's entry
   * point — a flow with nowhere to start, because of a step inside a canvas the
   * author of this one never opened.
   */
  let hasAuthoredTrigger = false;

  for (const step of steps) {
    const kind = stepKindOf(step.data);
    const config = stepConfigOf(step.data);
    const title = text(step.data.title) || NODE_KIND_MAP[kind]?.label || kind;

    /**
     * The step's own compiled body, and the two ends a connection attaches to.
     * Every ordinary kind is ONE node that is both ends; a nested canvas is a
     * whole graph with a pass-through at each end. Naming the two ends here is
     * what lets declared data-in and data-out below stay one implementation
     * rather than growing a branch for composition.
     */
    let core: { entry: string; exit: string };
    if (isSubflowKind(kind)) {
      const outcome = compileSubflow(step, title, config, options);
      if (!outcome.ok) {
        issues.push({ objectId: step.id, title, messageKey: outcome.messageKey, ...(outcome.values ? { values: outcome.values } : {}) });
        continue;
      }
      nodes.push(...outcome.splice.nodes);
      edges.push(...outcome.splice.edges);
      core = { entry: outcome.splice.entry, exit: outcome.splice.exit };
    } else {
      const issue = configIssue(kind, config);
      if (issue) {
        issues.push({ objectId: step.id, title, messageKey: issue, ...(kind === 'connector' ? { values: { connector: text(config.connector) } } : {}) });
        continue;
      }
      nodes.push({ id: step.id, kind, label: title, position: step.position, config });
      if (kind === 'trigger') hasAuthoredTrigger = true;
      core = { entry: step.id, exit: step.id };
    }

    kindOf.set(step.id, kind);
    configOf.set(step.id, config);
    entryOf.set(step.id, core.entry);
    exitOf.set(step.id, core.exit);

    // DATA IN — a mapping step in front, so what arrives is what the author declared.
    const inputs = stepInputsOf(step.data);
    if (inputs.length > 0) {
      const mapId = `${step.id}:in`;
      nodes.push({
        id: mapId,
        kind: 'transform',
        label: `${title} · input`,
        position: { x: step.position.x - 180, y: step.position.y },
        config: { expression: inputMapExpression(inputs) },
      });
      edges.push({ id: `${mapId}->${core.entry}`, source: mapId, target: core.entry });
      entryOf.set(step.id, mapId);
    }

    // DATA OUT — a capture step after, publishing run variables later steps read.
    //
    // Never for a multi-outlet step: inserting one node after a switch would funnel
    // every outlet through it and collapse the fan-out the author drew. Such a step
    // publishes the payload it was handed anyway, so there is nothing of its own to
    // capture — which is why the inspector does not offer the section there either.
    const outputs = stepOutputsOf(step.data);
    if (outputs.length > 0 && !isMultiOutletKind(kind)) {
      const captureId = `${step.id}:out`;
      nodes.push({
        id: captureId,
        kind: 'set-variables',
        label: `${title} · output`,
        position: { x: step.position.x + 180, y: step.position.y },
        config: { values: outputCaptureValues(outputs) },
      });
      edges.push({ id: `${core.exit}->${captureId}`, source: core.exit, target: captureId });
      exitOf.set(step.id, captureId);
    }
  }

  for (const connection of connections) {
    const source = exitOf.get(connection.source);
    const target = entryOf.get(connection.target);
    // A connection to something that is not a compiled step is a board connection,
    // not a flow edge — a step wired to the dataset it reads says where the data
    // came from, and says nothing about execution order.
    if (!source || !target) continue;
    const sourceKind = kindOf.get(connection.source);
    const outlet = sourceKind && exitOf.get(connection.source) === connection.source
      ? outletForHandle(sourceKind, configOf.get(connection.source) ?? {}, connection.sourceHandle)
      : null;
    edges.push({
      id: connection.id,
      source,
      target,
      // Only a NAMED outlet becomes a label. An unlabeled edge is never pruned, so
      // an ordinary connection keeps meaning "and then".
      ...(outlet && outlet.name && outlet.id !== 'out' ? { label: outlet.name } : {}),
    });
  }

  // THE ENTRY POINT. A board whose author drew their own trigger keeps it; otherwise
  // a manual trigger is synthesized in front of every step nothing feeds, because the
  // runtime starts at a trigger and a graph with several roots has several starts.
  // Skipped entirely while inlining a child: the parent's entry feeds its roots.
  if (options.synthesizeTrigger !== false && !hasAuthoredTrigger && nodes.length > 0) {
    const fed = new Set(edges.map((edge) => edge.target));
    const roots = nodes.filter((node) => !fed.has(node.id));
    const top = Math.min(...nodes.map((node) => node.position.y));
    const left = Math.min(...nodes.map((node) => node.position.x));
    nodes.unshift({
      id: SYNTHETIC_TRIGGER_ID,
      kind: 'trigger',
      label: 'Start',
      position: { x: left - 220, y: top },
      config: { triggerType: 'manual' },
    });
    for (const root of roots) {
      edges.push({ id: `${SYNTHETIC_TRIGGER_ID}->${root.id}`, source: SYNTHETIC_TRIGGER_ID, target: root.id });
    }
  }

  return {
    definition: { nodes, edges },
    issues,
    compiledCount: steps.length - issues.filter((issue) => issue.objectId).length,
  };
}
