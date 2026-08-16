/**
 * The guided-setup RUNNER — one walk over a declared step list, shared by every
 * packaged scenario.
 *
 * Two jobs, and they are deliberately the only two:
 *
 *   1. RESOLVE — given the declared steps, the answers so far, and what is true
 *      in the workspace, say which steps are satisfied, which are blocked and
 *      what is wrong with each unsatisfied one. The wizard renders that; the
 *      install endpoint re-runs the identical function before writing anything.
 *      Running the SAME resolution in both places is the point: a wizard that
 *      validates on the client and an install that trusts it is how a template
 *      lands half-configured.
 *
 *   2. BIND — substitute the collected answers into the payloads the install
 *      materialises (`{{setup.audience_id}}` inside a workflow node's config).
 *      Templating rather than code is what keeps a template pure data, which is
 *      what lets a third party publish one.
 *
 * Both are pure functions over values the caller supplies, so the whole
 * framework is testable without a database.
 */

import {
  guidedStepKindSpec,
  type ChoiceOption,
  type GuidedAnswer,
  type GuidedAnswers,
  type GuidedSetupState,
  type GuidedStep,
  type ScheduleAnswer,
} from './guidedStep';

export interface ResolvedGuidedStep {
  step: GuidedStep;
  /** Nothing more is owed on this step. */
  satisfied: boolean;
  /** Why it is not satisfied — null when it is, or when nothing has been tried. */
  error: string | null;
  /** The answer in play, including a kind's default when none was given. */
  value: GuidedAnswer;
  /** The pick-list a `choice`/`resource` step renders, resolved for the caller. */
  options?: readonly ChoiceOption[];
}

export interface GuidedPlan {
  steps: ResolvedGuidedStep[];
  /** Every required step is satisfied — the install may proceed. */
  complete: boolean;
  /** Step ids still standing in the way, in declaration order. */
  blockedBy: string[];
  /** Connector keys a `connect` step still needs, so the UI can offer them
   *  together rather than one modal at a time. */
  missingConnectors: string[];
}

/** The effective value for a step: the answer, or the kind's declared default. */
export function effectiveValue(step: GuidedStep, answers: GuidedAnswers): GuidedAnswer {
  const given = answers[step.id];
  if (given !== undefined && given !== null && given !== '') return given;
  const spec = guidedStepKindSpec(step.kind);
  return spec?.defaultValue?.(step) ?? (given ?? null);
}

/** The pick-list for a step, if it has one. Sourced options win over inline ones
 *  because a live list is the whole reason a step declared a source. */
function optionsFor(step: GuidedStep, state: GuidedSetupState): readonly ChoiceOption[] | undefined {
  if (step.kind === 'choice') {
    return state.sourcedOptions?.[step.id] ?? step.options;
  }
  if (step.kind === 'resource') {
    return state.resources[step.resource] ?? [];
  }
  return undefined;
}

/**
 * Resolve a step list against answers and live workspace state.
 *
 * `touched` decides whether an unanswered required step reads as an ERROR or
 * merely as unfinished. A wizard that paints every field red before the person
 * has typed anything is hostile; an install that stays quiet about a missing
 * required answer is broken. So the caller says which it is: the wizard passes
 * the ids it has visited, the install passes every id.
 */
export function resolveGuidedPlan(
  steps: readonly GuidedStep[],
  answers: GuidedAnswers,
  state: GuidedSetupState,
  touched?: ReadonlySet<string>,
): GuidedPlan {
  const resolved: ResolvedGuidedStep[] = [];
  const blockedBy: string[] = [];
  const missingConnectors: string[] = [];

  for (const step of steps) {
    const spec = guidedStepKindSpec(step.kind);
    const value = effectiveValue(step, answers);
    const options = optionsFor(step, state);

    // An unknown kind can only arise if a manifest outlived a registry change.
    // Treating it as unsatisfiable is the honest answer: the install cannot
    // collect what nothing knows how to validate.
    if (!spec) {
      resolved.push({ step, satisfied: false, error: `Unsupported step type "${step.kind}".`, value, ...(options ? { options } : {}) });
      blockedBy.push(step.id);
      continue;
    }

    let error = spec.validateAnswer(step, value);
    // A sourced choice is checked against the list that was actually resolved —
    // the declaration never saw it, so `guidedStep` deliberately does not.
    if (!error && step.kind === 'choice' && state.sourcedOptions?.[step.id] && value != null && value !== '') {
      const allowed = new Set(state.sourcedOptions[step.id]!.map((o) => o.value));
      const picked = Array.isArray(value) ? value.map(String) : [String(value)];
      const stray = picked.find((p) => !allowed.has(p));
      if (stray) error = `"${stray}" is no longer available — pick again.`;
    }

    const satisfied = spec.isSatisfied(step, value, state) && !error;
    const visible = touched === undefined || touched.has(step.id);

    if (step.kind === 'connect' && !state.connectedConnectors.has(step.connector)) {
      if (step.required) missingConnectors.push(step.connector);
      if (!satisfied) error = error ?? 'Connect this integration to continue.';
    }

    resolved.push({
      step,
      satisfied,
      error: satisfied || !visible ? null : error ?? (step.required ? 'This is required.' : null),
      value,
      ...(options ? { options } : {}),
    });
    if (!satisfied && step.required) blockedBy.push(step.id);
  }

  return {
    steps: resolved,
    complete: blockedBy.length === 0,
    blockedBy,
    missingConnectors: [...new Set(missingConnectors)],
  };
}

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

const BINDING_RE = /\{\{\s*setup\.([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?\s*\}\}/gi;

/** Render one answer as the text a binding substitutes. */
function bindingText(value: GuidedAnswer, field?: string): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'object') {
    const schedule = value as ScheduleAnswer;
    if (field === 'timezone') return schedule.timezone ?? '';
    return schedule.cron ?? '';
  }
  return String(value);
}

/**
 * Substitute `{{setup.<id>}}` throughout a payload.
 *
 * Whole-string bindings preserve TYPE: a `{{setup.retry_limit}}` that is the
 * entire value comes back as the number 3, not the string "3", because the
 * thing on the other side is a connector param with a declared type and a
 * stringified number fails its schema. Embedded bindings ("Hi {{setup.name}}")
 * are text by definition.
 */
export function bindAnswers<T>(payload: T, answers: GuidedAnswers): T {
  const bind = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const whole = node.match(/^\{\{\s*setup\.([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?\s*\}\}$/i);
      if (whole) {
        const value = answers[whole[1]!];
        if (value == null) return '';
        if (whole[2]) return bindingText(value, whole[2]);
        return typeof value === 'object' && !Array.isArray(value) ? bindingText(value) : value;
      }
      return node.replace(BINDING_RE, (_m, id: string, field?: string) => bindingText(answers[id] ?? null, field));
    }
    if (Array.isArray(node)) return node.map(bind);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = bind(v);
      return out;
    }
    return node;
  };
  return bind(payload) as T;
}

/** Every `{{setup.x}}` id referenced anywhere in a payload. Used to reject a
 *  manifest whose outputs bind an answer no step collects — which would install
 *  a workflow with a silently empty field. */
export function referencedBindings(payload: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      for (const m of node.matchAll(BINDING_RE)) found.add(m[1]!);
      return;
    }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === 'object') Object.values(node as Record<string, unknown>).forEach(walk);
  };
  walk(payload);
  return [...found];
}
