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
  messageKey: 'noSteps' | 'llmNeedsPrompt' | 'connectorNeedsConnector' | 'connectorNeedsAction' | 'agentNeedsTask';
  values?: Record<string, string>;
}

export interface BoardFlowCompileResult {
  definition: { nodes: CompiledFlowNode[]; edges: CompiledFlowEdge[] };
  issues: BoardFlowIssue[];
  /** Steps that produced a node, excluding anything synthesized. */
  compiledCount: number;
}

const SYNTHETIC_TRIGGER_ID = 'trigger';

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
 */
export function compileBoardFlow(
  objects: readonly BoardFlowObject[],
  connections: readonly BoardFlowConnection[],
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

  for (const step of steps) {
    const kind = stepKindOf(step.data);
    const config = stepConfigOf(step.data);
    const title = text(step.data.title) || NODE_KIND_MAP[kind]?.label || kind;
    const issue = configIssue(kind, config);
    if (issue) {
      issues.push({ objectId: step.id, title, messageKey: issue, ...(kind === 'connector' ? { values: { connector: text(config.connector) } } : {}) });
      continue;
    }
    nodes.push({ id: step.id, kind, label: title, position: step.position, config });
    kindOf.set(step.id, kind);
    configOf.set(step.id, config);
    entryOf.set(step.id, step.id);
    exitOf.set(step.id, step.id);

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
      edges.push({ id: `${mapId}->${step.id}`, source: mapId, target: step.id });
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
      edges.push({ id: `${step.id}->${captureId}`, source: step.id, target: captureId });
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
  const hasTrigger = nodes.some((node) => node.kind === 'trigger');
  if (!hasTrigger && nodes.length > 0) {
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
