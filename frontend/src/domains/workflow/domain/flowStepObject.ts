/**
 * A STEP, AS A CANVAS OBJECT.
 *
 * ── WHY A `flowStep` OBJECT AND NOT A `workflow` OBJECT ──────────────────────
 * The canvas used to hold a `workflow` CARD: one object standing in for a whole
 * graph, whose steps were an authored list you edited in a modal that opened a
 * second canvas on top of the first. Two canvases, two palettes, two node
 * renderers, two selection models — and a board that could draw the work but not
 * the flow, because the flow was somewhere else.
 *
 * A `flowStep` is the same thing said once: one step is one object, on the board,
 * beside the dataset it reads and the report it writes. The canvas IS the
 * workflow. Connections between steps are the board's own connections, a group of
 * steps is the board's own frame, and running it compiles the objects that are
 * there (see `compileBoardFlow.ts`).
 *
 * ── ONE KIND, NOT SIXTY ──────────────────────────────────────────────────────
 * There are ~60 step kinds in `stepCatalog.ts` and there is exactly ONE canvas
 * object kind for them. Which step it is, is a VALUE (`stepKind`), not a kind —
 * the same rule the rest of the model follows (a new industry is a `discipline`
 * value, a new funnel is a `domain` value). Sixty canvas kinds would mean sixty
 * registry entries, sixty palette labels in five locales and sixty branches in
 * the node renderer, all of which already exist once in the step catalog.
 *
 * This module is the whole vocabulary of that object: how to read a step off it,
 * how to make one, and how the object picker encodes a catalog entry as a palette
 * choice. It returns plain data rather than importing the canvas's object type —
 * a cross-domain reference is a value, never an imported table.
 */

import type { WorkflowNodeKind } from '@/lib/builderforceApi';
import { NODE_KIND_MAP, type NodeKindMeta } from './stepCatalog';
import { INTEGRATIONS, presetConfig, type Integration } from './stepIntegrations';

/** The canvas object kind every step is placed as. */
export const FLOW_STEP_KIND = 'flowStep';

/**
 * One declared piece of DATA IN — a name this step's input will carry, and the
 * path in the upstream payload it is read from.
 *
 * Real, not documentation: `compileBoardFlow` lowers the list into a `transform`
 * step in front of this one, so what the step receives is the object the author
 * described. See `renderValueTemplate` / the `{{ json … }}` span in the API's
 * `workflowExpr.ts` for why the mapping survives values containing quotes.
 */
export interface FlowStepBinding {
  /** The key the mapped payload will carry. */
  key: string;
  /** Path into the upstream payload (`order.id`, `$`, blank = the whole input). */
  from: string;
}

/** One declared piece of DATA OUT — a run variable this step publishes. */
export interface FlowStepOutput {
  /** Variable name later steps read with Get Variable(s). */
  key: string;
  /** Path into this step's own output (blank = the whole output). */
  from: string;
}

/** What a `flowStep` object holds, beyond the identity every object has. */
export interface FlowStepFields {
  stepKind: WorkflowNodeKind;
  stepConfig: Record<string, unknown>;
  stepInputs: FlowStepBinding[];
  stepOutputs: FlowStepOutput[];
}

/** The step kind an object carries, defaulting to the one kind that needs no
 *  configuration to be meaningful. */
export function stepKindOf(data: Record<string, unknown>): WorkflowNodeKind {
  const kind = typeof data.stepKind === 'string' ? data.stepKind : '';
  return (kind in NODE_KIND_MAP ? kind : 'agent') as WorkflowNodeKind;
}

export function stepConfigOf(data: Record<string, unknown>): Record<string, unknown> {
  const config = data.stepConfig;
  return config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
}

function readBindings(value: unknown): Array<{ key: string; from: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key.trim() : '';
    if (!key) return [];
    return [{ key, from: typeof record.from === 'string' ? record.from.trim() : '' }];
  });
}

export function stepInputsOf(data: Record<string, unknown>): FlowStepBinding[] {
  return readBindings(data.stepInputs);
}

export function stepOutputsOf(data: Record<string, unknown>): FlowStepOutput[] {
  return readBindings(data.stepOutputs);
}

/** The metadata for the step an object carries. */
export function stepMetaOf(data: Record<string, unknown>): NodeKindMeta | undefined {
  return NODE_KIND_MAP[stepKindOf(data)];
}

/**
 * The object data for a newly placed step.
 *
 * The title is resolved ONCE, in the author's language, and then belongs to them
 * — the same rule the standalone builder follows (`makeNode`): a step's name is
 * workflow data a person edits, not chrome that re-translates under them.
 */
export function createFlowStepData(
  stepKind: WorkflowNodeKind,
  label: string,
): Record<string, unknown> {
  const meta = NODE_KIND_MAP[stepKind];
  return {
    kind: FLOW_STEP_KIND,
    title: label,
    stepKind,
    stepConfig: { ...(meta?.defaultConfig ?? {}) },
    stepInputs: [],
    stepOutputs: [],
  };
}

/** The object data for a step placed from an integration preset. */
export function createIntegrationStepData(integration: Integration): Record<string, unknown> {
  return {
    kind: FLOW_STEP_KIND,
    title: integration.label,
    stepKind: integration.kind,
    stepConfig: presetConfig(integration),
    stepInputs: [],
    stepOutputs: [],
  };
}

// ── The palette's third vocabulary ─────────────────────────────────────────────
// The canvas object picker hands back one string covering object kinds, stencil
// presets and now steps. Steps get a declared prefix and a parser for exactly the
// reason stencils did (`canvasStencils.ts`): a prefix nothing outside this module
// splits, so the picker knows that steps exist and no step's name.

const STEP_CHOICE_PREFIX = 'step:';
const STEP_INTEGRATION_PREFIX = 'stepIntegration:';

export function stepChoice(stepKind: WorkflowNodeKind): string {
  return `${STEP_CHOICE_PREFIX}${stepKind}`;
}

export function integrationStepChoice(integrationId: string): string {
  return `${STEP_INTEGRATION_PREFIX}${integrationId}`;
}

/**
 * Decode a palette choice into the object data it places, or null when the choice
 * is not a step at all.
 *
 * `name` resolves the catalog's English default through the caller's translator,
 * so a step dropped by a French author arrives named in French.
 */
export function parseStepChoice(
  choice: string,
  name: (meta: NodeKindMeta) => string,
): Record<string, unknown> | null {
  if (choice.startsWith(STEP_CHOICE_PREFIX)) {
    const stepKind = choice.slice(STEP_CHOICE_PREFIX.length) as WorkflowNodeKind;
    const meta = NODE_KIND_MAP[stepKind];
    return meta ? createFlowStepData(stepKind, name(meta)) : null;
  }
  if (choice.startsWith(STEP_INTEGRATION_PREFIX)) {
    const id = choice.slice(STEP_INTEGRATION_PREFIX.length);
    const integration = INTEGRATIONS.find((entry) => entry.id === id);
    return integration ? createIntegrationStepData(integration) : null;
  }
  return null;
}

/** Whether a palette choice is a step — asked before the object-kind path runs. */
export function isStepChoice(choice: string): boolean {
  return choice.startsWith(STEP_CHOICE_PREFIX) || choice.startsWith(STEP_INTEGRATION_PREFIX);
}
