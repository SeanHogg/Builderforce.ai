/**
 * Guided setup — the step primitive, and the registry that makes it extensible.
 *
 * ── WHAT PROBLEM THIS SOLVES ────────────────────────────────────────────────
 * The platform already ships several packaged ways to start: a hiring pipeline
 * built on the ATS connectors, an omnichannel messaging system built on Twilio,
 * a dunning flow built on Stripe. Every one of them was a bespoke path — its own
 * screen, its own "have you connected the thing yet" check, its own idea of what
 * a required field is. That shape does not scale past the handful that exist,
 * and none of them could be PUBLISHED, because there was no contract describing
 * what setting one up involves.
 *
 * A guided step is that contract. A packaged starting point declares an ordered
 * list of them as DATA, and one runner walks a person through the list: it knows
 * how to render a step, how to validate an answer, and how to decide whether the
 * step is already satisfied by the workspace's live state. Adding a scenario is
 * then a manifest, not a screen.
 *
 * ── WHY A REGISTRY AND NOT A SWITCH ─────────────────────────────────────────
 * The step KINDS are the extension point. A `switch (step.kind)` in the parser,
 * a second in the validator, a third in the renderer and a fourth in the
 * installer is four places to forget when a fifth kind arrives — and the one
 * that gets forgotten is always the validator, which is the one that matters.
 * So a kind is a single registered spec carrying its own parse, its own answer
 * validation and its own satisfaction rule, and every consumer looks it up
 * rather than branching on it. A new kind is `registerGuidedStepKind(...)`.
 *
 * ── NOT `backend/hostingStrategy.SetupStep` ─────────────────────────────────
 * That type is a READINESS CHECKLIST item — "point your Twilio number at this
 * URL", displayed, ticked off, never answered. A guided step COLLECTS something
 * the install needs. The two coexist: a template's guided steps produce the
 * answers, and a materialised backend's setup steps report what is still owed.
 *
 * ── TRUST BOUNDARY ──────────────────────────────────────────────────────────
 * A step declaration is UNTRUSTED INPUT: it can arrive inside a manifest a
 * tenant authored or a third party published. Everything is validated here, at
 * parse time, and the runner consumes only the validated shape.
 */

/** A connector a packaged scenario cannot work without. */
export interface RequiredConnector {
  key: string;
  label: string;
  /** Why this system cannot work without it — shown next to the Connect button. */
  why: string;
}

/** A secret the running system reads. */
export interface RequiredSecret {
  name: string;
  label: string;
  /** Where the customer finds the value. */
  where: string;
}

/** Platform objects a step can ask a person to pick. Closed on purpose, and
 *  short on purpose: each value here is a live list the runner MUST be able to
 *  resolve, so a kind nobody resolves is a step that renders an empty picker. */
export const GUIDED_RESOURCE_KINDS = ['project', 'agent', 'workflow'] as const;
export type GuidedResourceKind = (typeof GUIDED_RESOURCE_KINDS)[number];

export function isGuidedResourceKind(v: unknown): v is GuidedResourceKind {
  return typeof v === 'string' && (GUIDED_RESOURCE_KINDS as readonly string[]).includes(v);
}

/** Input shapes a `field` step can collect. `secret` is masked and never echoed. */
export const GUIDED_FIELD_TYPES = ['text', 'multiline', 'email', 'url', 'number', 'secret'] as const;
export type GuidedFieldType = (typeof GUIDED_FIELD_TYPES)[number];

export interface GuidedStepBase {
  /** Stable id. Doubles as the answer key and as the `{{setup.<id>}}` binding. */
  id: string;
  title: string;
  /** One line under the title explaining why the step is being asked. */
  help?: string;
  /** A step that is not required may be skipped with no answer. */
  required: boolean;
}

/** Connect an integration. Satisfied by an enabled connection existing — never
 *  by an answer, because the credential lives on the connection row. */
export interface ConnectStep extends GuidedStepBase {
  kind: 'connect';
  connector: string;
  why: string;
}

export interface FieldStep extends GuidedStepBase {
  kind: 'field';
  fieldType: GuidedFieldType;
  placeholder?: string;
  /** Anchored automatically; a manifest supplies the inner expression only. */
  pattern?: string;
  min?: number;
  max?: number;
  default?: string | number;
}

export interface ChoiceOption {
  value: string;
  label: string;
  help?: string;
}

/**
 * Pick from a list. The list is either declared inline, or RESOLVED at setup
 * time by calling a connector action — which is what makes "pick the audience to
 * send to" possible without the template knowing the customer's audiences.
 */
export interface ChoiceStep extends GuidedStepBase {
  kind: 'choice';
  options?: ChoiceOption[];
  source?: {
    connector: string;
    action: string;
    /** Dot path to the option value inside each returned row. */
    valuePath: string;
    /** Dot path to the label. Falls back to the value when absent. */
    labelPath?: string;
    input?: Record<string, unknown>;
  };
  multiple?: boolean;
}

/** Pick an existing platform object (a project to file work under, an agent to
 *  run the workflow on). The runner resolves the live list. */
export interface ResourceStep extends GuidedStepBase {
  kind: 'resource';
  resource: GuidedResourceKind;
  /** Offer to create one when the workspace has none, rather than dead-ending. */
  allowCreate?: boolean;
}

/** A cadence, in the same 5-field cron + IANA timezone representation
 *  `workflow_triggers` and `qa_schedules` already use. */
export interface ScheduleStep extends GuidedStepBase {
  kind: 'schedule';
  defaultCron?: string;
  defaultTimezone?: string;
}

/** A yes/no the install branches on (e.g. "send a summary to Slack too"). */
export interface ToggleStep extends GuidedStepBase {
  kind: 'toggle';
  default?: boolean;
}

export type GuidedStep =
  | ConnectStep
  | FieldStep
  | ChoiceStep
  | ResourceStep
  | ScheduleStep
  | ToggleStep;

export type GuidedStepKind = GuidedStep['kind'];

/** The answer to one step. `null` means unanswered. */
export type GuidedAnswer = string | string[] | number | boolean | ScheduleAnswer | null;

export interface ScheduleAnswer {
  cron: string;
  timezone: string;
}

export type GuidedAnswers = Record<string, GuidedAnswer>;

/**
 * The workspace facts a step is judged against.
 *
 * Passed in rather than fetched here because this module is domain logic: the
 * same resolution must run in a route (against the database) and in a test
 * (against a literal), and a domain rule that reaches for a connection pool is a
 * rule that can only be tested through one.
 */
export interface GuidedSetupState {
  /** Connector keys with at least one ENABLED connection. */
  connectedConnectors: ReadonlySet<string>;
  /** Live pick-lists per resource kind, resolved by the caller. */
  resources: Readonly<Partial<Record<GuidedResourceKind, readonly ChoiceOption[]>>>;
  /** Options resolved from a `choice.source` connector call, keyed by step id. */
  sourcedOptions?: Readonly<Record<string, readonly ChoiceOption[]>>;
}

export const EMPTY_SETUP_STATE: GuidedSetupState = {
  connectedConnectors: new Set(),
  resources: {},
};

// ---------------------------------------------------------------------------
// The kind registry — the extension point
// ---------------------------------------------------------------------------

/** Collects declaration errors while a manifest is parsed. */
export interface StepParseContext {
  /** `steps[3]` — prefixed onto every message so an error names its step. */
  where: string;
  errors: string[];
}

export interface GuidedStepKindSpec<S extends GuidedStep = GuidedStep> {
  kind: S['kind'];
  /**
   * Validate the untrusted DECLARATION and return the normalised step, or null
   * when it cannot be repaired (errors are pushed onto the context).
   */
  parse(raw: Record<string, unknown>, base: GuidedStepBase, ctx: StepParseContext): S | null;
  /** Validate an ANSWER. Returns a human-readable problem, or null when fine. */
  validateAnswer(step: S, value: GuidedAnswer): string | null;
  /**
   * Is this step done? Defaults to "has a valid answer"; `connect` overrides it
   * because its satisfaction lives in the workspace, not in an answer.
   */
  isSatisfied(step: S, value: GuidedAnswer, state: GuidedSetupState): boolean;
  /** The value used for `{{setup.<id>}}` when the step is skipped or implicit. */
  defaultValue?(step: S): GuidedAnswer;
}

const REGISTRY = new Map<GuidedStepKind, GuidedStepKindSpec<never>>();

/**
 * Register a step kind. The one way to extend the framework — a caller supplies
 * parse + validation + satisfaction together, so a kind cannot land half-taught.
 *
 * Re-registering a kind REPLACES it, which is what lets a deployment override a
 * built-in kind without forking this file.
 */
export function registerGuidedStepKind<S extends GuidedStep>(spec: GuidedStepKindSpec<S>): void {
  REGISTRY.set(spec.kind, spec as unknown as GuidedStepKindSpec<never>);
}

export function guidedStepKindSpec(kind: string): GuidedStepKindSpec<GuidedStep> | null {
  return (REGISTRY.get(kind as GuidedStepKind) as GuidedStepKindSpec<GuidedStep> | undefined) ?? null;
}

export function registeredStepKinds(): GuidedStepKind[] {
  return [...REGISTRY.keys()];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ID_RE = /^[a-z][a-z0-9_]{0,47}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A string answer, or '' for anything that is not one. */
function asString(value: GuidedAnswer): string {
  return typeof value === 'string' ? value : '';
}

const isBlank = (value: GuidedAnswer): boolean =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

/** The default satisfaction rule: answered (when required) and valid. */
function answeredAndValid<S extends GuidedStep>(
  spec: GuidedStepKindSpec<S>,
  step: S,
  value: GuidedAnswer,
): boolean {
  if (isBlank(value)) return !step.required;
  return spec.validateAnswer(step, value) === null;
}

// ---------------------------------------------------------------------------
// Built-in kinds
// ---------------------------------------------------------------------------

const CONNECT_SPEC: GuidedStepKindSpec<ConnectStep> = {
  kind: 'connect',
  parse(raw, base, ctx) {
    const connector = String(raw.connector ?? '').trim().toLowerCase();
    if (!connector) {
      ctx.errors.push(`${ctx.where}.connector: required for a connect step`);
      return null;
    }
    return {
      ...base,
      kind: 'connect',
      connector,
      why: String(raw.why ?? base.help ?? ''),
    };
  },
  // A connect step has no answer to validate — the credential is collected by
  // the connector's own form, which owns its field rules.
  validateAnswer: () => null,
  isSatisfied: (step, _value, state) =>
    state.connectedConnectors.has(step.connector) || !step.required,
};

const FIELD_SPEC: GuidedStepKindSpec<FieldStep> = {
  kind: 'field',
  parse(raw, base, ctx) {
    const fieldType = String(raw.fieldType ?? 'text') as GuidedFieldType;
    if (!GUIDED_FIELD_TYPES.includes(fieldType)) {
      ctx.errors.push(`${ctx.where}.fieldType: must be one of ${GUIDED_FIELD_TYPES.join(', ')}`);
      return null;
    }
    // An unanchored pattern would accept anything CONTAINING a match, which is
    // the opposite of what a manifest author writing `\d{4}` intends.
    const pattern = typeof raw.pattern === 'string' ? raw.pattern : undefined;
    if (pattern) {
      try {
        new RegExp(pattern);
      } catch {
        ctx.errors.push(`${ctx.where}.pattern: not a valid regular expression`);
        return null;
      }
    }
    return {
      ...base,
      kind: 'field',
      fieldType,
      ...(typeof raw.placeholder === 'string' ? { placeholder: raw.placeholder } : {}),
      ...(pattern ? { pattern } : {}),
      ...(typeof raw.min === 'number' ? { min: raw.min } : {}),
      ...(typeof raw.max === 'number' ? { max: raw.max } : {}),
      ...(typeof raw.default === 'string' || typeof raw.default === 'number'
        ? { default: raw.default }
        : {}),
    };
  },
  validateAnswer(step, value) {
    if (isBlank(value)) return step.required ? 'This is required.' : null;
    if (step.fieldType === 'number') {
      const n = typeof value === 'number' ? value : Number(asString(value));
      if (!Number.isFinite(n)) return 'Enter a number.';
      if (step.min !== undefined && n < step.min) return `Must be at least ${step.min}.`;
      if (step.max !== undefined && n > step.max) return `Must be at most ${step.max}.`;
      return null;
    }
    const text = asString(value);
    if (!text) return step.required ? 'This is required.' : null;
    if (step.min !== undefined && text.length < step.min) return `Must be at least ${step.min} characters.`;
    if (step.max !== undefined && text.length > step.max) return `Must be at most ${step.max} characters.`;
    if (step.fieldType === 'email' && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(text)) return 'Enter a valid email address.';
    if (step.fieldType === 'url') {
      // Only https is offered: a template's answer becomes a webhook target or a
      // request the runtime makes, and http would silently downgrade it.
      try {
        if (new URL(text).protocol !== 'https:') return 'Enter an https:// URL.';
      } catch {
        return 'Enter a valid URL.';
      }
    }
    if (step.pattern && !new RegExp(`^(?:${step.pattern})$`).test(text)) return 'This value is not in the expected format.';
    return null;
  },
  isSatisfied: (step, value) => answeredAndValid(FIELD_SPEC, step, value),
  defaultValue: (step) => step.default ?? null,
};

const CHOICE_SPEC: GuidedStepKindSpec<ChoiceStep> = {
  kind: 'choice',
  parse(raw, base, ctx) {
    const options: ChoiceOption[] = [];
    for (const [i, o] of (Array.isArray(raw.options) ? raw.options : []).entries()) {
      if (!isPlainObject(o)) {
        ctx.errors.push(`${ctx.where}.options[${i}]: must be an object`);
        continue;
      }
      const value = String(o.value ?? '');
      if (!value) {
        ctx.errors.push(`${ctx.where}.options[${i}].value: required`);
        continue;
      }
      options.push({
        value,
        label: String(o.label ?? value),
        ...(typeof o.help === 'string' ? { help: o.help } : {}),
      });
    }

    let source: ChoiceStep['source'];
    if (isPlainObject(raw.source)) {
      const connector = String(raw.source.connector ?? '').trim().toLowerCase();
      const action = String(raw.source.action ?? '').trim();
      const valuePath = String(raw.source.valuePath ?? '').trim();
      if (!connector || !action || !valuePath) {
        ctx.errors.push(`${ctx.where}.source: connector, action and valuePath are all required`);
        return null;
      }
      source = {
        connector,
        action,
        valuePath,
        ...(typeof raw.source.labelPath === 'string' ? { labelPath: raw.source.labelPath } : {}),
        ...(isPlainObject(raw.source.input) ? { input: raw.source.input } : {}),
      };
    }

    if (options.length === 0 && !source) {
      ctx.errors.push(`${ctx.where}: a choice step needs either options or a source`);
      return null;
    }
    return {
      ...base,
      kind: 'choice',
      ...(options.length ? { options } : {}),
      ...(source ? { source } : {}),
      ...(raw.multiple === true ? { multiple: true } : {}),
    };
  },
  validateAnswer(step, value) {
    if (isBlank(value)) return step.required ? 'Pick one.' : null;
    const picked = Array.isArray(value) ? value.map(String) : [asString(value)];
    if (!step.multiple && picked.length > 1) return 'Pick a single option.';
    // A sourced list is resolved live, so its membership is checked by the
    // runner (which HAS the resolved options) rather than asserted here against
    // a list this module never saw.
    if (step.options) {
      const allowed = new Set(step.options.map((o) => o.value));
      const stray = picked.find((p) => !allowed.has(p));
      if (stray) return `"${stray}" is not one of the options.`;
    }
    return null;
  },
  isSatisfied: (step, value) => answeredAndValid(CHOICE_SPEC, step, value),
};

const RESOURCE_SPEC: GuidedStepKindSpec<ResourceStep> = {
  kind: 'resource',
  parse(raw, base, ctx) {
    const resource = String(raw.resource ?? '');
    if (!isGuidedResourceKind(resource)) {
      ctx.errors.push(`${ctx.where}.resource: must be one of ${GUIDED_RESOURCE_KINDS.join(', ')}`);
      return null;
    }
    return {
      ...base,
      kind: 'resource',
      resource,
      ...(raw.allowCreate === true ? { allowCreate: true } : {}),
    };
  },
  validateAnswer(step, value) {
    if (isBlank(value)) return step.required ? 'Pick one.' : null;
    return typeof value === 'string' || typeof value === 'number' ? null : 'Pick one.';
  },
  isSatisfied: (step, value) => answeredAndValid(RESOURCE_SPEC, step, value),
};

/** 5-field cron, the same grammar `domain/workflowSchedule` parses. */
const CRON_RE = /^(\S+\s+){4}\S+$/;

const SCHEDULE_SPEC: GuidedStepKindSpec<ScheduleStep> = {
  kind: 'schedule',
  parse(raw, base, ctx) {
    const defaultCron = typeof raw.defaultCron === 'string' ? raw.defaultCron.trim() : undefined;
    if (defaultCron && !CRON_RE.test(defaultCron)) {
      ctx.errors.push(`${ctx.where}.defaultCron: must be a 5-field cron expression`);
      return null;
    }
    return {
      ...base,
      kind: 'schedule',
      ...(defaultCron ? { defaultCron } : {}),
      ...(typeof raw.defaultTimezone === 'string' ? { defaultTimezone: raw.defaultTimezone } : {}),
    };
  },
  validateAnswer(step, value) {
    if (isBlank(value)) return step.required ? 'Choose when this runs.' : null;
    if (!isPlainObject(value)) return 'Choose when this runs.';
    const cron = String((value as unknown as ScheduleAnswer).cron ?? '');
    if (!CRON_RE.test(cron)) return 'That is not a valid 5-field cron expression.';
    return null;
  },
  isSatisfied: (step, value) => answeredAndValid(SCHEDULE_SPEC, step, value),
  defaultValue: (step) =>
    step.defaultCron
      ? { cron: step.defaultCron, timezone: step.defaultTimezone ?? 'UTC' }
      : null,
};

const TOGGLE_SPEC: GuidedStepKindSpec<ToggleStep> = {
  kind: 'toggle',
  parse(raw, base) {
    return {
      ...base,
      kind: 'toggle',
      // A toggle is never "required": false IS an answer. Forcing one would make
      // the runner demand that somebody turn an optional extra ON to continue.
      required: false,
      ...(typeof raw.default === 'boolean' ? { default: raw.default } : {}),
    };
  },
  validateAnswer: (_step, value) =>
    value === null || typeof value === 'boolean' ? null : 'Choose yes or no.',
  isSatisfied: () => true,
  defaultValue: (step) => step.default ?? false,
};

registerGuidedStepKind(CONNECT_SPEC);
registerGuidedStepKind(FIELD_SPEC);
registerGuidedStepKind(CHOICE_SPEC);
registerGuidedStepKind(RESOURCE_SPEC);
registerGuidedStepKind(SCHEDULE_SPEC);
registerGuidedStepKind(TOGGLE_SPEC);

// ---------------------------------------------------------------------------
// Parsing a declared step list
// ---------------------------------------------------------------------------

/** Most steps one guided setup may declare. A wizard longer than this is a
 *  product problem, and an unbounded list is a denial-of-service on the runner. */
export const MAX_GUIDED_STEPS = 24;

/**
 * Validate an untrusted step list. Returns the normalised steps and EVERY
 * problem found — a wizard-authoring form shows them all at once.
 */
export function parseGuidedSteps(raw: unknown): { steps: GuidedStep[]; errors: string[] } {
  const errors: string[] = [];
  const input = Array.isArray(raw) ? raw : [];
  if (input.length > MAX_GUIDED_STEPS) {
    errors.push(`steps: at most ${MAX_GUIDED_STEPS} steps per template`);
  }

  const steps: GuidedStep[] = [];
  const seen = new Set<string>();
  for (const [i, item] of input.slice(0, MAX_GUIDED_STEPS).entries()) {
    const where = `steps[${i}]`;
    if (!isPlainObject(item)) {
      errors.push(`${where}: must be an object`);
      continue;
    }
    const id = String(item.id ?? '').trim();
    if (!ID_RE.test(id)) {
      errors.push(`${where}.id: must match [a-z][a-z0-9_]* (got "${id}")`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`${where}.id: duplicate "${id}"`);
      continue;
    }
    const kind = String(item.kind ?? '');
    const spec = guidedStepKindSpec(kind);
    if (!spec) {
      errors.push(`${where}.kind: unknown step kind "${kind}" (known: ${registeredStepKinds().join(', ')})`);
      continue;
    }
    const base: GuidedStepBase = {
      id,
      title: String(item.title ?? id),
      ...(typeof item.help === 'string' ? { help: item.help } : {}),
      required: item.required !== false,
    };
    const parsed = spec.parse(item, base, { where, errors });
    if (!parsed) continue;
    seen.add(id);
    steps.push(parsed);
  }
  return { steps, errors };
}
