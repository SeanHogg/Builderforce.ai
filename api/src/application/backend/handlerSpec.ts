/**
 * The declarative handler spec — what a canvas-authored request handler IS.
 *
 * ── WHY DECLARATIVE AND NOT JAVASCRIPT ──────────────────────────────────────
 * The obvious design is "let the user write a JS function and run it". That is
 * not available: Cloudflare Workers has no `eval`/`new Function`, so executing
 * customer-authored code in this isolate is impossible without Workers for
 * Platforms (a paid dispatch namespace) or a container per project. Both are real
 * options and one of them — `github-worker` — is the OTHER hosting strategy, where
 * the user gets a genuine Worker in their own account with no vocabulary limits.
 *
 * This strategy buys the thing that one cannot: ZERO setup. A customer with no
 * cloud account, no CLI and no credit card pastes a brief and has a live webhook
 * URL that Twilio can call. That is the difference between "the platform can build
 * you a system" and "the platform can build you a system if you first go and
 * provision somewhere to run it".
 *
 * The vocabulary is therefore chosen for the shape of the problem rather than for
 * generality: receive a signed webhook, decide something (a model call or a
 * branch), act on it (a connector action), and reply in the provider's own
 * protocol (TwiML, JSON). Everything a communications backend does is in that
 * sentence. What it deliberately CANNOT do — loops, arbitrary computation, raw
 * outbound fetch to a URL the manifest never declared — is what makes running it
 * server-side on shared infrastructure safe.
 *
 * ── TEMPLATE SCOPE, AND WHY SECRETS ARE NOT IN IT ───────────────────────────
 * `{{...}}` reads from `body`, `query`, `headers`, `steps` and `project`. It
 * CANNOT read project secrets. That is not an oversight: a handler spec is data
 * in the canvas that any project collaborator can edit, and if secrets were
 * interpolable then `{"respond":{"kind":"text","text":"{{secrets.TWILIO_AUTH_TOKEN}}"}}`
 * would be a one-line exfiltration of the account's credentials to anyone who can
 * hit the public webhook URL. Secrets are consumed by the RUNTIME (signature
 * verification) and by the deploy adapters (injected as Worker secrets); outbound
 * calls authenticate through connector connections, which the runtime resolves.
 */

import { isVerifyKind, VERIFY_KINDS, type VerifyKind } from './webhookVerification';
import { parseTwimlNodes, type TwimlNode } from './twiml';

/** Methods a handler may claim. `ANY` matches every method — status callbacks vary. */
export const HANDLER_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ANY'] as const;
export type HandlerMethod = (typeof HANDLER_METHODS)[number];

/** Canvas directory handler specs are read from. */
export const HANDLERS_DIR = 'handlers/';

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Ask the gateway a question and bind the reply to `steps.<id>`. */
export interface LlmStep {
  kind: 'llm';
  id: string;
  /** Persona/instructions. Templated. */
  system?: string;
  /** The user turn. Templated. */
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** Only run when this template renders to a non-empty, non-"false" value. */
  when?: string;
}

/** Call one action on a connector the tenant has connected. */
export interface ConnectorStep {
  kind: 'connector';
  id: string;
  /** Catalog key — `twilio`, `sendgrid`, a tenant's own connector. */
  connector: string;
  actionKey: string;
  /** Action input; every string value is templated. */
  input?: Record<string, unknown>;
  /** Pin a specific connection; omitted uses the project's default for the key. */
  connectionId?: string | null;
  when?: string;
}

/** Bind a computed value to `steps.<id>` — the spec's only "variable". */
export interface SetStep {
  kind: 'set';
  id: string;
  /** Templated. */
  value: string;
  when?: string;
}

/**
 * Read the project's own site collection and bind `{ collection, count, records }`.
 *
 * The counterpart to the public write endpoint: a form posts to
 * `/__api/collections/signups`, and this is how a page then SHOWS what was
 * collected. Without it the datastore is write-only and "run server code" can
 * only ever mean "call something else".
 */
export interface DataStep {
  kind: 'data';
  id: string;
  /** Collection name on THIS project's site. */
  collection: string;
  /** Rows to read; clamped by the runtime. */
  limit?: number;
  /** Optional single-field equality filter. Both sides are templated, so
   *  `matchValue: "{{query.plan}}"` filters by a query parameter. */
  matchField?: string;
  matchValue?: string;
  when?: string;
}

export type HandlerStep = LlmStep | ConnectorStep | SetStep | DataStep;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export type HandlerResponse =
  | { kind: 'twiml'; nodes: TwimlNode[] }
  | { kind: 'json'; body: Record<string, unknown> }
  | { kind: 'text'; text: string; contentType?: string }
  | { kind: 'empty'; status?: number };

export interface HandlerSpec {
  /** Derived from the file name when absent; used in logs and the UI. */
  name: string;
  /** Path AFTER the ingress token, always leading-slashed and lowercased. */
  route: string;
  method: HandlerMethod;
  verify: VerifyKind;
  /**
   * Project secret this handler verifies against, overriding the kind's default.
   *
   * Needed because "one secret per provider" is not how every provider works:
   * Stripe issues a DIFFERENT signing secret per webhook ENDPOINT, so a system
   * with three Stripe endpoints has three `whsec_…` values and a single
   * `STRIPE_WEBHOOK_SECRET` can only ever verify one of them. Without this the
   * other two fail closed forever, with an error that reads exactly like a wrong
   * secret.
   *
   * Absent means the kind's default name — which is right for Twilio and Shopify,
   * where the secret is per-ACCOUNT.
   */
  verifySecret?: string;
  /**
   * Origins allowed to call this handler from a BROWSER. Absent means none.
   *
   * Both handler addresses were built for callers that do not preflight — a
   * provider's webhook (`/hooks/<token>/…`) and the site's own pages
   * (`<site>/api/…`, same-origin). A page hosted anywhere else — a static export
   * on someone's own CDN, a native app's webview — therefore could not call the
   * backend it was built with, because the reply carried no CORS headers.
   *
   * It is an ALLOW-LIST and it is never defaulted, for the same reason `verify`
   * is not: a handler can spend connector credentials and model tokens, so
   * `Access-Control-Allow-Origin: *` must not be what you get by forgetting.
   * `["*"]` is available, but only by typing it.
   */
  cors?: string[];
  description?: string;
  steps: HandlerStep[];
  respond: HandlerResponse;
}

/** Same shape the vault enforces, so a spec cannot name a secret that cannot exist. */
const VERIFY_SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

/** How many origins one handler may name. A list this long is a `*` in disguise. */
const MAX_CORS_ORIGINS = 32;

/**
 * Normalise one allow-list entry to the exact string a browser sends in `Origin`,
 * or null when it cannot be one.
 *
 * A path is rejected rather than trimmed: `https://example.com/app` looks like it
 * scopes the permission to one part of a site, and it does not — the browser
 * sends only the origin, so honouring it silently would grant the WHOLE site
 * access under a spec that reads as though it did not.
 */
export function normalizeOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '*') return '*';
  // The literal `Origin: null` a sandboxed iframe and a `file://` document send —
  // the case a packaged native app's webview actually presents. Un-attributable,
  // like `*`, and available on the same terms: only if you typed it.
  if (value.toLowerCase() === 'null') return 'null';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.pathname !== '/' || url.search || url.hash) return null;
  return url.origin.toLowerCase();
}

/**
 * The `Access-Control-Allow-Origin` value for this caller, or null when the
 * handler does not admit it.
 *
 * Returns `*` only when the spec literally says `*`; otherwise it echoes the
 * caller's own origin, so an allow-list of three origins never widens into a
 * blanket permission on the wire.
 */
export function allowedCorsOrigin(handler: HandlerSpec, requestOrigin: string | null): string | null {
  if (!handler.cors?.length || !requestOrigin) return null;
  if (handler.cors.includes('*')) return '*';
  return handler.cors.includes(requestOrigin.trim().toLowerCase()) ? requestOrigin : null;
}

export type ParseResult =
  | { ok: true; spec: HandlerSpec }
  | { ok: false; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Normalise a route: leading slash, no trailing slash, lowercase, no `..`.
 * Returns null for anything that cannot be a route — a handler with a bad route
 * must not silently claim `/`.
 */
export function normalizeRoute(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let route = raw.trim().toLowerCase();
  if (route === '' || route === '/') return '/';
  if (!route.startsWith('/')) route = `/${route}`;
  route = route.replace(/\/+$/, '') || '/';
  if (route.includes('..') || route.includes('//') || /[\s?#]/.test(route)) return null;
  if (route.length > 200) return null;
  return route;
}

/** Step ids are template identifiers, so they are constrained like one. */
const STEP_ID_RE = /^[a-z][a-z0-9_]{0,31}$/i;

function parseStep(raw: unknown, index: number): HandlerStep | { error: string } {
  if (!isRecord(raw)) return { error: `steps[${index}] must be an object` };
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!STEP_ID_RE.test(id)) {
    return { error: `steps[${index}].id must match [A-Za-z][A-Za-z0-9_]* (got ${JSON.stringify(raw.id)})` };
  }
  const when = typeof raw.when === 'string' && raw.when.trim() ? raw.when : undefined;

  switch (raw.kind) {
    case 'llm': {
      if (typeof raw.prompt !== 'string' || !raw.prompt.trim()) {
        return { error: `steps[${index}] (llm) requires a non-empty prompt` };
      }
      return {
        kind: 'llm',
        id,
        prompt: raw.prompt,
        ...(typeof raw.system === 'string' && raw.system.trim() ? { system: raw.system } : {}),
        ...(typeof raw.maxTokens === 'number' ? { maxTokens: raw.maxTokens } : {}),
        ...(typeof raw.temperature === 'number' ? { temperature: raw.temperature } : {}),
        ...(when ? { when } : {}),
      };
    }
    case 'connector': {
      const connector = typeof raw.connector === 'string' ? raw.connector.trim() : '';
      // `action` is the field name every connector surface uses; `actionKey` is
      // accepted too because that is what the runtime calls it, and a spec author
      // reading the runtime source should not be punished for consistency.
      const actionKey = typeof raw.actionKey === 'string'
        ? raw.actionKey.trim()
        : typeof raw.action === 'string' ? raw.action.trim() : '';
      if (!connector || !actionKey) {
        return { error: `steps[${index}] (connector) requires connector and action` };
      }
      return {
        kind: 'connector',
        id,
        connector,
        actionKey,
        ...(isRecord(raw.input) ? { input: raw.input } : {}),
        ...(typeof raw.connectionId === 'string' ? { connectionId: raw.connectionId } : {}),
        ...(when ? { when } : {}),
      };
    }
    case 'set': {
      if (typeof raw.value !== 'string') return { error: `steps[${index}] (set) requires a string value` };
      return { kind: 'set', id, value: raw.value, ...(when ? { when } : {}) };
    }
    case 'data': {
      const collection = typeof raw.collection === 'string' ? raw.collection.trim() : '';
      if (!collection) return { error: `steps[${index}] (data) requires a collection name` };
      // A filter needs both halves; one alone is an author error that would
      // silently return everything — exactly the mistake worth failing on.
      const hasField = typeof raw.matchField === 'string' && raw.matchField.trim() !== '';
      const hasValue = typeof raw.matchValue === 'string';
      if (hasField !== hasValue) {
        return { error: `steps[${index}] (data) needs matchField and matchValue together` };
      }
      return {
        kind: 'data',
        id,
        collection,
        ...(typeof raw.limit === 'number' && Number.isFinite(raw.limit) ? { limit: raw.limit } : {}),
        ...(hasField ? { matchField: (raw.matchField as string).trim(), matchValue: raw.matchValue as string } : {}),
        ...(when ? { when } : {}),
      };
    }
    default:
      return { error: `steps[${index}].kind must be one of: llm, connector, set, data` };
  }
}

function parseResponse(raw: unknown): HandlerResponse | { error: string } {
  if (!isRecord(raw)) return { error: 'respond must be an object' };
  switch (raw.kind) {
    case 'twiml':
      return { kind: 'twiml', nodes: parseTwimlNodes(raw.twiml ?? raw.nodes) };
    case 'json':
      return { kind: 'json', body: isRecord(raw.body) ? raw.body : {} };
    case 'text':
      return {
        kind: 'text',
        text: typeof raw.text === 'string' ? raw.text : '',
        ...(typeof raw.contentType === 'string' ? { contentType: raw.contentType } : {}),
      };
    case 'empty':
      return { kind: 'empty', ...(typeof raw.status === 'number' ? { status: raw.status } : {}) };
    default:
      return { error: 'respond.kind must be one of: twiml, json, text, empty' };
  }
}

/**
 * Parse one untrusted handler document.
 *
 * Strict, unlike {@link parseTwimlNodes}: a malformed STEP is a spec the author
 * meant to do something that will now silently not happen, which is far worse
 * than a 500 at publish time. A malformed TwiML NODE inside an otherwise-valid
 * respond block is dropped, because there the failure is visible in the reply.
 */
export function parseHandlerSpec(raw: unknown, fallbackName: string): ParseResult {
  if (!isRecord(raw)) return { ok: false, reason: 'Handler must be a JSON object' };

  const route = normalizeRoute(raw.route ?? `/${fallbackName}`);
  if (!route) return { ok: false, reason: `Invalid route ${JSON.stringify(raw.route)}` };

  const method = typeof raw.method === 'string' ? raw.method.toUpperCase() : 'POST';
  if (!(HANDLER_METHODS as readonly string[]).includes(method)) {
    return { ok: false, reason: `method must be one of: ${HANDLER_METHODS.join(', ')}` };
  }

  // Verification is REQUIRED to be explicit. Defaulting to 'none' would make the
  // insecure choice the one you get by forgetting, on an endpoint whose whole job
  // is to accept requests from the public internet.
  if (!isVerifyKind(raw.verify)) {
    // Derived from the list rather than retyped — a hardcoded copy went stale the
    // first time a verification kind was added, and told authors that a kind the
    // runtime supports was invalid.
    return { ok: false, reason: `verify must be one of: ${VERIFY_KINDS.join(', ')} (declare it explicitly)` };
  }

  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const steps: HandlerStep[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawSteps.length; i++) {
    const parsed = parseStep(rawSteps[i], i);
    if ('error' in parsed) return { ok: false, reason: parsed.error };
    if (seen.has(parsed.id)) return { ok: false, reason: `Duplicate step id "${parsed.id}"` };
    seen.add(parsed.id);
    steps.push(parsed);
  }

  const respond = parseResponse(raw.respond ?? { kind: 'empty' });
  if ('error' in respond) return { ok: false, reason: respond.error };

  // Rejected rather than ignored: a spec that names a secret we silently drop
  // would verify against the DEFAULT one and pass review looking correct.
  let verifySecret: string | undefined;
  if (raw.verifySecret !== undefined) {
    if (typeof raw.verifySecret !== 'string' || !VERIFY_SECRET_NAME_RE.test(raw.verifySecret)) {
      return { ok: false, reason: 'verifySecret must be an UPPER_SNAKE secret name' };
    }
    if (raw.verify === 'none') {
      return { ok: false, reason: 'verifySecret has no meaning when verify is "none"' };
    }
    verifySecret = raw.verifySecret;
  }

  // Declared, never defaulted — the `verify` posture applied to the browser.
  // An EMPTY list is rejected rather than treated as absent: it reads like
  // "CORS is on here" and behaves like "no origin may call this", which is the
  // exact shape of failure that survives review looking correct.
  let cors: string[] | undefined;
  if (raw.cors !== undefined) {
    if (!Array.isArray(raw.cors)) return { ok: false, reason: 'cors must be an array of origins' };
    if (raw.cors.length === 0) {
      return { ok: false, reason: 'cors must name at least one origin — omit it entirely to allow none' };
    }
    if (raw.cors.length > MAX_CORS_ORIGINS) {
      return { ok: false, reason: `cors may name at most ${MAX_CORS_ORIGINS} origins` };
    }
    const origins: string[] = [];
    for (const entry of raw.cors) {
      const origin = normalizeOrigin(entry);
      if (!origin) {
        return {
          ok: false,
          reason: `cors entry ${JSON.stringify(entry)} is not an origin — use scheme://host[:port], "*" or "null"`,
        };
      }
      if (!origins.includes(origin)) origins.push(origin);
    }
    cors = origins;
  }

  return {
    ok: true,
    spec: {
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fallbackName,
      route,
      method: method as HandlerMethod,
      verify: raw.verify as VerifyKind,
      ...(verifySecret ? { verifySecret } : {}),
      ...(cors ? { cors } : {}),
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      steps,
      respond,
    },
  };
}

/** Handler name derived from its canvas path (`handlers/inbound-sms.json` → `inbound-sms`). */
export function handlerNameFromPath(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.json$/i, '');
}

/**
 * Pick the handler for a request. Exact route match, then method: a handler
 * naming the method beats an `ANY` handler on the same route, so a spec can
 * define `GET /status` for a browser and `ANY /status` as the catch-all without
 * the order of the files deciding which wins.
 */
export function matchHandler(
  specs: readonly HandlerSpec[],
  route: string,
  method: string,
): HandlerSpec | null {
  const candidates = specs.filter((s) => s.route === route);
  const upper = method.toUpperCase();
  return candidates.find((s) => s.method === upper) ?? candidates.find((s) => s.method === 'ANY') ?? null;
}
