/**
 * The declarative handler executor — one function that runs any {@link HandlerSpec}.
 *
 * Every project backend on the `declarative` strategy runs through here, which is
 * the point: the step budget, the template scope, the connector call path and the
 * response shaping are written once and a handler cannot opt out of them.
 *
 * Dependencies (the model call, the connector call) are INJECTED rather than
 * imported, so the whole execution path is unit-testable without a gateway, a
 * database or a network — and so the same executor can later be driven by the
 * container adapter without a rewrite.
 *
 * ── FAILURE POSTURE ─────────────────────────────────────────────────────────
 * A step that fails does NOT abort the handler. This is deliberate and specific
 * to the domain: a Twilio webhook that returns 500 makes Twilio drop the call or
 * retry the message, so the caller hears silence. Far better to record the failed
 * step, bind an empty value to its id, and still return a well-formed reply — a
 * "sorry, something went wrong" heard by the caller beats a dropped call, and the
 * failure is in `project_backend_requests` either way.
 */

import type { ConnectorCallResult } from '../connectors/connectorRuntime';
import type { HandlerCollectionRead } from '../ide/siteData';
import { renderTwiml, TWIML_CONTENT_TYPE, type TwimlNode } from './twiml';
import type { HandlerSpec, HandlerStep } from './handlerSpec';

/** Hard ceiling on steps actually executed. A spec may declare more; the excess is
 *  reported as skipped rather than run — a webhook has seconds, not minutes. */
export const MAX_EXECUTED_STEPS = 12;

export interface HandlerRuntimeDeps {
  /** One model turn. Returns the reply text (empty string on a soft failure). */
  llm(args: { system?: string; prompt: string; maxTokens?: number; temperature?: number }): Promise<string>;
  /** One connector action, already scoped to the tenant. */
  callConnector(args: {
    connector: string;
    actionKey: string;
    input: Record<string, unknown>;
    connectionId?: string | null;
  }): Promise<ConnectorCallResult>;
  /** Read the project's own site collection, already scoped to tenant+project. */
  readCollection(args: {
    collection: string;
    limit?: number;
    match?: { field: string; value: string } | undefined;
  }): Promise<HandlerCollectionRead>;
}

/**
 * What a template can read. Note the absence of `secrets` — see the scope note in
 * handlerSpec.ts. `project.ingressUrl` is here so a spec can build the absolute
 * callback URLs Twilio's `<Gather action>` and `<Dial action>` need without the
 * author having to know their own ingress token.
 */
export interface HandlerContext {
  body: Record<string, unknown>;
  query: Record<string, string>;
  headers: Record<string, string>;
  project: { id: number; name: string; ingressUrl: string };
}

export interface StepOutcome {
  id: string;
  kind: HandlerStep['kind'];
  ok: boolean;
  skipped?: boolean;
  error?: string;
  durationMs: number;
}

export interface HandlerExecution {
  status: number;
  headers: Record<string, string>;
  body: string;
  steps: StepOutcome[];
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATE_RE = /\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}/g;
/** A template that is the ENTIRE string — the case where a non-string result survives. */
const WHOLE_TEMPLATE_RE = /^\{\{\s*([a-zA-Z0-9_.[\]]+)\s*\}\}$/;

/** Read a dotted/bracketed path out of the scope. Missing → undefined, never throws. */
export function resolvePath(scope: Record<string, unknown>, path: string): unknown {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce<unknown>((acc, key) => {
      if (acc == null) return undefined;
      if (Array.isArray(acc)) return acc[Number(key)];
      if (typeof acc === 'object') return (acc as Record<string, unknown>)[key];
      return undefined;
    }, scope);
}

/** Stringify a resolved value for interpolation. Missing renders as empty, NOT
 *  as "undefined" — an unset `{{body.Digits}}` in an SMS body must not be visible
 *  to the customer as the word "undefined". */
function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/** Interpolate a template string. Always returns a string. */
export function renderTemplate(template: string, scope: Record<string, unknown>): string {
  return template.replace(TEMPLATE_RE, (_m, path: string) => stringify(resolvePath(scope, path)));
}

/**
 * Render a value of any shape. A string that is EXACTLY one template resolves to
 * the underlying value with its type intact (so `"input": { "media": "{{steps.urls}}" }`
 * passes an array through), while an embedded template stringifies.
 */
export function renderValue(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_TEMPLATE_RE);
    if (whole) {
      const resolved = resolvePath(scope, whole[1]!);
      return resolved === undefined ? '' : resolved;
    }
    return renderTemplate(value, scope);
  }
  if (Array.isArray(value)) return value.map((v) => renderValue(v, scope));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = renderValue(v, scope);
    return out;
  }
  return value;
}

/** Values a rendered `when` treats as false. Everything else (any non-empty text) is true. */
const FALSEY = new Set(['', 'false', '0', 'null', 'undefined', 'no', 'off']);

export function evaluateWhen(when: string | undefined, scope: Record<string, unknown>): boolean {
  if (!when) return true;
  return !FALSEY.has(renderTemplate(when, scope).trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

async function runStep(
  step: HandlerStep,
  scope: Record<string, unknown>,
  deps: HandlerRuntimeDeps,
): Promise<{ value: unknown; error?: string }> {
  switch (step.kind) {
    case 'set':
      return { value: renderTemplate(step.value, scope) };

    case 'llm': {
      const text = await deps.llm({
        ...(step.system ? { system: renderTemplate(step.system, scope) } : {}),
        prompt: renderTemplate(step.prompt, scope),
        ...(step.maxTokens !== undefined ? { maxTokens: step.maxTokens } : {}),
        ...(step.temperature !== undefined ? { temperature: step.temperature } : {}),
      });
      return { value: text };
    }

    case 'connector': {
      const input = (renderValue(step.input ?? {}, scope) ?? {}) as Record<string, unknown>;
      const result = await deps.callConnector({
        connector: step.connector,
        actionKey: step.actionKey,
        input,
        ...(step.connectionId !== undefined ? { connectionId: step.connectionId } : {}),
      });
      // The DATA is what a later template wants (`{{steps.sent.sid}}`); the ok/error
      // are surfaced to the outcome list rather than buried in the bound value.
      return { value: result.data, ...(result.ok ? {} : { error: result.error ?? `Connector returned ${result.status}` }) };
    }

    case 'data': {
      const field = step.matchField ? renderTemplate(step.matchField, scope) : '';
      const read = await deps.readCollection({
        collection: renderTemplate(step.collection, scope),
        ...(step.limit !== undefined ? { limit: step.limit } : {}),
        match: field ? { field, value: renderTemplate(step.matchValue ?? '', scope) } : undefined,
      });
      // An unknown collection binds an EMPTY read rather than failing the handler,
      // so `{{#steps.rows.count}}`-style branching still works and the page
      // renders its empty state; the reason lands in the outcome list.
      return { value: read, ...(read.error ? { error: read.error } : {}) };
    }
  }
}

/** Shape the spec's `respond` block into a concrete HTTP response. */
function buildResponse(spec: HandlerSpec, scope: Record<string, unknown>): Omit<HandlerExecution, 'steps'> {
  switch (spec.respond.kind) {
    case 'twiml': {
      const nodes = renderValue(spec.respond.nodes, scope) as TwimlNode[];
      return { status: 200, headers: { 'Content-Type': TWIML_CONTENT_TYPE }, body: renderTwiml(nodes) };
    }
    case 'json': {
      const body = renderValue(spec.respond.body, scope);
      return { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
    }
    case 'text':
      return {
        status: 200,
        headers: { 'Content-Type': spec.respond.contentType ?? 'text/plain; charset=utf-8' },
        body: renderTemplate(spec.respond.text, scope),
      };
    case 'empty':
      return { status: spec.respond.status ?? 204, headers: {}, body: '' };
  }
}

/**
 * Run a handler end to end.
 *
 * Steps execute IN ORDER and each binds its result to `steps.<id>` before the
 * next renders — that sequencing is the whole reason a step has an id, and it is
 * what lets "classify the message, then send a reply containing the
 * classification" be two steps instead of one bespoke feature.
 */
export async function executeHandler(
  spec: HandlerSpec,
  ctx: HandlerContext,
  deps: HandlerRuntimeDeps,
): Promise<HandlerExecution> {
  const steps: Record<string, unknown> = {};
  const scope: Record<string, unknown> = {
    body: ctx.body,
    query: ctx.query,
    headers: ctx.headers,
    project: ctx.project,
    steps,
  };
  const outcomes: StepOutcome[] = [];

  for (const [index, step] of spec.steps.entries()) {
    if (index >= MAX_EXECUTED_STEPS) {
      outcomes.push({ id: step.id, kind: step.kind, ok: false, skipped: true, durationMs: 0, error: `Step budget of ${MAX_EXECUTED_STEPS} exceeded` });
      steps[step.id] = '';
      continue;
    }
    if (!evaluateWhen(step.when, scope)) {
      outcomes.push({ id: step.id, kind: step.kind, ok: true, skipped: true, durationMs: 0 });
      steps[step.id] = '';
      continue;
    }

    const started = Date.now();
    try {
      const { value, error } = await runStep(step, scope, deps);
      steps[step.id] = value ?? '';
      outcomes.push({
        id: step.id,
        kind: step.kind,
        ok: !error,
        durationMs: Date.now() - started,
        ...(error ? { error } : {}),
      });
    } catch (e) {
      // A thrown step binds empty and the handler continues — see the failure
      // posture note at the top of this file.
      steps[step.id] = '';
      outcomes.push({
        id: step.id,
        kind: step.kind,
        ok: false,
        durationMs: Date.now() - started,
        error: e instanceof Error ? e.message : 'Step failed',
      });
    }
  }

  return { ...buildResponse(spec, scope), steps: outcomes };
}
