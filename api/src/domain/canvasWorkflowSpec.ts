/**
 * Canvas workflow spec → executable `WorkflowDefinition`.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A Creation Canvas `workflow` object used to be a drawing. Brain could author
 * `steps`, but `steps` was free-form JSON rendered as labels and compiled by
 * nothing, so "build me a Twilio workflow" produced a card that could never
 * send an SMS. The gap was not the connector layer — Twilio has ten actions in
 * the catalog — it was that no code turned an authored step list into the graph
 * the runtime already knows how to execute.
 *
 * This module is that missing lowering. It takes the step list a human or Brain
 * authored on the canvas and emits a `WorkflowDefinition` whose nodes are the
 * SAME node kinds the workflow builder places by hand, so a compiled workflow
 * and a hand-built one are indistinguishable to the executor.
 *
 * ── WHY IT REFUSES UNDERSPECIFIED STEPS ─────────────────────────────────────
 * A step that carries only a title describes an intention, not a call. Emitting
 * an `agent` node for it would produce a graph that runs, reports success, and
 * does nothing the user asked for — the exact failure this whole change exists
 * to end. So an underspecified step becomes an `issue` naming what it needs and
 * is NOT compiled; if nothing resolves, compilation fails rather than shipping a
 * graph that would lie about its own completeness.
 *
 * Pure by construction (no db/env): the connector/action catalog arrives as a
 * plain map so the route can validate against the tenant's live catalog while
 * this stays unit-testable.
 */

import type { WorkflowDefEdge, WorkflowDefNode, WorkflowDefinition, WorkflowNodeKind } from './workflowGraph';

/** One authored step as it appears in a canvas `workflow` object's `steps`. */
export interface CanvasWorkflowStep {
  title?: string;
  name?: string;
  /** Explicit node kind; inferred from the other fields when omitted. */
  kind?: string;
  /** Integration action — the Twilio/Stripe/Slack path. */
  connector?: string;
  action?: string;
  actionKey?: string;
  input?: unknown;
  connectionId?: string;
  /** LLM step. */
  prompt?: string;
  system?: string;
  provider?: string;
  model?: string;
  /** Agent step. */
  role?: string;
  task?: string;
  /** Control-flow steps. */
  condition?: string;
  predicate?: string;
  expression?: string;
  /** Trigger step (only meaningful as the first step). */
  triggerType?: string;
  cron?: string;
  timezone?: string;
  [key: string]: unknown;
}

/** Why one step could not be compiled, in the author's terms. */
export interface CanvasWorkflowIssue {
  /** 1-based position in the authored list, so a message can point at a card. */
  step: number;
  title: string;
  message: string;
}

export interface CanvasWorkflowCompileResult {
  definition: WorkflowDefinition;
  issues: CanvasWorkflowIssue[];
  /** Steps that produced a node (excludes the synthesized trigger). */
  compiledCount: number;
}

/** Connector key → set of action keys the tenant can actually call. */
export type ConnectorActionIndex = Map<string, Set<string>>;

const NODE_SPACING_X = 220;

function asRecord(step: unknown): CanvasWorkflowStep {
  if (typeof step === 'string') return { title: step };
  if (step && typeof step === 'object' && !Array.isArray(step)) return step as CanvasWorkflowStep;
  return {};
}

function stepTitle(step: CanvasWorkflowStep, index: number): string {
  const title = typeof step.title === 'string' && step.title.trim()
    ? step.title.trim()
    : typeof step.name === 'string' && step.name.trim() ? step.name.trim() : '';
  return title || `Step ${index + 1}`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Decide what a step IS from what it carries. Explicit `kind` wins; otherwise the
 * presence of a connector/prompt/role is the signal. Returns null when the step
 * carries no executable intent at all.
 */
function inferKind(step: CanvasWorkflowStep): WorkflowNodeKind | null {
  const explicit = text(step.kind).toLowerCase();
  const KNOWN: WorkflowNodeKind[] = [
    'trigger', 'agent', 'llm', 'mcp', 'connector', 'memory',
    'knowledge', 'train', 'transform', 'filter', 'branch', 'output', 'gmail',
    // Flow Control / Tools / Text Parser / Diagnostics — no natural-language
    // inference heuristic exists for these (unlike `filter`'s condition/predicate
    // fields below), so an authored step only resolves to one of them via an
    // EXPLICIT `kind`; `configForKind`'s default branch passes its fields through.
    'router', 'merge', 'set-variable', 'get-variable', 'increment', 'sleep',
    'regex-match', 'html-to-text', 'assert', 'healthcheck', 'web-search',
  ];
  if (explicit && (KNOWN as string[]).includes(explicit)) return explicit as WorkflowNodeKind;
  // `sms`, `whatsapp`, `email`, `call` are how a person names the step — all of
  // them are one connector action, so they route to the connector node.
  if (text(step.connector)) return 'connector';
  if (text(step.prompt) || text(step.model) || text(step.provider)) return 'llm';
  if (text(step.role) || text(step.task)) return 'agent';
  if (text(step.condition) || text(step.predicate)) return 'filter';
  if (text(step.expression)) return 'transform';
  return null;
}

/** Build the per-kind node config, mirroring the builder palette's defaultConfig. */
function configForKind(kind: WorkflowNodeKind, step: CanvasWorkflowStep): Record<string, unknown> {
  switch (kind) {
    case 'connector':
      return {
        connector: text(step.connector),
        action: text(step.action) || text(step.actionKey),
        input: step.input ?? {},
        ...(text(step.connectionId) ? { connectionId: text(step.connectionId) } : {}),
      };
    case 'llm':
      return {
        provider: text(step.provider) || 'openai',
        model: text(step.model),
        system: text(step.system),
        prompt: text(step.prompt),
      };
    case 'agent':
      return { role: text(step.role) || 'code-creator', task: text(step.task) || text(step.title) };
    case 'filter':
      return { predicate: text(step.predicate) || text(step.condition) };
    case 'branch':
      return { condition: text(step.condition) || text(step.predicate) };
    case 'transform':
      return { expression: text(step.expression) };
    case 'trigger':
      return {
        triggerType: text(step.triggerType) || 'manual',
        ...(text(step.cron) ? { cron: text(step.cron) } : {}),
        ...(text(step.timezone) ? { timezone: text(step.timezone) } : {}),
      };
    default:
      // Kinds with no canvas-authorable shape yet pass their authored fields
      // through untouched rather than being silently emptied.
      return { ...step };
  }
}

/**
 * Validate a step's config for the one failure the executor cannot recover from:
 * a call with nothing to call. Returns an author-facing message, or null.
 */
function configIssue(
  kind: WorkflowNodeKind,
  config: Record<string, unknown>,
  catalog: ConnectorActionIndex | undefined,
): string | null {
  if (kind !== 'connector') {
    if (kind === 'llm' && !text(config.prompt)) return 'This model step needs a prompt.';
    return null;
  }
  const connector = text(config.connector);
  const action = text(config.action);
  if (!connector) return 'This integration step needs a connector (for example "twilio").';
  if (!action) return `This step needs an action on "${connector}" (for example "send_sms").`;
  if (!catalog) return null;

  const actions = catalog.get(connector);
  if (!actions) {
    const available = [...catalog.keys()].sort().slice(0, 8).join(', ');
    return `No connected integration named "${connector}". ${
      available ? `Available: ${available}.` : 'Connect one under Settings ▸ Integrations first.'
    }`;
  }
  if (!actions.has(action)) {
    const available = [...actions].sort().slice(0, 8).join(', ');
    return `"${connector}" has no action "${action}". Available: ${available}.`;
  }
  return null;
}

/**
 * Lower an authored canvas step list into an executable definition.
 *
 * The graph is a linear chain — trigger → step → step → … — because that is what
 * an authored list means. Fan-out stays the hand-built builder's job; inventing
 * parallelism the author did not express would change the semantics of their list.
 */
export function compileCanvasWorkflowSteps(
  rawSteps: unknown,
  options: { catalog?: ConnectorActionIndex; triggerType?: string } = {},
): CanvasWorkflowCompileResult {
  const steps = Array.isArray(rawSteps) ? rawSteps.map(asRecord) : [];
  const issues: CanvasWorkflowIssue[] = [];
  const nodes: WorkflowDefNode[] = [];
  const edges: WorkflowDefEdge[] = [];

  if (steps.length === 0) {
    return {
      definition: { nodes: [], edges: [] },
      issues: [{ step: 0, title: '', message: 'This workflow has no steps to compile.' }],
      compiledCount: 0,
    };
  }

  // An author who wrote their own trigger step keeps it; otherwise a manual
  // trigger is synthesized so the chain has the entry point the runtime expects.
  // Destructured rather than indexed: the early return above proves the array is
  // non-empty, but `noUncheckedIndexedAccess` does not follow that, and a bare
  // `steps[0]` is `… | undefined` at the type level.
  const [first] = steps;
  const authoredTrigger = first !== undefined && inferKind(first) === 'trigger';
  let index = 0;
  if (!authoredTrigger) {
    nodes.push({
      id: 'trigger',
      kind: 'trigger',
      label: 'Start',
      position: { x: 0, y: 0 },
      config: { triggerType: options.triggerType || 'manual' },
    });
    index = 1;
  }

  let previousId = authoredTrigger ? '' : 'trigger';
  steps.forEach((step, i) => {
    const title = stepTitle(step, i);
    const kind = inferKind(step);
    if (!kind) {
      issues.push({
        step: i + 1,
        title,
        message: 'This step describes an intention but no action to run. Give it a connector and action, a prompt, or an agent role.',
      });
      return;
    }
    const config = configForKind(kind, step);
    const issue = configIssue(kind, config, options.catalog);
    if (issue) {
      issues.push({ step: i + 1, title, message: issue });
      return;
    }
    const id = `s${i + 1}`;
    nodes.push({ id, kind, label: title, position: { x: index * NODE_SPACING_X, y: 0 }, config });
    if (previousId) edges.push({ id: `e${index}`, source: previousId, target: id });
    previousId = id;
    index += 1;
  });

  return { definition: { nodes, edges }, issues, compiledCount: nodes.length - (authoredTrigger ? 0 : 1) };
}

/** Project a connector action catalog into the index the compiler validates against. */
export function connectorActionIndex(
  catalog: Array<{ key: string; actions: Array<{ key: string }> }>,
): ConnectorActionIndex {
  return new Map(catalog.map((connector) => [connector.key, new Set(connector.actions.map((a) => a.key))]));
}
