/**
 * AN AUTHORED STEP LIST, UNPACKED ONTO THE BOARD.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * A `workflow` CARD used to hold its steps as a free-form list that only the
 * server could lower, through `POST /api/workflow-definitions/from-canvas` →
 * `api/src/domain/canvasWorkflowSpec.ts`. That was a SECOND compiler: the board
 * lowers itself (`compileBoardFlow.ts`), and a card standing beside it lowered a
 * list nobody could see. Two answers to "what does this canvas run".
 *
 * This module ends that. An authored list is not a thing to compile — it is a
 * section that has not been drawn yet, so it becomes one: a frame holding one
 * `flowStep` object per authored step, chained in the order they were written.
 * From there it is an ordinary part of the board, and the ONE compiler lowers it.
 *
 * ── WHY IT NEVER REFUSES ─────────────────────────────────────────────────────
 * The old compiler refused an underspecified step, because it was producing
 * something that would RUN and a step with only a title would have run green
 * doing nothing. This produces a BOARD. A step that says "email the customer" and
 * names no connector is a real intention that belongs on the canvas, drawn as a
 * step that says what it still needs — which is what `compileBoardFlow`'s issues
 * already put on the card at build time. Refusing to OPEN it would strand the
 * intention in JSON nobody can edit, which is the failure this whole change is
 * about.
 *
 * ── WHY IT DELEGATES THE LAYOUT ──────────────────────────────────────────────
 * It lowers to the same `SavedDefinition` shape a stored workflow has and hands
 * that to `boardFlowFromDefinition`. Positions, the frame rectangle and the
 * reattachment of a labeled edge to its outlet are decided once, there, for both
 * doors onto the board. What is genuinely only true of an authored list — what a
 * step IS, read off the fields it carries — is the only thing this file owns.
 */

import type { WorkflowNodeKind } from '@/lib/builderforceApi';
import { NODE_KIND_MAP } from './stepCatalog';
import { boardFlowFromDefinition, type SavedDefinition, type UnpackedFlow } from './boardFlowFromDefinition';

/** One authored step as it appears in a legacy `workflow` object's `steps`. */
export interface CanvasWorkflowStep {
  title?: string;
  name?: string;
  /** Explicit step kind; inferred from the other fields when omitted. */
  kind?: string;
  /** Integration action — the Twilio/Stripe/Slack path. */
  connector?: string;
  action?: string;
  actionKey?: string;
  input?: unknown;
  connectionId?: string;
  /** Model step. */
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

const STEP_SPACING_X = 300;

function asRecord(step: unknown): CanvasWorkflowStep {
  if (typeof step === 'string') return { title: step };
  if (step && typeof step === 'object' && !Array.isArray(step)) return step as CanvasWorkflowStep;
  return {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stepTitle(step: CanvasWorkflowStep, index: number, fallback: (position: number) => string): string {
  const title = text(step.title) || text(step.name);
  return title || fallback(index + 1);
}

/**
 * Decide what a step IS from what it carries. An explicit `kind` from the step
 * catalog wins; otherwise the presence of a connector, a prompt or a role is the
 * signal — those three are how a person names the step in the first place ("send
 * the SMS", "summarise it", "have the strategist draft it").
 *
 * Falls back to `agent` rather than to nothing: see the header. An intention with
 * no action is a step that needs setting up, not a step to discard.
 */
function inferKind(step: CanvasWorkflowStep): WorkflowNodeKind {
  // The catalog is the list of kinds — asked rather than duplicated, so a kind
  // added under `stepKinds/` is authorable from a legacy list on the same day.
  const explicit = text(step.kind).toLowerCase();
  if (explicit && explicit in NODE_KIND_MAP) return explicit as WorkflowNodeKind;
  if (text(step.connector)) return 'connector';
  if (text(step.prompt) || text(step.model) || text(step.provider)) return 'llm';
  if (text(step.role) || text(step.task)) return 'agent';
  if (text(step.condition) || text(step.predicate)) return 'filter';
  if (text(step.expression)) return 'transform';
  return 'agent';
}

/** Build the step's config, mirroring what the step catalog's editor expects. */
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
      return { role: text(step.role) || 'code-creator', task: text(step.task) };
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
      // Kinds with no authored shape keep their fields rather than being emptied —
      // `stepCatalog`'s own editor renders whatever the config carries.
      return { ...step };
  }
}

/**
 * Lower an authored list into the definition shape the unpacker reads.
 *
 * The chain is linear because that is what a LIST means. Inventing fan-out from
 * adjacency would draw a graph the author never wrote; once it is on the board,
 * drawing the fan-out is a connection they can make in one gesture, which is the
 * whole point of the steps being objects.
 *
 * The edge leaving a `branch` is labeled `true` for the reason it always was: the
 * executor prunes an arm whose labeled edge was not taken, so an unlabeled edge
 * out of a branch would run BOTH sides. `boardFlowFromDefinition` reattaches that
 * label to the branch's `true` outlet, so it arrives on the board wired visibly.
 */
export function canvasStepsToDefinition(
  rawSteps: unknown,
  options: { triggerType?: string; untitledStep: (position: number) => string },
): SavedDefinition {
  const steps = Array.isArray(rawSteps) ? rawSteps.map(asRecord) : [];
  const nodes: SavedDefinition['nodes'] = [];
  const edges: SavedDefinition['edges'] = [];
  if (steps.length === 0) return { nodes, edges };

  // An author who wrote their own trigger keeps it; otherwise one is drawn in
  // front, because a section with no entry point is a section that cannot run and
  // the board should show that rather than fail at build time.
  const [first] = steps;
  const authoredTrigger = first !== undefined && inferKind(first) === 'trigger';
  let column = 0;
  if (!authoredTrigger) {
    nodes.push({
      id: 'trigger',
      kind: 'trigger',
      // Left blank so the unpacker's own catalog fallback names it — one fallback,
      // in the module that already owns naming an unpacked node.
      label: '',
      position: { x: 0, y: 0 },
      config: { triggerType: options.triggerType || 'manual' },
    });
    column = 1;
  }

  let previousId = authoredTrigger ? '' : 'trigger';
  let previousKind: WorkflowNodeKind | null = authoredTrigger ? null : 'trigger';
  steps.forEach((step, index) => {
    const kind = inferKind(step);
    const id = `s${index + 1}`;
    nodes.push({
      id,
      kind,
      label: stepTitle(step, index, options.untitledStep),
      position: { x: column * STEP_SPACING_X, y: 0 },
      config: configForKind(kind, step),
    });
    if (previousId) {
      edges.push({
        id: `e${column}`,
        source: previousId,
        target: id,
        ...(previousKind === 'branch' ? { label: 'true' } : {}),
      });
    }
    previousId = id;
    previousKind = kind;
    column += 1;
  });

  return { nodes, edges };
}

/** The authored list, as the frame and objects that replace the card holding it. */
export function flowStepsFromCanvasSteps(
  rawSteps: unknown,
  origin: { x: number; y: number },
  options: { triggerType?: string; untitledStep: (position: number) => string },
): UnpackedFlow {
  return boardFlowFromDefinition(canvasStepsToDefinition(rawSteps, options), origin);
}
