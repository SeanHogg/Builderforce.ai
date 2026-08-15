/**
 * The handler ENGINE, as generated source — one implementation, five runtimes.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `handlerRuntime.ts` executes handler specs inside THIS worker. When a customer
 * wants the same system running somewhere they own, the specs have to be lowered
 * into code that runs there. The first such adapter (`github-worker`) carried its
 * own 500-line copy of that lowering inside a template string. A second copy for
 * AWS, a third for GCP and a fourth for Azure would be four places where "a
 * failing step binds empty and the reply is still well-formed" could drift, and
 * the drift would only ever be discovered by a customer whose Twilio calls
 * started dropping.
 *
 * So the lowering is written ONCE, here, and every adapter embeds it verbatim.
 * What differs between clouds is genuinely different — how an HTTP request
 * reaches the process, where environment values come from, what deploys it —
 * and that, and only that, is what each adapter writes.
 *
 * ── WHY PLAIN JAVASCRIPT ────────────────────────────────────────────────────
 * The generated module is `.js` with no build step and no dependencies, because
 * it has to be imported unchanged by a Cloudflare Worker (esbuild), a Lambda
 * (Node ESM), a Cloud Run container (Node ESM) and an Azure Function (Node ESM).
 * A TypeScript file would need a compile step in three of those four, and
 * `npm ci` on a runner is the single most common way a generated deploy fails.
 * Every API it uses is a web standard present in both Workers and Node 20:
 * `fetch`, `Request`/`Response`, `crypto.subtle`, `btoa`, `AbortSignal.timeout`.
 *
 * ── WHY THE MANIFEST TRAVELS AND THE CREDENTIALS DO NOT ─────────────────────
 * A connector manifest is pure data — base URL, auth SHAPE, actions — and carries
 * no secret, so it is embedded verbatim and the generated `callConnector`
 * reproduces our request assembly. The credential VALUES stay in Builderforce;
 * the generated backend reads its own from its own environment. Their code,
 * their account, their credentials, and nothing of ours in their repo.
 */

import type { ConnectorManifest } from '../../connectors/connectorManifest';
import { authFieldsFor } from '../../connectors/connectorManifest';
import {
  STRIPE_TIMESTAMP_TOLERANCE_SECONDS,
  verifySecretNameFor,
  VERIFY_SECRET_NAME,
  VERIFY_SIGNATURE_HEADER,
} from '../webhookVerification';
import type { MaterializeContext } from '../hostingStrategy';

/**
 * Path every generated backend answers its own readiness on.
 *
 * The deployed URL round-trips back to the platform, so we know WHERE a backend
 * landed — but not whether the customer ever set the secrets their deploy
 * workflow pushes. Without this, "deployed" and "will 403 every request" look
 * identical from our side, and the customer finds out when Twilio does.
 */
export const BACKEND_HEALTH_PATH = '/__builderforce/health';

/** Where the shared engine module is written, relative to a bundle's root. */
export const ENGINE_FILE = 'engine.js';

/** `accountSid` → `ACCOUNT_SID`, so generated env names read like the vendor's own. */
export function screamingSnake(camel: string): string {
  return camel
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();
}

/** The environment variable a connector's auth field is read from. */
export function connectorEnvVar(connectorKey: string, fieldKey: string): string {
  return `${screamingSnake(connectorKey)}_${screamingSnake(fieldKey)}`;
}

/**
 * Every secret a generated backend needs: one per connector auth field, plus the
 * verification key for each handler that checks a signature, plus the gateway key
 * when any handler calls a model.
 */
export function requiredBackendSecrets(ctx: MaterializeContext): string[] {
  const names = new Set<string>();
  for (const manifest of ctx.connectors) {
    for (const field of authFieldsFor(manifest)) {
      if (field.required || field.secret) names.add(connectorEnvVar(manifest.key, field.key));
    }
  }
  for (const handler of ctx.handlers) {
    const secret = verifySecretNameFor(handler);
    if (secret) names.add(secret);
    if (handler.steps.some((s) => s.kind === 'llm')) names.add('BUILDERFORCE_API_KEY');
  }
  return [...names].sort();
}

/** A DNS-safe, cross-cloud-safe name derived from the project. */
export function backendNameFor(ctx: MaterializeContext): string {
  const slug = ctx.projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `${slug || 'project'}-backend`;
}

const json = (v: unknown): string => JSON.stringify(v, null, 2);

/** The manifest fields the generated `callConnector` actually reads. Trimmed so a
 *  generated file does not carry catalog prose into a customer's repo. */
function wireManifests(connectors: readonly ConnectorManifest[]) {
  return connectors.map((m) => ({
    key: m.key,
    baseUrl: m.baseUrl,
    auth: m.auth,
    defaultHeaders: m.defaultHeaders,
    actions: m.actions.map((a) => ({
      key: a.key,
      method: a.method,
      path: a.path,
      params: a.params,
      required: a.required,
      bodyFormat: a.bodyFormat,
      bodyTemplate: a.bodyTemplate,
      headers: a.headers,
      resultPath: a.resultPath,
    })),
  }));
}

/**
 * Render the engine module.
 *
 * Exports `handleRequest(request, env)` — a plain `Request` → `Response`
 * function every runtime adapter can call — plus `EXPECTED_SECRETS` and
 * `HANDLERS` so an entrypoint can report readiness without re-deriving either.
 */
export function renderHandlerEngineSource(ctx: MaterializeContext): string {
  const authEnvMap: Record<string, Record<string, string>> = {};
  for (const manifest of ctx.connectors) {
    authEnvMap[manifest.key] = Object.fromEntries(
      authFieldsFor(manifest).map((f) => [f.key, connectorEnvVar(manifest.key, f.key)]),
    );
  }

  return `/**
 * ${ctx.projectName} — backend handler engine.
 *
 * GENERATED by Builderforce from this project's handler specs, then yours to
 * edit. The semantics match what was already running on Builderforce-hosted
 * ingress: steps run in order, each binds its result to \`steps.<id>\` for the
 * templates after it, and a FAILING STEP DOES NOT ABORT THE REQUEST — it binds
 * empty and the reply is still well-formed. That last part is deliberate: a
 * Twilio webhook that 500s drops the call, so a degraded answer beats an error.
 *
 * This file is runtime-agnostic on purpose. It uses only web standards that both
 * Cloudflare Workers and Node 20 provide, so the SAME engine runs behind a
 * Worker, a Lambda, a Cloud Run container and an Azure Function. The small file
 * next to it is the only part that knows which one you are on.
 *
 * Regenerating overwrites this file. If you have edited it, either stop
 * regenerating or move your changes into a module that wraps it.
 */

// ── Handler specs ───────────────────────────────────────────────────────────

export const HANDLERS = ${json(ctx.handlers)};

/** Path this backend reports its own readiness on. */
export const HEALTH_PATH = ${JSON.stringify(BACKEND_HEALTH_PATH)};

/**
 * Secrets this backend expects. Reported by name from the health route, never by
 * value: an unset verification secret means the endpoint already rejects every
 * request, so naming it tells an attacker nothing they could not learn by sending
 * one request — while it tells the OWNER the one thing that is otherwise
 * invisible until a provider reports a failure.
 */
export const EXPECTED_SECRETS = ${json(requiredBackendSecrets(ctx))};

// ── Connector manifests (no credentials — those come from the environment) ───

const CONNECTORS = Object.fromEntries(
  (${json(wireManifests(ctx.connectors))}).map((m) => [m.key, m]),
);

/** Which environment variable each connector auth field is read from. */
const CONNECTOR_ENV = ${json(authEnvMap)};

// ── Templates ───────────────────────────────────────────────────────────────

const TEMPLATE_RE = /\\{\\{\\s*([a-zA-Z0-9_.\\[\\]]+)\\s*\\}\\}/g;
const WHOLE_TEMPLATE_RE = /^\\{\\{\\s*([a-zA-Z0-9_.\\[\\]]+)\\s*\\}\\}$/;

function resolvePath(scope, path) {
  return path
    .replace(/\\[(\\d+)\\]/g, '.$1')
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), scope);
}

function stringify(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value); } catch { return ''; }
}

function renderTemplate(template, scope) {
  return template.replace(TEMPLATE_RE, (_m, path) => stringify(resolvePath(scope, path)));
}

function renderValue(value, scope) {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_TEMPLATE_RE);
    if (whole) {
      const resolved = resolvePath(scope, whole[1]);
      return resolved === undefined ? '' : resolved;
    }
    return renderTemplate(value, scope);
  }
  if (Array.isArray(value)) return value.map((v) => renderValue(v, scope));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderValue(v, scope);
    return out;
  }
  return value;
}

const FALSEY = new Set(['', 'false', '0', 'null', 'undefined', 'no', 'off']);
const evaluateWhen = (when, scope) =>
  !when || !FALSEY.has(renderTemplate(when, scope).trim().toLowerCase());

// ── TwiML ───────────────────────────────────────────────────────────────────

const escapeXml = (v) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const attr = (name, value) =>
  value === undefined || value === null || value === '' ? '' : \` \${name}="\${escapeXml(String(value))}"\`;

function renderPrompt(n) {
  if (n.play) return \`<Play\${attr('loop', n.loop)}>\${escapeXml(n.play)}</Play>\`;
  return \`<Say\${attr('voice', n.voice)}\${attr('language', n.language)}>\${escapeXml(n.say ?? '')}</Say>\`;
}

function renderNode(n) {
  if (typeof n.message === 'string') {
    const media = (n.media ?? []).map((m) => \`<Media>\${escapeXml(m)}</Media>\`).join('');
    return media
      ? \`<Message><Body>\${escapeXml(n.message)}</Body>\${media}</Message>\`
      : \`<Message>\${escapeXml(n.message)}</Message>\`;
  }
  if (n.gather) {
    const g = n.gather;
    const inner = (g.prompts ?? []).map(renderPrompt).join('');
    return \`<Gather\${attr('action', g.action)}\${attr('input', g.input)}\${attr('numDigits', g.numDigits)}\${attr('timeout', g.timeout)}>\${inner}</Gather>\`;
  }
  if (n.conversationRelay) {
    const c = n.conversationRelay;
    // Must be wrapped in <Connect> — bare <ConversationRelay> is rejected.
    return \`<Connect><ConversationRelay\${attr('url', c.url)}\${attr('welcomeGreeting', c.welcomeGreeting)}\${attr('voice', c.voice)}\${attr('language', c.language)}\${attr('transcriptionProvider', c.transcriptionProvider)}\${attr('interruptible', c.interruptible)}\${attr('dtmfDetection', c.dtmfDetection)}/></Connect>\`;
  }
  if (typeof n.dial === 'string') {
    return \`<Dial\${attr('callerId', n.callerId)}\${attr('timeout', n.timeout)}\${attr('action', n.action)}>\${escapeXml(n.dial)}</Dial>\`;
  }
  if (typeof n.redirect === 'string') return \`<Redirect>\${escapeXml(n.redirect)}</Redirect>\`;
  if (n.hangup === true) return '<Hangup/>';
  if (n.reject === true) return \`<Reject\${attr('reason', n.reason)}/>\`;
  if (typeof n.pause === 'number') return \`<Pause\${attr('length', n.pause)}/>\`;
  return renderPrompt(n);
}

const renderTwiml = (nodes) =>
  \`<?xml version="1.0" encoding="UTF-8"?><Response>\${nodes.map(renderNode).join('')}</Response>\`;

// ── Verification ────────────────────────────────────────────────────────────

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(hash, key, message) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
}

const toBase64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const toHex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Twilio signs the full request URL followed by every POST parameter appended as
 * key+value in sorted key order. The URL must be byte-identical to the one Twilio
 * called — if you put this behind a proxy or load balancer that rewrites the
 * host, rebuild the URL from the forwarded headers before calling this or every
 * signature will fail.
 */
async function verifyTwilio(url, params, signature, token) {
  if (!signature) return 'Missing X-Twilio-Signature header';
  if (!token) return '${VERIFY_SECRET_NAME.twilio} is not set';
  const sorted = [...params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const base = url + sorted.map(([k, v]) => k + v).join('');
  const expected = toBase64(await hmac('SHA-1', token, base));
  return timingSafeEqual(expected, signature) ? null : 'Signature does not match';
}

async function verifySharedSecret(rawBody, signature, secret) {
  if (!signature) return 'Missing signature header';
  if (!secret) return '${VERIFY_SECRET_NAME['shared-secret']} is not set';
  const expected = toHex(await hmac('SHA-256', secret, rawBody));
  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  return timingSafeEqual(expected, provided) ? null : 'Signature does not match';
}

/**
 * Stripe signs \`"<timestamp>.<rawBody>"\`, not the body — and the timestamp is
 * inside the MAC so a captured event cannot be replayed forever. Both halves are
 * required; checking the HMAC alone is the common mistake.
 */
async function verifyStripe(rawBody, signature, secret) {
  if (!signature) return 'Missing Stripe-Signature header';
  if (!secret) return '${VERIFY_SECRET_NAME.stripe} is not set';
  let timestamp = '';
  const candidates = [];
  for (const part of signature.split(',')) {
    const [k, v] = part.trim().split('=');
    if (k === 't' && v) timestamp = v;
    else if (k === 'v1' && v) candidates.push(v);
  }
  if (!timestamp || !candidates.length) return 'Stripe-Signature is missing t= or v1=';
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > ${STRIPE_TIMESTAMP_TOLERANCE_SECONDS}) return 'Stripe signature timestamp is outside the tolerance window';
  const expected = toHex(await hmac('SHA-256', secret, \`\${timestamp}.\${rawBody}\`));
  let matched = false;
  for (const candidate of candidates) matched = timingSafeEqual(expected, candidate) || matched;
  return matched ? null : 'Signature does not match';
}

/** Shopify sends BASE64, not hex — comparing a hex digest to it never matches. */
async function verifyShopify(rawBody, signature, secret) {
  if (!signature) return 'Missing X-Shopify-Hmac-Sha256 header';
  if (!secret) return '${VERIFY_SECRET_NAME.shopify} is not set';
  const expected = toBase64(await hmac('SHA-256', secret, rawBody));
  return timingSafeEqual(expected, signature.trim()) ? null : 'Signature does not match';
}

/** Default secret name per verification kind. A handler's own \`verifySecret\` wins. */
const VERIFY_SECRET_DEFAULT = ${json(VERIFY_SECRET_NAME)};

// ── Steps ───────────────────────────────────────────────────────────────────

function setDeep(target, path, value) {
  const parts = path.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextIsIndex = /^\\d+$/.test(parts[i + 1]);
    if (cursor[key] == null) cursor[key] = nextIsIndex ? [] : {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function getDeep(source, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

function toFormBody(body) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((item) => params.append(k, String(item)));
    else params.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return params.toString();
}

/** Assemble and send one connector action, mirroring Builderforce's runtime. */
async function callConnector(env, connectorKey, actionKey, input) {
  const manifest = CONNECTORS[connectorKey];
  if (!manifest) return { ok: false, status: 0, data: null, error: \`Unknown connector "\${connectorKey}"\` };
  const action = manifest.actions.find((a) => a.key === actionKey);
  if (!action) return { ok: false, status: 0, data: null, error: \`Unknown action "\${actionKey}"\` };

  const auth = {};
  for (const [field, envName] of Object.entries(CONNECTOR_ENV[connectorKey] ?? {})) {
    const value = env[envName];
    if (value) auth[field] = value;
  }
  const fill = (s) => s.replace(/\\{\\{auth\\.([a-zA-Z0-9_]+)\\}\\}/g, (_m, k) => auth[k] ?? '');

  let path = action.path;
  const query = new URLSearchParams();
  const headers = { Accept: 'application/json', ...(manifest.defaultHeaders ?? {}), ...(action.headers ?? {}) };
  const body = action.bodyTemplate ? JSON.parse(JSON.stringify(action.bodyTemplate)) : {};

  for (const [name, param] of Object.entries(action.params ?? {})) {
    const fallback = typeof param.default === 'string' ? fill(param.default) : param.default;
    const value = input[name] === undefined || input[name] === '' ? fallback : input[name];
    if (value === undefined || value === null) continue;
    const wire = param.name ?? name;
    if (param.in === 'path') path = path.split(\`{\${wire}}\`).join(encodeURIComponent(String(value)));
    else if (param.in === 'query') query.append(wire, typeof value === 'object' ? JSON.stringify(value) : String(value));
    else if (param.in === 'header') headers[wire] = String(value);
    else if (param.bodyPath) setDeep(body, param.bodyPath, value);
    else body[wire] = value;
  }

  const a = manifest.auth ?? { kind: 'none' };
  if (a.kind === 'bearer' || a.kind === 'oauth2') {
    const token = auth.token ?? auth.accessToken ?? '';
    if (token) headers.Authorization = \`\${a.prefix ?? 'Bearer '}\${token}\`;
  } else if (a.kind === 'api_key') {
    const key = auth.apiKey ?? auth.token ?? '';
    if (key) {
      if (a.in === 'query') query.set(a.name || 'api_key', \`\${a.prefix ?? ''}\${key}\`);
      else headers[a.name || 'Authorization'] = \`\${a.prefix ?? ''}\${key}\`;
    }
  } else if (a.kind === 'basic') {
    headers.Authorization = \`Basic \${btoa(\`\${auth.username ?? ''}:\${auth.password ?? ''}\`)}\`;
  }

  const hasBody = action.method !== 'GET' && action.method !== 'DELETE' && Object.keys(body).length > 0;
  if (hasBody) headers['Content-Type'] = action.bodyFormat === 'form' ? 'application/x-www-form-urlencoded' : 'application/json';

  const qs = query.toString();
  const url = \`\${fill(manifest.baseUrl).replace(/\\/$/, '')}\${fill(path)}\${qs ? \`?\${qs}\` : ''}\`;

  try {
    const res = await fetch(url, {
      method: action.method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      ...(hasBody ? { body: action.bodyFormat === 'form' ? toFormBody(body) : JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { text }; }
    if (!res.ok) return { ok: false, status: res.status, data: parsed, error: text.slice(0, 600) };
    return { ok: true, status: res.status, data: action.resultPath ? getDeep(parsed, action.resultPath) ?? parsed : parsed };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : 'Request failed' };
  }
}

/** One model turn through the Builderforce gateway (OpenAI-compatible). */
async function callLlm(env, args) {
  const key = env.BUILDERFORCE_API_KEY;
  if (!key) return '';
  const messages = [
    ...(args.system ? [{ role: 'system', content: args.system }] : []),
    { role: 'user', content: args.prompt },
  ];
  try {
    const res = await fetch('${ctx.apiOrigin}/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: \`Bearer \${key}\` },
      body: JSON.stringify({ messages, max_tokens: args.maxTokens ?? 400, temperature: args.temperature ?? 0.4 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return '';
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
}

/**
 * Read back what this project's own site collected.
 *
 * The Builderforce-hosted ingress reads its own datastore directly. A backend
 * running in your account has no such datastore, so it asks the platform for the
 * collection over the same API key the model calls use. Without the key it binds
 * empty — the same posture as every other failing step.
 */
async function readCollection(env, args) {
  const key = env.BUILDERFORCE_API_KEY;
  const empty = { collection: args.collection, count: 0, records: [] };
  if (!key) return empty;
  const url = new URL('${ctx.apiOrigin}/api/backend-runtime/projects/${ctx.projectId}/collections/' + encodeURIComponent(args.collection));
  if (args.limit) url.searchParams.set('limit', String(args.limit));
  if (args.matchField) {
    url.searchParams.set('matchField', args.matchField);
    url.searchParams.set('matchValue', args.matchValue ?? '');
  }
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json', Authorization: \`Bearer \${key}\` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return empty;
    const data = await res.json();
    return {
      collection: args.collection,
      count: typeof data?.count === 'number' ? data.count : (data?.records ?? []).length,
      records: Array.isArray(data?.records) ? data.records : [],
    };
  } catch {
    return empty;
  }
}

// ── Cross-origin access ─────────────────────────────────────────────────────

/**
 * A handler answers a BROWSER on another origin only if its spec named that
 * origin in \`cors\`. Never defaulted, for the same reason \`verify\` is not: this
 * backend holds your connector credentials and your model budget, so an open
 * \`Access-Control-Allow-Origin\` has to be something you typed.
 */
function allowedOrigin(handler, requestOrigin) {
  const list = handler.cors ?? [];
  if (!list.length || !requestOrigin) return null;
  if (list.includes('*')) return '*';
  return list.includes(requestOrigin.trim().toLowerCase()) ? requestOrigin : null;
}

/** \`Vary: Origin\` whenever the handler is origin-sensitive — including for a
 *  caller it refuses, so no cache can hand one origin's answer to another. */
function corsHeaders(handler, request) {
  if (!(handler.cors ?? []).length) return {};
  const allow = allowedOrigin(handler, request.headers.get('origin'));
  return { Vary: 'Origin', ...(allow ? { 'Access-Control-Allow-Origin': allow } : {}) };
}

// ── Request handling ────────────────────────────────────────────────────────

/**
 * Answer one request. Runtime-agnostic: hand it a \`Request\` and an object of
 * environment values and it returns a \`Response\`.
 *
 * Returns null for a path no handler claims, so an entrypoint that ALSO serves
 * static files can fall through to them instead of 404ing a page.
 */
export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/\\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (route === HEALTH_PATH) {
    return Response.json({
      ok: true,
      backend: ${JSON.stringify(ctx.projectName)},
      secrets: Object.fromEntries(EXPECTED_SECRETS.map((n) => [n, Boolean(env[n])])),
      handlers: HANDLERS.map((h) => ({ method: h.method, route: h.route, verify: h.verify })),
    });
  }

  // A preflight asks about the method it INTENDS to use, so match on that one.
  const preflightMethod = method === 'OPTIONS'
    ? (request.headers.get('access-control-request-method') ?? '').trim().toUpperCase() || null
    : null;

  const candidates = HANDLERS.filter((h) => h.route === route);
  const wanted = preflightMethod ?? method;
  const handler = candidates.find((h) => h.method === wanted) ?? candidates.find((h) => h.method === 'ANY');
  if (!handler) return null;

  // Answered before verification and before any step: a preflight carries
  // neither a body nor a signature, and an \`ANY\` handler claims OPTIONS too —
  // so running it would spend a model call to answer a permission question.
  if (preflightMethod) {
    const allow = allowedOrigin(handler, request.headers.get('origin'));
    if (!allow) {
      return new Response("Origin not allowed by this handler's cors list", {
        status: 403,
        headers: { Vary: 'Origin' },
      });
    }
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allow,
        'Access-Control-Allow-Methods': handler.method === 'ANY' ? preflightMethod : handler.method,
        'Access-Control-Allow-Headers': (request.headers.get('access-control-request-headers') ?? '').trim() || 'content-type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin, Access-Control-Request-Headers',
      },
    });
  }

  const cors = corsHeaders(handler, request);

  const rawBody = method === 'GET' || method === 'HEAD' ? '' : await request.text();
  const contentType = request.headers.get('content-type') ?? '';
  const isForm = contentType.includes('application/x-www-form-urlencoded');

  let body = {};
  let formParams = [];
  if (isForm) {
    formParams = [...new URLSearchParams(rawBody).entries()];
    for (const [k, v] of formParams) body[k] = v;
  } else if (rawBody) {
    try { body = JSON.parse(rawBody); } catch { body = { raw: rawBody }; }
  }

  // A handler may name its OWN secret — Stripe issues one per ENDPOINT, so a
  // single default name could only ever verify one of several Stripe routes.
  const verifySecret = handler.verify === 'none' ? undefined : env[handler.verifySecret ?? VERIFY_SECRET_DEFAULT[handler.verify]];

  if (handler.verify === 'twilio') {
    const failure = await verifyTwilio(request.url, formParams, request.headers.get('${VERIFY_SIGNATURE_HEADER.twilio}'), verifySecret);
    if (failure) return new Response(failure, { status: 403, headers: cors });
  } else if (handler.verify === 'stripe') {
    const failure = await verifyStripe(rawBody, request.headers.get('${VERIFY_SIGNATURE_HEADER.stripe}'), verifySecret);
    if (failure) return new Response(failure, { status: 403, headers: cors });
  } else if (handler.verify === 'shopify') {
    const failure = await verifyShopify(rawBody, request.headers.get('${VERIFY_SIGNATURE_HEADER.shopify}'), verifySecret);
    if (failure) return new Response(failure, { status: 403, headers: cors });
  } else if (handler.verify === 'shared-secret') {
    const signature = request.headers.get('${VERIFY_SIGNATURE_HEADER['shared-secret']}') ?? request.headers.get('x-hub-signature-256');
    const failure = await verifySharedSecret(rawBody, signature, verifySecret);
    if (failure) return new Response(failure, { status: 403, headers: cors });
  }

  const steps = {};
  const scope = {
    body,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: Object.fromEntries([...request.headers.entries()].filter(([k]) => !/^(authorization|cookie|x-twilio-signature)$/i.test(k))),
    project: { id: ${ctx.projectId}, name: ${JSON.stringify(ctx.projectName)}, ingressUrl: url.origin },
    steps,
  };

  for (const step of handler.steps) {
    if (!evaluateWhen(step.when, scope)) { steps[step.id] = ''; continue; }
    try {
      if (step.kind === 'set') {
        steps[step.id] = renderTemplate(step.value, scope);
      } else if (step.kind === 'llm') {
        steps[step.id] = await callLlm(env, {
          system: step.system ? renderTemplate(step.system, scope) : undefined,
          prompt: renderTemplate(step.prompt, scope),
          maxTokens: step.maxTokens,
          temperature: step.temperature,
        });
      } else if (step.kind === 'connector') {
        const result = await callConnector(env, step.connector, step.actionKey ?? step.action, renderValue(step.input ?? {}, scope));
        steps[step.id] = result.data ?? '';
        if (!result.ok) console.error(\`step \${step.id}: \${result.error}\`);
      } else if (step.kind === 'data') {
        steps[step.id] = await readCollection(env, {
          collection: step.collection,
          limit: step.limit,
          matchField: step.matchField,
          matchValue: step.matchValue ? renderTemplate(step.matchValue, scope) : undefined,
        });
      }
    } catch (e) {
      // A failing step must not drop the call — see the note at the top.
      steps[step.id] = '';
      console.error(\`step \${step.id} threw\`, e);
    }
  }

  const respond = handler.respond;
  if (respond.kind === 'twiml') {
    return new Response(renderTwiml(renderValue(respond.nodes ?? respond.twiml ?? [], scope)), {
      headers: { 'Content-Type': 'text/xml; charset=utf-8', ...cors },
    });
  }
  if (respond.kind === 'json') {
    return Response.json(renderValue(respond.body, scope), { headers: cors });
  }
  if (respond.kind === 'text') {
    return new Response(renderTemplate(respond.text, scope), {
      headers: { 'Content-Type': respond.contentType ?? 'text/plain; charset=utf-8', ...cors },
    });
  }
  return new Response(null, { status: respond.status ?? 204, headers: cors });
}
`;
}
