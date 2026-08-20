/**
 * The DYNAMIC review stage — PRD 24 §5.5 step 2, and the first stage that goes
 * and looks.
 *
 * The static stage reads a submitted document and says whether it is well-formed.
 * That is a statement about JSON. This stage installs the candidate version into
 * a real sandbox workspace, resolves it through the same `connectorRegistry` an
 * agent resolves through, and exercises the declared surface against the real
 * internet — which is a statement about the INTEGRATION.
 *
 * ── THE RULE THIS MODULE IS BUILT AROUND ────────────────────────────────────
 * A stage that claims to have exercised something it did not is worse than no
 * stage, because it converts an unknown into a false assurance and a reader
 * cannot tell the difference. So every single thing this stage touches produces
 * an evidence entry, and the entries for the things it DECLINED to do are as
 * detailed as the ones for the things it did:
 *
 *     {subject: 'create_invoice', outcome: 'skipped',
 *      detail: 'mutating action — the URL was resolved and egress-checked, but
 *               the request was not sent',
 *      method: 'POST', url: 'https://api.acme.example/v1/invoices'}
 *
 * ── WHY MUTATING ACTIONS ARE NOT INVOKED ────────────────────────────────────
 * `ConnectorAction.mutates` is mandatory in the manifest precisely so nothing has
 * to infer it. A review that POSTed every declared action would create real rows
 * in a vendor's production system on every submission — a review pipeline that
 * damages the thing it is reviewing. Read-only actions ARE invoked, for real,
 * with placeholder credentials, and what they prove is stated exactly: that the
 * declared host resolves publicly, that it is not an SSRF target, that it answers,
 * and that it answers the way an authenticated endpoint answers an unauthenticated
 * caller. Everything else about a mutating action — that the URL resolves inside
 * the declared origin, that the guard passes — is checked and recorded, because
 * those parts CAN be checked without sending the request.
 *
 * ── EGRESS CONTAINMENT ──────────────────────────────────────────────────────
 * PRD §5.5 asks the dynamic stage to "assert no unexpected egress". The check is:
 * every action's RESOLVED url — after path templating, after `{{auth.*}}`
 * substitution, after the base-url override — must sit on the same origin the
 * manifest declares as `baseUrl`. An action whose path escapes to another host is
 * a manifest that shows a reviewer one destination and calls another, and that is
 * a refusal, not a warning.
 *
 * ── BUDGET ──────────────────────────────────────────────────────────────────
 * This runs synchronously inside the submit request, because a publisher who has
 * to poll for a verdict is a publisher who does not come back. It is therefore
 * BUDGETED: at most {@link MAX_PROBED_ACTIONS} real requests, {@link PROBE_TIMEOUT_MS}
 * each, {@link TOTAL_BUDGET_MS} overall. Actions past the budget are recorded as
 * skipped with `budget_exhausted` — an honest "not examined", never an implied
 * pass. Every action is still built, guarded and egress-checked; only the sending
 * is rationed.
 */

import { assertSafeUrl, resolveAndAssertPublic } from '../../infrastructure/net/ssrfGuard';
import {
  authFieldsFor,
  fillTemplate,
  parseConnectorManifest,
  type ConnectorAction,
  type ConnectorManifest,
  type ConnectorParam,
} from '../connectors/connectorManifest';
import { buildConnectorRequest } from '../connectors/connectorRuntime';
import { resolveConnector } from '../connectors/connectorRegistry';
import {
  finding,
  skipped,
  verdictFor,
  type ReviewStage,
  type ReviewStageContext,
  type StageEvidence,
  type StageResult,
} from './reviewPipeline';
import { resolveSandboxTenantId, withSandboxInstall } from './reviewSandbox';
import type { ReviewFinding } from './packageReview';

/** Real requests sent per review. Eight covers the median manifest's read surface. */
export const MAX_PROBED_ACTIONS = 8;
/** Per-request ceiling. Shorter than the runtime's 20s: a review is not a call. */
export const PROBE_TIMEOUT_MS = 5_000;
/** Wall-clock ceiling for the whole stage, so a slow vendor cannot hold the form. */
export const TOTAL_BUDGET_MS = 15_000;

/**
 * A placeholder credential value.
 *
 * Shaped so it can never be mistaken for a real one: it names itself, it carries
 * no entropy, and it does not match anything in `packageReview`'s `SECRET_PATTERNS`
 * — a review fixture that tripped the secret scanner would be this stage
 * manufacturing the failure it is looking for.
 */
const placeholderAuth = (key: string): string => `sandbox-review-${key}`;

/** A syntactically-plausible value for a required param, by declared type. */
function sampleValue(param: ConnectorParam): unknown {
  if (Array.isArray(param.enum) && param.enum.length > 0) return param.enum[0];
  if (param.default !== undefined) return param.default;
  switch (param.type) {
    case 'number':
    case 'integer': return 1;
    case 'boolean': return false;
    case 'object': return {};
    case 'array': return [];
    default: return 'sandbox-review';
  }
}

/** Every required param filled with a sample, so the request BUILDS. */
function sampleInput(action: ConnectorAction): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const name of action.required ?? []) {
    const param = action.params[name];
    if (param) input[name] = sampleValue(param);
  }
  // A path placeholder that is not in `required` still has to be filled, or the
  // built URL contains a literal `{id}` and the probe tests a path nobody declared.
  for (const [name, param] of Object.entries(action.params)) {
    if (param.in === 'path' && input[name] === undefined) input[name] = sampleValue(param);
  }
  return input;
}

/** Placeholder values for every declared credential field. */
function placeholderCredentials(manifest: ConnectorManifest): Record<string, string> {
  const auth: Record<string, string> = {};
  for (const field of authFieldsFor(manifest)) auth[field.key] = placeholderAuth(field.key);
  return auth;
}

/**
 * Does `url` sit on the origin the manifest declares?
 *
 * Compared on HOST, not on the full prefix: an action legitimately walks off the
 * base path (`/v1/employees` under a base of `https://api.acme.example`), and a
 * prefix comparison would fail every manifest whose baseUrl carries no path. What
 * must not change is where the request GOES.
 */
function sameOrigin(declaredHost: string, actual: URL): boolean {
  const host = actual.hostname.toLowerCase();
  return host === declaredHost || host.endsWith(`.${declaredHost}`);
}

/** True when the base URL is only knowable at install time (`{{auth.subdomain}}`). */
function isTemplatedBase(manifest: ConnectorManifest): boolean {
  return /\{\{\s*auth\./.test(manifest.baseUrl);
}

/**
 * Grade one real HTTP response.
 *
 * The gradings are deliberately conservative, because this stage sends its probe
 * with a PLACEHOLDER credential and most of what comes back is the API refusing
 * it. That refusal is the useful signal:
 *
 *   401 / 403  PASS — the endpoint exists and is authenticated. This is the best
 *                     outcome an unauthenticated probe can produce.
 *   2xx        PASS — the endpoint exists and answers without a credential.
 *   429        WARN — rate-limited; the endpoint is there, we learned nothing else.
 *   5xx        WARN — upstream trouble, not necessarily the manifest's fault.
 *   404/405/4xx WARN — the path could not be CONFIRMED. Not a failure: a large
 *                     number of APIs answer an unauthenticated request with 404 to
 *                     avoid confirming what exists, so a 404 here does not
 *                     distinguish a wrong path from a careful vendor, and refusing
 *                     on it would reject correct manifests.
 *   3xx        WARN — the runtime does not follow redirects, so an action that
 *                     relies on one will not work as declared.
 */
function gradeStatus(status: number): { outcome: StageEvidence['outcome']; detail: string } {
  if (status === 401 || status === 403) {
    return { outcome: 'pass', detail: `answered ${status} to an unauthenticated probe — the endpoint exists and is authenticated` };
  }
  if (status >= 200 && status < 300) {
    return { outcome: 'pass', detail: `answered ${status} — the endpoint exists and served an unauthenticated read` };
  }
  if (status >= 300 && status < 400) {
    return { outcome: 'warn', detail: `answered ${status} (redirect) — connector calls do not follow redirects, so this action will not work as declared` };
  }
  if (status === 429) {
    return { outcome: 'warn', detail: 'answered 429 (rate limited) — the endpoint is reachable; nothing further was learned' };
  }
  if (status >= 500) {
    return { outcome: 'warn', detail: `answered ${status} — the upstream is erroring; this may not be the manifest's fault` };
  }
  return { outcome: 'warn', detail: `answered ${status} to an unauthenticated probe — the path could not be confirmed either way` };
}

// ─────────────────────────────────────────────────────────────────────────────
// The connector probe
// ─────────────────────────────────────────────────────────────────────────────

async function exerciseConnector(
  ctx: ReviewStageContext,
  sandboxTenantId: number,
  manifest: ConnectorManifest,
  fetchImpl: typeof fetch,
): Promise<{ findings: ReviewFinding[]; evidence: StageEvidence[] }> {
  const findings: ReviewFinding[] = [];
  const evidence: StageEvidence[] = [];

  // ── 1 · The install seam ────────────────────────────────────────────────
  // The manifest must come back out of the registry the way a customer's agent
  // would get it. This is the check that a JSON-only review cannot make.
  const resolved = await resolveConnector(ctx.db, sandboxTenantId, manifest.key, undefined);
  if (!resolved || resolved.origin !== 'marketplace') {
    findings.push(finding(
      'install_resolves',
      'fail',
      resolved
        ? `installing this package resolves "${manifest.key}" to a ${resolved.origin} connector, not to this package — the key is already taken in the sandbox`
        : `installing this package into a workspace does not make "${manifest.key}" resolvable — its actions would never be offered to an agent`,
    ));
    evidence.push({
      subject: 'install',
      outcome: 'fail',
      detail: resolved
        ? `resolved to origin "${resolved.origin}"`
        : 'the connector registry returned nothing for this key after install',
    });
    return { findings, evidence };
  }
  findings.push(finding('install_resolves', 'pass', `installed into the review sandbox and resolved through the connector registry as a marketplace connector`));
  evidence.push({
    subject: 'install',
    outcome: 'pass',
    detail: `resolved "${manifest.key}" from tenant ${sandboxTenantId} with ${resolved.manifest.actions.length} action(s)`,
  });

  const auth = placeholderCredentials(manifest);
  const declaredHost = (() => {
    try {
      return new URL(fillTemplate(manifest.baseUrl, auth)).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  const templatedBase = isTemplatedBase(manifest);

  if (templatedBase) {
    // A per-tenant host (`https://{{auth.subdomain}}.zendesk.com`) is not knowable
    // at review time. Say so once, plainly, rather than probing a host built out
    // of a placeholder and reporting the DNS failure as the package's fault.
    findings.push(finding(
      'probe_scope',
      'warn',
      'the base URL is per-tenant, so no request could be sent — every action was built and egress-checked, but none was invoked',
    ));
  }

  // ── 2 · Every declared action ───────────────────────────────────────────
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let sent = 0;

  for (const action of resolved.manifest.actions) {
    let url: URL;
    let built: { url: string };
    try {
      built = buildConnectorRequest({ manifest: resolved.manifest, action, input: sampleInput(action), auth });
      url = new URL(built.url);
    } catch (error) {
      findings.push(finding('action_builds', 'fail', `action "${action.key}" could not be turned into a request: ${error instanceof Error ? error.message : 'unknown error'}`));
      evidence.push({ subject: action.key, outcome: 'fail', detail: 'the request could not be built from the declared params', method: action.method });
      continue;
    }

    // ── Egress containment, for EVERY action including the ones not sent ──
    if (declaredHost && !sameOrigin(declaredHost, url)) {
      findings.push(finding(
        'unexpected_egress',
        'fail',
        `action "${action.key}" resolves to ${url.hostname}, which is outside the declared base URL (${declaredHost})`,
      ));
      evidence.push({ subject: action.key, outcome: 'fail', detail: `resolved outside the declared origin ${declaredHost}`, method: action.method, url: url.toString() });
      continue;
    }

    // ── The SSRF guard, on the resolved URL, for every action ────────────
    try {
      assertSafeUrl(url.toString(), { allowHttp: false });
      if (!templatedBase) await resolveAndAssertPublic(url.hostname);
    } catch (error) {
      findings.push(finding(
        'egress_guard',
        'fail',
        `action "${action.key}" resolves to a blocked destination: ${error instanceof Error ? error.message : 'blocked'}`,
      ));
      evidence.push({ subject: action.key, outcome: 'fail', detail: error instanceof Error ? error.message : 'blocked destination', method: action.method, url: url.toString() });
      continue;
    }

    // ── Send, or say precisely why not ──────────────────────────────────
    if (templatedBase) {
      evidence.push({ subject: action.key, outcome: 'skipped', detail: 'per-tenant base URL — the request was built and egress-checked, but the host is only known at install time', method: action.method, url: url.toString() });
      continue;
    }
    if (action.mutates || action.method !== 'GET') {
      evidence.push({ subject: action.key, outcome: 'skipped', detail: 'mutating action — the URL was resolved and egress-checked, but the request was not sent: a review must not write to a vendor\'s live system', method: action.method, url: url.toString() });
      continue;
    }
    if (sent >= MAX_PROBED_ACTIONS || Date.now() >= deadline) {
      evidence.push({ subject: action.key, outcome: 'skipped', detail: `budget exhausted after ${sent} request(s) — built and egress-checked, not invoked`, method: action.method, url: url.toString() });
      continue;
    }

    sent += 1;
    const started = Date.now();
    try {
      const res = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'BuilderForce-ExtensionReview/1' },
        redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const graded = gradeStatus(res.status);
      evidence.push({
        subject: action.key,
        outcome: graded.outcome,
        detail: graded.detail,
        method: 'GET',
        url: url.toString(),
        status: res.status,
        durationMs: Date.now() - started,
      });
      if (graded.outcome === 'warn') {
        findings.push(finding('action_probe', 'warn', `action "${action.key}" ${graded.detail}`));
      }
    } catch (error) {
      // A declared endpoint that does not answer at all IS the package's problem:
      // an agent calling it would get exactly this, and there is nothing a tenant
      // can configure that makes an unreachable host reachable.
      const message = error instanceof Error ? error.message : 'the request failed';
      findings.push(finding('endpoint_unreachable', 'fail', `action "${action.key}" — ${url.hostname} did not answer: ${message}`));
      evidence.push({ subject: action.key, outcome: 'fail', detail: `no response: ${message}`, method: 'GET', url: url.toString(), durationMs: Date.now() - started });
    }
  }

  const probed = evidence.filter((e) => e.status !== undefined).length;
  findings.push(finding(
    'actions_exercised',
    'pass',
    `${resolved.manifest.actions.length} action(s) built and egress-checked; ${probed} invoked against the live endpoint`,
  ));
  return { findings, evidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// The MCP probe
// ─────────────────────────────────────────────────────────────────────────────

interface JsonRpcResponse { result?: { tools?: Array<{ name?: unknown }> }; error?: { message?: unknown } }

/**
 * Exercise an `mcp_server` package by asking the server what it actually exposes.
 *
 * This is the check the static stage genuinely cannot make. A publisher declares
 * a tool list; the server is the only thing that knows the real one. A tool the
 * server exposes but did not declare would enter the merged tool catalog on
 * install having been reviewed by nobody — which is the supply-chain hole the
 * whole pipeline exists to close — so an undeclared tool is a REFUSAL, and the fix
 * is one line in the publisher's spec.
 *
 * Unreachable is also a refusal here, and that differs from the connector case on
 * purpose: for an MCP package the server IS the package. One that does not answer
 * at review time cannot be installed usefully by anyone.
 */
async function exerciseMcpServer(
  spec: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<{ findings: ReviewFinding[]; evidence: StageEvidence[] }> {
  const findings: ReviewFinding[] = [];
  const evidence: StageEvidence[] = [];

  const serverUrl = String(spec.serverUrl ?? '');
  const declared = Array.isArray(spec.tools)
    ? (spec.tools as unknown[]).map((t) => (typeof t === 'string' ? t : String((t as { name?: unknown })?.name ?? ''))).filter(Boolean)
    : [];

  let url: URL;
  try {
    url = assertSafeUrl(serverUrl, { allowHttp: false });
    await resolveAndAssertPublic(url.hostname);
  } catch (error) {
    findings.push(finding('egress_guard', 'fail', `serverUrl is a blocked destination: ${error instanceof Error ? error.message : 'blocked'}`));
    evidence.push({ subject: 'serverUrl', outcome: 'fail', detail: error instanceof Error ? error.message : 'blocked destination', url: serverUrl });
    return { findings, evidence };
  }

  const started = Date.now();
  let advertised: string[];
  try {
    const res = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      findings.push(finding('tools_list', 'fail', `the server answered ${res.status} to tools/list — an MCP package whose server does not list its tools cannot be installed`));
      evidence.push({ subject: 'tools/list', outcome: 'fail', detail: `answered ${res.status}`, method: 'POST', url: url.toString(), status: res.status, durationMs: Date.now() - started });
      return { findings, evidence };
    }
    // A streaming transport answers `data: {json}` lines; take the first JSON body.
    const jsonText = text.trimStart().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data:'))?.slice(5).trim() ?? text);
    const parsed = JSON.parse(jsonText) as JsonRpcResponse;
    if (parsed.error) {
      findings.push(finding('tools_list', 'fail', `the server refused tools/list: ${String(parsed.error.message ?? 'error')}`));
      evidence.push({ subject: 'tools/list', outcome: 'fail', detail: String(parsed.error.message ?? 'error'), method: 'POST', url: url.toString(), status: res.status, durationMs: Date.now() - started });
      return { findings, evidence };
    }
    advertised = (parsed.result?.tools ?? []).map((t) => String(t?.name ?? '')).filter(Boolean);
    evidence.push({
      subject: 'tools/list',
      outcome: 'pass',
      detail: `the server advertised ${advertised.length} tool(s): ${advertised.slice(0, 20).join(', ') || '(none)'}`,
      method: 'POST',
      url: url.toString(),
      status: res.status,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'the request failed';
    findings.push(finding('endpoint_unreachable', 'fail', `${url.hostname} did not answer tools/list: ${message} — for an mcp_server package the server IS the package`));
    evidence.push({ subject: 'tools/list', outcome: 'fail', detail: `no usable response: ${message}`, method: 'POST', url: url.toString(), durationMs: Date.now() - started });
    return { findings, evidence };
  }

  // ── Declared vs. actual ─────────────────────────────────────────────────
  const advertisedSet = new Set(advertised);
  const declaredSet = new Set(declared);
  for (const name of declared) {
    const present = advertisedSet.has(name);
    evidence.push({
      subject: name,
      outcome: present ? 'pass' : 'fail',
      detail: present ? 'declared and advertised by the server' : 'declared in the spec but the server does not advertise it',
    });
    if (!present) findings.push(finding('declared_tool_missing', 'fail', `the spec declares "${name}" but the server does not advertise it`));
  }
  for (const name of advertised) {
    if (declaredSet.has(name)) continue;
    evidence.push({ subject: name, outcome: 'fail', detail: 'advertised by the server but not declared in the spec — it would reach agents unreviewed' });
    findings.push(finding('undeclared_tool', 'fail', `the server advertises "${name}", which the spec does not declare — declare it so it can be reviewed`));
  }
  if (declared.length > 0 && advertised.length > 0 && declared.every((n) => advertisedSet.has(n)) && advertised.every((n) => declaredSet.has(n))) {
    findings.push(finding('tools_match', 'pass', `every declared tool is advertised by the server, and the server advertises nothing undeclared (${declared.length})`));
  }
  return { findings, evidence };
}

// ─────────────────────────────────────────────────────────────────────────────
// The stage
// ─────────────────────────────────────────────────────────────────────────────

/** Injection seam. The stage's whole job is real network I/O, so the tests need
 *  to be able to hand it a fetch that does not leave the machine. */
let fetchForReview: typeof fetch = fetch;
export function __setReviewFetchForTests(impl: typeof fetch | null): void {
  fetchForReview = impl ?? fetch;
}

export const dynamicStage: ReviewStage = {
  key: 'dynamic',
  order: 20,

  // Only the kinds with a runtime to exercise. A `canvas_kind` package has no
  // endpoint and no server; when it becomes submittable it will need its own
  // branch here, and `applies` returning false is how it says "nothing to do"
  // without producing a stage row that reads as an unexercised failure.
  applies: (ctx) => ctx.kind === 'connector' || ctx.kind === 'mcp_server',

  async run(ctx: ReviewStageContext): Promise<StageResult> {
    const started = Date.now();

    if (ctx.kind === 'mcp_server') {
      // No install needed: the MCP relay talks to the publisher's server, and the
      // thing under review is that server's answer. Installing it into the sandbox
      // would prove the row inserts, which nothing doubts.
      const { findings, evidence } = await exerciseMcpServer(ctx.normalizedSpec, fetchForReview);
      return { stage: 'dynamic', verdict: verdictFor(findings), findings, evidence, durationMs: Date.now() - started };
    }

    let manifest: ConnectorManifest;
    try {
      manifest = parseConnectorManifest(ctx.normalizedSpec);
    } catch (error) {
      // The static stage already parses this, so reaching here means the spec
      // changed shape between stages — a platform bug, not a publisher's. Skipped
      // rather than failed, per the pipeline's rule 5.
      return skipped('dynamic', `the normalized manifest could not be re-parsed: ${error instanceof Error ? error.message : 'unknown'}`, started);
    }

    const sandboxTenantId = await resolveSandboxTenantId(ctx.db);
    if (sandboxTenantId === null) {
      return skipped('dynamic', 'no review sandbox workspace is available on this deployment — the package was not exercised', started);
    }

    const { findings, evidence } = await withSandboxInstall(
      ctx.db,
      ctx.env,
      { sandboxTenantId, packageId: ctx.packageId, versionId: ctx.versionId, scopes: ctx.scopes },
      (tenantId) => exerciseConnector(ctx, tenantId, manifest, fetchForReview),
    );

    return {
      stage: 'dynamic',
      verdict: verdictFor(findings),
      findings,
      evidence,
      durationMs: Date.now() - started,
      sandboxTenantId,
    };
  },
};
