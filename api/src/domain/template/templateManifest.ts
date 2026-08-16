/**
 * The TEMPLATE manifest — a packaged, installable starting point, as pure data.
 *
 * ── WHAT A TEMPLATE IS ──────────────────────────────────────────────────────
 * A scenario somebody can run: "hire for a role and screen the applicants",
 * "answer customers on whatever channel they arrive on", "run a launch campaign
 * and report on it". Each one is already expressible in this product — as a
 * workflow over the connector catalog, plus the tickets a person still has to
 * work. What was missing is the packaging: the ordered questions that turn the
 * generic graph into THIS customer's graph, and a catalogue entry somebody can
 * find it in.
 *
 * A manifest is therefore three things and nothing else:
 *   • IDENTITY   — what it is, who it is for, what it needs connected;
 *   • SETUP      — the guided steps that collect the answers (see guidedStep);
 *   • OUTPUTS    — what installing it WRITES, with `{{setup.x}}` bindings.
 *
 * Because it is data, the same contract serves all three sources the registry
 * merges — the built-in catalogue shipped as code, a workspace's own saved
 * templates, and templates a third party published to the marketplace — and a
 * publisher never gets to ship executable setup logic.
 *
 * ── WHY OUTPUT SHAPE AND OUTPUT EFFECT ARE SPLIT ────────────────────────────
 * The union below validates what an output DECLARES. What an output DOES lives
 * in `application/templates/outputKinds.ts`, because materialising one writes
 * rows. Keeping the shape here means a manifest can be validated — by a test, by
 * a publisher's linter, by the authoring form — without a database, and the
 * `templateOutputs.contract.test` asserts that every kind declared here has a
 * materialiser registered there, so the two cannot drift apart silently.
 */

import {
  parseGuidedSteps,
  type GuidedStep,
  type RequiredConnector,
  type RequiredSecret,
} from '../guidedSetup/guidedStep';
import { referencedBindings } from '../guidedSetup/guidedPlan';
import { parseDefinition, validateDefinition, type WorkflowDefinition } from '../workflowGraph';

export type { RequiredConnector, RequiredSecret };

/**
 * What a template is FOR, in the language of the person choosing one.
 *
 * Deliberately the entrepreneur's vocabulary rather than the platform's: someone
 * arriving at the catalogue is looking for "marketing" or "hiring", not for
 * "connector" or "workflow definition". A closed set so the gallery's filter
 * bar is a projection of this list rather than a second hand-written one.
 */
export const TEMPLATE_CATEGORIES = [
  'marketing',
  'sales',
  'hiring',
  'support',
  'operations',
  'finance',
  'engineering',
  'messaging',
  'analytics',
  'other',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export function isTemplateCategory(v: unknown): v is TemplateCategory {
  return typeof v === 'string' && (TEMPLATE_CATEGORIES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export const TEMPLATE_OUTPUT_KINDS = ['workflow', 'tasks'] as const;
export type TemplateOutputKind = (typeof TEMPLATE_OUTPUT_KINDS)[number];

/** An automation the install creates and wires up. */
export interface WorkflowOutput {
  kind: 'workflow';
  /** Stable id, so a re-install updates rather than duplicating. */
  id: string;
  name: string;
  description?: string;
  /** The graph, with `{{setup.x}}` bindings anywhere in a node's config. */
  definition: WorkflowDefinition;
}

/** One seeded ticket. `setup` is work only a human can do; `build` is work a
 *  coding agent can pick up — the same split the challenge pipeline makes, for
 *  the same reason: dispatching an agent at "go and connect your account" burns
 *  a run to produce nothing. */
export interface TemplateTask {
  title: string;
  description: string;
  order: number;
  kind: 'setup' | 'build';
}

/** Work the install puts on the board, because part of any real scenario is
 *  something a person still has to do. */
export interface TasksOutput {
  kind: 'tasks';
  id: string;
  /** Shown above the seeded list, e.g. "Launch checklist". */
  label: string;
  items: TemplateTask[];
}

export type TemplateOutput = WorkflowOutput | TasksOutput;

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

export interface TemplateManifest {
  /** Catalogue key, `[a-z0-9-]`. Unique per source; built-in keys are reserved. */
  key: string;
  name: string;
  summary: string;
  category: TemplateCategory;
  /** Emoji or `Icon` name shown on the card — no remote image, no CSP problem. */
  icon: string;
  /** Free tags for search. Never a second category. */
  tags: string[];
  /** Longer prose shown on the detail page, before setup starts. */
  description?: string;
  /** Integrations the installed system calls. Drives the `connect` steps and the
   *  "works with" row on the card. */
  requiredConnectors: RequiredConnector[];
  /** Secrets the running system reads, when it needs any. */
  requiredSecrets: RequiredSecret[];
  /** The guided setup, in the order it is asked. */
  steps: GuidedStep[];
  /** What installing writes. */
  outputs: TemplateOutput[];
  /** What the customer should be able to demonstrate once it is set up. */
  successCriteria: string[];
}

export class TemplateManifestError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors[0] ?? 'Invalid template manifest');
    this.name = 'TemplateManifestError';
  }
}

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const OUTPUT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** Most outputs one template may declare. An install is a single user action;
 *  a template that writes forty things is not a template, it is a migration. */
export const MAX_TEMPLATE_OUTPUTS = 8;
/** Most tickets one `tasks` output may seed — the same bound the challenge
 *  pipeline applies, for the same reason: a board nobody can read. */
export const MAX_TEMPLATE_TASKS = 12;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseWorkflowOutput(raw: Record<string, unknown>, where: string, errors: string[]): WorkflowOutput | null {
  const name = String(raw.name ?? '').trim();
  if (!name) {
    errors.push(`${where}.name: required`);
    return null;
  }
  // Accepts the stored string form as well as an object, so a manifest can be
  // round-tripped through JSON columns without a special case at each caller.
  const definition: WorkflowDefinition = typeof raw.definition === 'string'
    ? parseDefinition(raw.definition)
    : {
        nodes: Array.isArray((raw.definition as WorkflowDefinition | undefined)?.nodes)
          ? (raw.definition as WorkflowDefinition).nodes
          : [],
        edges: Array.isArray((raw.definition as WorkflowDefinition | undefined)?.edges)
          ? (raw.definition as WorkflowDefinition).edges
          : [],
      };
  const invalid = validateDefinition(definition);
  if (invalid) {
    errors.push(`${where}.definition: ${invalid}`);
    return null;
  }
  return {
    kind: 'workflow',
    id: String(raw.id ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 48),
    name,
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    definition,
  };
}

function parseTasksOutput(raw: Record<string, unknown>, where: string, errors: string[]): TasksOutput | null {
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  if (rawItems.length === 0) {
    errors.push(`${where}.items: at least one task is required`);
    return null;
  }
  if (rawItems.length > MAX_TEMPLATE_TASKS) {
    errors.push(`${where}.items: at most ${MAX_TEMPLATE_TASKS} tasks per output`);
  }
  const items: TemplateTask[] = [];
  for (const [i, item] of rawItems.slice(0, MAX_TEMPLATE_TASKS).entries()) {
    if (!isPlainObject(item)) {
      errors.push(`${where}.items[${i}]: must be an object`);
      continue;
    }
    const title = String(item.title ?? '').trim();
    if (!title) {
      errors.push(`${where}.items[${i}].title: required`);
      continue;
    }
    items.push({
      title,
      description: String(item.description ?? ''),
      order: typeof item.order === 'number' ? item.order : i,
      // Absent means `setup`, and that default is load-bearing — see TemplateTask.
      kind: item.kind === 'build' ? 'build' : 'setup',
    });
  }
  if (items.length === 0) return null;
  return {
    kind: 'tasks',
    id: String(raw.id ?? 'tasks').slice(0, 48),
    label: String(raw.label ?? 'Checklist'),
    items,
  };
}

function parseOutput(raw: unknown, index: number, errors: string[]): TemplateOutput | null {
  const where = `outputs[${index}]`;
  if (!isPlainObject(raw)) {
    errors.push(`${where}: must be an object`);
    return null;
  }
  const id = String(raw.id ?? '');
  if (id && !OUTPUT_ID_RE.test(id)) {
    errors.push(`${where}.id: must match [a-z0-9][a-z0-9_-]*`);
    return null;
  }
  switch (raw.kind) {
    case 'workflow': return parseWorkflowOutput(raw, where, errors);
    case 'tasks':    return parseTasksOutput(raw, where, errors);
    default:
      errors.push(`${where}.kind: must be one of ${TEMPLATE_OUTPUT_KINDS.join(', ')}`);
      return null;
  }
}

/**
 * Validate an untrusted manifest, reporting EVERY problem rather than the first.
 *
 * The check worth calling out is the last one: an output that binds
 * `{{setup.audience_id}}` when no step collects `audience_id` is accepted by
 * every other validator here and installs a workflow with a silently empty
 * field — a template that appears to work and quietly sends nothing. Binding
 * coverage is the difference between "the manifest parses" and "the manifest
 * produces a working system", so it is checked at author time.
 */
export function parseTemplateManifest(raw: unknown): TemplateManifest {
  const errors: string[] = [];
  if (!isPlainObject(raw)) throw new TemplateManifestError(['manifest must be a JSON object']);

  const key = String(raw.key ?? '').trim().toLowerCase();
  if (!KEY_RE.test(key)) errors.push('key: must match [a-z0-9][a-z0-9-]* and be ≤63 chars');

  const name = String(raw.name ?? '').trim();
  if (!name) errors.push('name: required');

  const category = String(raw.category ?? 'other');
  if (!isTemplateCategory(category)) errors.push(`category: must be one of ${TEMPLATE_CATEGORIES.join(', ')}`);

  const { steps, errors: stepErrors } = parseGuidedSteps(raw.steps);
  errors.push(...stepErrors);

  const rawOutputs = Array.isArray(raw.outputs) ? raw.outputs : [];
  if (rawOutputs.length === 0) errors.push('outputs: a template must produce at least one thing');
  if (rawOutputs.length > MAX_TEMPLATE_OUTPUTS) errors.push(`outputs: at most ${MAX_TEMPLATE_OUTPUTS} outputs per template`);
  const outputs: TemplateOutput[] = [];
  const seenOutputIds = new Set<string>();
  for (const [i, o] of rawOutputs.slice(0, MAX_TEMPLATE_OUTPUTS).entries()) {
    const parsed = parseOutput(o, i, errors);
    if (!parsed) continue;
    if (seenOutputIds.has(parsed.id)) {
      errors.push(`outputs[${i}].id: duplicate "${parsed.id}"`);
      continue;
    }
    seenOutputIds.add(parsed.id);
    outputs.push(parsed);
  }

  const requiredConnectors: RequiredConnector[] = [];
  for (const [i, rc] of (Array.isArray(raw.requiredConnectors) ? raw.requiredConnectors : []).entries()) {
    if (!isPlainObject(rc)) { errors.push(`requiredConnectors[${i}]: must be an object`); continue; }
    const ck = String(rc.key ?? '').trim().toLowerCase();
    if (!ck) { errors.push(`requiredConnectors[${i}].key: required`); continue; }
    requiredConnectors.push({ key: ck, label: String(rc.label ?? ck), why: String(rc.why ?? '') });
  }

  const requiredSecrets: RequiredSecret[] = [];
  for (const [i, rs] of (Array.isArray(raw.requiredSecrets) ? raw.requiredSecrets : []).entries()) {
    if (!isPlainObject(rs)) { errors.push(`requiredSecrets[${i}]: must be an object`); continue; }
    const sn = String(rs.name ?? '').trim();
    if (!sn) { errors.push(`requiredSecrets[${i}].name: required`); continue; }
    requiredSecrets.push({ name: sn, label: String(rs.label ?? sn), where: String(rs.where ?? '') });
  }

  // Binding coverage — see the doc comment. Checked against the step ids, so a
  // renamed step surfaces here rather than as an empty field after install.
  const collected = new Set(steps.map((s) => s.id));
  for (const ref of referencedBindings(outputs)) {
    if (!collected.has(ref)) errors.push(`outputs: bind {{setup.${ref}}} but no step collects "${ref}"`);
  }

  // Seeded work has to land on a board, and the board is a project's. A `tasks`
  // output with nowhere to file its tickets is the same failure mode as an
  // uncovered binding — it validates, it installs, and it writes nothing a
  // person can find — so the step that names the destination is required here
  // rather than discovered at install time.
  if (outputs.some((o) => o.kind === 'tasks')
      && !steps.some((s) => s.kind === 'resource' && s.resource === 'project')) {
    errors.push('outputs: a tasks output needs a resource step of kind "project" to file its tickets under');
  }

  if (errors.length) throw new TemplateManifestError(errors);

  return {
    key,
    name,
    summary: String(raw.summary ?? ''),
    category: category as TemplateCategory,
    icon: String(raw.icon ?? 'template').slice(0, 16),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 12) : [],
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    requiredConnectors,
    requiredSecrets,
    steps,
    outputs,
    successCriteria: Array.isArray(raw.successCriteria) ? raw.successCriteria.map(String).slice(0, 12) : [],
  };
}

/** Non-throwing variant for callers that render an error list (the authoring
 *  form, the publish endpoint, the built-in catalogue's own guard test). */
export function validateTemplateManifest(
  raw: unknown,
): { ok: true; manifest: TemplateManifest } | { ok: false; errors: string[] } {
  try {
    return { ok: true, manifest: parseTemplateManifest(raw) };
  } catch (e) {
    if (e instanceof TemplateManifestError) return { ok: false, errors: e.errors };
    return { ok: false, errors: [e instanceof Error ? e.message : 'Invalid template manifest'] };
  }
}

/**
 * The `connect` steps a manifest's `requiredConnectors` imply, for any it did
 * not write by hand.
 *
 * Declaring a required connector and then forgetting its step is the obvious
 * authoring mistake, and its symptom is the worst kind: setup completes, the
 * install succeeds, and the first run fails on a missing credential. Deriving
 * the steps means "requires Twilio" and "asks you to connect Twilio" cannot
 * disagree.
 */
export function withDerivedConnectSteps(manifest: TemplateManifest): TemplateManifest {
  const declared = new Set(
    manifest.steps.filter((s) => s.kind === 'connect').map((s) => s.connector),
  );
  const derived: GuidedStep[] = manifest.requiredConnectors
    .filter((rc) => !declared.has(rc.key))
    .map((rc) => ({
      kind: 'connect' as const,
      id: `connect_${rc.key.replace(/-/g, '_')}`.slice(0, 48),
      title: `Connect ${rc.label}`,
      help: rc.why,
      required: true,
      connector: rc.key,
      why: rc.why,
    }));
  // Connections come first: every later step that resolves a live pick-list
  // needs the credential that the connect step collects.
  return derived.length ? { ...manifest, steps: [...derived, ...manifest.steps] } : manifest;
}
