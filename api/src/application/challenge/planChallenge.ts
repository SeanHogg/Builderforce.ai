/**
 * {@link ChallengeSpec} → {@link ChallengePlan}: what the platform will actually
 * build, decided before anything is written.
 *
 * Planning is a separate step from building on purpose. A brief is read by a
 * model, and a model's reading of "what winning requires" is exactly the thing a
 * human should check BEFORE thirty files and a board full of tickets exist. So
 * the plan is a value the customer can look at, argue with and re-run, and
 * materialising it is a second, explicit act.
 *
 * ── THE TWO PATHS ───────────────────────────────────────────────────────────
 * When a specific blueprint matched, its handlers ARE the plan — hand-written,
 * tested, correct about the things models get wrong. When nothing matched, the
 * model designs handlers against the same contract, and every one of them is put
 * through {@link parseHandlerSpec} before it can enter the plan. A generated
 * handler that does not parse is DROPPED with a warning rather than written,
 * because a handler file that fails to parse at request time produces a 404 whose
 * cause is invisible from the provider's side.
 */

import { parseHandlerSpec } from '../backend/handlerSpec';
import type { BackendStrategyKey } from '../backend/hostingStrategy';
import type { LlmComplete } from '../compile';
import { BUILTIN_CONNECTOR_LIST } from '../connectors/defaults';
import type { BlueprintTask, RequiredConnector, RequiredSecret } from './blueprint';
import { matchBlueprint } from './blueprints';
import type { ChallengeSpec } from './parseBrief';

export interface ConsideredBlueprint {
  key: string;
  name: string;
  score: number;
  reasons: string[];
}

export interface ChallengePlan {
  blueprintKey: string;
  blueprintName: string;
  matchScore: number;
  matchReasons: string[];
  considered: ConsideredBlueprint[];
  strategy: BackendStrategyKey;
  summary: string;
  /** Non-handler canvas files. */
  files: Record<string, string>;
  /** `handlers/<name>.json` documents. */
  handlers: Record<string, unknown>;
  /** Generated handlers that were rejected, and why. Shown, never swallowed. */
  handlerWarnings: string[];
  tasks: BlueprintTask[];
  requiredConnectors: RequiredConnector[];
  requiredSecrets: RequiredSecret[];
  successCriteria: string[];
}

/** Connector keys a generated plan may reference — the built-in catalog. */
const CONNECTOR_INDEX = new Map(BUILTIN_CONNECTOR_LIST.map((m) => [m.key, m]));

const DESIGN_SYSTEM = `You design the SERVER-SIDE half of a system from a challenge brief.

You return handlers. A handler is JSON that answers one HTTP request. Return ONLY
minified JSON, no prose, no code fence, with this shape:
{"summary":string,"handlers":[Handler],"tasks":[{"title":string,"description":string}],"connectors":[string],"secrets":[{"name":string,"label":string,"where":string}]}

Handler:
{"name":string,"route":"/path","method":"GET"|"POST"|"PUT"|"PATCH"|"DELETE"|"ANY",
 "verify":"none"|"twilio"|"stripe"|"shopify"|"shared-secret","description":string,
 "cors":[string] (OPTIONAL),"steps":[Step],"respond":Respond}

Step is ONE of:
 {"kind":"llm","id":string,"system":string,"prompt":string,"maxTokens":number}
 {"kind":"connector","id":string,"connector":string,"action":string,"input":object}
 {"kind":"set","id":string,"value":string}
 {"kind":"data","id":string,"collection":string,"limit":number,"matchField":string,"matchValue":string}
Any step may carry "when":string — it runs only if that template renders non-empty.

Respond is ONE of:
 {"kind":"twiml","twiml":[node]}   nodes: {"message":str} {"say":str} {"gather":{"action":str,"numDigits":n,"prompts":[{"say":str}]}} {"dial":str} {"hangup":true} {"pause":n}
 {"kind":"json","body":object}
 {"kind":"text","text":string}
 {"kind":"empty","status":number}

Templates are {{...}} and may read: body.*, query.*, headers.*, steps.<id>, project.name, project.ingressUrl.
Templates CANNOT read secrets — never write {{secrets.X}}.

Hard rules:
- "verify" is REQUIRED on every handler. Use "twilio" for any Twilio webhook (SMS,
  voice, WhatsApp, status). Use "none" ONLY for an endpoint that is safe to call
  anonymously. An unverified endpoint that spends money or sends messages is wrong.
- "cors" is OPTIONAL and lists the origins a BROWSER may call the handler from,
  e.g. ["https://app.example.com"]. OMIT IT unless the brief says the frontend is
  hosted somewhere else (its own CDN, a native app, an existing site) — the
  project's own published site calls its handlers same-origin and needs none.
  Never write ["*"] unless the brief explicitly asks for a public open API.
- "data" reads back what the project's own site collected — use it to render a
  page or a list from a collection a form on the site writes to.
- "connector" must be one of the allowed keys given in the user message, and
  "action" must be one of that connector's listed actions. Do not invent either.
- Step ids are lowercase identifiers, unique within the handler.
- Prefer few handlers that do real work over many stubs. At most 8.
- tasks: 3-8 tickets, concrete and checkable, each with a "kind":
    "setup" — only a person can do it (connect an account, paste a URL into a
             provider console, verify a sender, obtain a credential).
    "build" — a coding agent can do it from the ticket text alone (write a page,
             add a handler, extend the console, add a test).
  Get this right: a "build" ticket is dispatched to an agent automatically, so
  labelling "go and connect your Twilio account" as build wastes a run.
- secrets: only values the RUNTIME needs (e.g. a signature-verification token).
  Connector credentials are NOT secrets here — they live on the connection.`;

/** A compact catalog the model can design against, without flooding the prompt. */
function connectorCatalogPrompt(spec: ChallengeSpec): string {
  const mentioned = spec.integrations.map((i) => i.toLowerCase());
  const relevant = BUILTIN_CONNECTOR_LIST.filter(
    (m) => mentioned.some((v) => m.key.includes(v) || m.name.toLowerCase().includes(v)),
  );
  // Fall back to the whole catalog only when the brief named nothing we recognise;
  // otherwise a long list invites the model to reach for an unrelated system.
  const list = relevant.length ? relevant : BUILTIN_CONNECTOR_LIST;
  return list
    .map((m) => `${m.key}: ${m.actions.map((a) => a.key).join(', ')}`)
    .join('\n');
}

const asStrings = (v: unknown, cap = 12): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim()).slice(0, cap) : [];

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** File-name-safe handler key. */
function handlerFileName(name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || `handler-${index + 1}`;
}

/**
 * Validate one generated handler.
 *
 * Two checks beyond the parser: the connector key must exist in the catalog, and
 * the action must exist on it. A model hallucinating `twilio.send_voicemail`
 * produces a handler that parses perfectly and fails at 3am on a live call, so it
 * is rejected here where the cost is a warning.
 */
function validateGeneratedHandler(raw: unknown, index: number): { name: string; spec: unknown } | { error: string } {
  const name = (raw && typeof raw === 'object' && typeof (raw as { name?: unknown }).name === 'string'
    ? (raw as { name: string }).name
    : `handler-${index + 1}`);
  const fileName = handlerFileName(name, index);

  const parsed = parseHandlerSpec(raw, fileName);
  if (!parsed.ok) return { error: `Dropped generated handler "${name}": ${parsed.reason}` };

  for (const step of parsed.spec.steps) {
    if (step.kind !== 'connector') continue;
    const manifest = CONNECTOR_INDEX.get(step.connector);
    if (!manifest) {
      return { error: `Dropped generated handler "${name}": unknown connector "${step.connector}"` };
    }
    if (!manifest.actions.some((a) => a.key === step.actionKey)) {
      return { error: `Dropped generated handler "${name}": "${step.connector}" has no action "${step.actionKey}"` };
    }
  }
  return { name: fileName, spec: raw };
}

/** Connector requirement rows for keys a plan references. */
function connectorRequirements(keys: readonly string[], spec: ChallengeSpec): RequiredConnector[] {
  const out: RequiredConnector[] = [];
  for (const key of new Set(keys)) {
    const manifest = CONNECTOR_INDEX.get(key);
    if (!manifest) continue;
    out.push({
      key,
      label: manifest.name,
      why: `The plan calls ${manifest.name} to deliver ${spec.capabilities.slice(0, 3).join(', ') || 'the brief'}. Handlers that call it fail closed until a connection exists.`,
    });
  }
  return out;
}

/**
 * Build the plan.
 *
 * The blueprint path is synchronous and deterministic; only the generic path
 * needs the model. A failure in the generic path degrades to the blueprint's own
 * skeleton — a workspace with a live health endpoint — rather than to an error,
 * because a customer who pasted a brief should always end up with something they
 * can open.
 */
export async function planChallenge(spec: ChallengeSpec, briefText: string, llm?: LlmComplete): Promise<ChallengePlan> {
  const { chosen, considered } = matchBlueprint(spec.capabilities, briefText);
  const blueprint = chosen.blueprint;

  const base: ChallengePlan = {
    blueprintKey: blueprint.key,
    blueprintName: blueprint.name,
    matchScore: Number(chosen.score.toFixed(2)),
    matchReasons: chosen.reasons,
    considered: considered.map((m) => ({
      key: m.blueprint.key,
      name: m.blueprint.name,
      score: Number(m.score.toFixed(2)),
      reasons: m.reasons,
    })),
    strategy: blueprint.strategy,
    summary: blueprint.summary,
    files: { ...blueprint.files },
    handlers: { ...blueprint.handlers },
    handlerWarnings: [],
    tasks: [...blueprint.tasks],
    requiredConnectors: [...blueprint.requiredConnectors],
    requiredSecrets: [...blueprint.requiredSecrets],
    successCriteria: [...(spec.successCriteria.length ? spec.successCriteria : blueprint.successCriteria)],
  };

  // A hand-written blueprint already encodes the design; the model adds nothing
  // but risk there. Only the generic path asks for one.
  if (blueprint.key !== 'generic' || !llm) return base;

  let designed: Record<string, unknown> | null = null;
  try {
    const reply = await llm([
      { role: 'system', content: DESIGN_SYSTEM },
      {
        role: 'user',
        content: [
          `GOAL: ${spec.goal}`,
          `CAPABILITIES: ${spec.capabilities.join(', ') || '(none extracted)'}`,
          `INTEGRATIONS: ${spec.integrations.join(', ') || '(none named)'}`,
          `CONSTRAINTS:\n${spec.constraints.map((c) => `- ${c}`).join('\n') || '- (none stated)'}`,
          `SUCCESS CRITERIA:\n${spec.successCriteria.map((c) => `- ${c}`).join('\n') || '- (none stated)'}`,
          '',
          'ALLOWED CONNECTORS (key: actions):',
          connectorCatalogPrompt(spec),
          '',
          'BRIEF:',
          briefText.slice(0, 8_000),
        ].join('\n'),
      },
    ]);
    designed = parseJsonObject(reply);
  } catch {
    designed = null;
  }
  if (!designed) {
    return { ...base, handlerWarnings: ['The design step did not return a usable plan; the workspace skeleton was used instead.'] };
  }

  const handlers: Record<string, unknown> = { ...base.handlers };
  const warnings: string[] = [];
  const connectorKeys: string[] = [];

  const rawHandlers = Array.isArray(designed.handlers) ? designed.handlers.slice(0, 8) : [];
  for (const [index, raw] of rawHandlers.entries()) {
    const result = validateGeneratedHandler(raw, index);
    if ('error' in result) {
      warnings.push(result.error);
      continue;
    }
    handlers[result.name] = result.spec;
    const steps = (raw as { steps?: unknown }).steps;
    if (Array.isArray(steps)) {
      for (const s of steps) {
        const key = (s as { connector?: unknown }).connector;
        if (typeof key === 'string') connectorKeys.push(key);
      }
    }
  }

  const rawTasks = Array.isArray(designed.tasks) ? designed.tasks.slice(0, 8) : [];
  const tasks: BlueprintTask[] = [
    ...base.tasks,
    ...rawTasks
      .filter((t): t is { title: string; description?: unknown; kind?: unknown } => !!t && typeof (t as { title?: unknown }).title === 'string')
      .map((t, i) => ({
        order: 100 + i,
        title: t.title.slice(0, 200),
        description: typeof t.description === 'string' ? t.description : '',
        // Anything the model did not explicitly call `build` stays human work.
        // The cost of the two mistakes is not symmetric — see BlueprintTask.kind.
        kind: t.kind === 'build' ? ('build' as const) : ('setup' as const),
      })),
  ];

  const secrets: RequiredSecret[] = Array.isArray(designed.secrets)
    ? designed.secrets
        .filter((s): s is { name: string; label?: unknown; where?: unknown } => !!s && typeof (s as { name?: unknown }).name === 'string')
        .map((s) => ({
          name: s.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 128),
          label: typeof s.label === 'string' ? s.label : s.name,
          where: typeof s.where === 'string' ? s.where : 'Provided by the integration this system uses.',
        }))
        .slice(0, 8)
    : [];

  // Any handler that verifies a Twilio signature needs the token, whether or not
  // the model remembered to list it. Missing this is the single most common way a
  // generated Twilio system ends up returning 403 to every real request.
  const verifiesTwilio = Object.values(handlers).some(
    (h) => !!h && typeof h === 'object' && (h as { verify?: unknown }).verify === 'twilio',
  );
  if (verifiesTwilio && !secrets.some((s) => s.name === 'TWILIO_AUTH_TOKEN')) {
    secrets.push({
      name: 'TWILIO_AUTH_TOKEN',
      label: 'Twilio auth token',
      where: 'Twilio Console → Account Info. Required to verify inbound webhook signatures.',
    });
  }

  const declaredConnectors = asStrings(designed.connectors, 8).filter((k) => CONNECTOR_INDEX.has(k));

  return {
    ...base,
    summary: typeof designed.summary === 'string' && designed.summary.trim() ? designed.summary.trim() : base.summary,
    handlers,
    handlerWarnings: warnings,
    tasks,
    requiredConnectors: connectorRequirements([...connectorKeys, ...declaredConnectors], spec),
    requiredSecrets: [...base.requiredSecrets, ...secrets],
    successCriteria: base.successCriteria,
  };
}
