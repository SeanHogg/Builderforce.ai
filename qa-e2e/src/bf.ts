/**
 * Builderforce auth + QA API helpers for the harness.
 *
 * Auth has two modes:
 *   1. Agent mode (production) — the platform dispatches this agent and injects
 *      a short-lived tenant-scoped token via BF_AGENT_TOKEN. The harness uses it
 *      directly; NO human email/password is involved. This is the normal path
 *      when the Agentic Tester runs as a scheduled/triggered platform agent.
 *   2. Operator mode (local dev / manual) — BF_QA_EMAIL + BF_QA_PASSWORD log a
 *      dedicated QA user in and exchange for a tenant token.
 *
 * Env:
 *   BF_API_URL       default https://api.builderforce.ai
 *   BF_BASE_URL      the app under test, e.g. https://builderforce.ai
 *   BF_AGENT_TOKEN   tenant-scoped JWT injected by the platform (agent mode)
 *   BF_QA_EMAIL      QA user email          (operator mode)
 *   BF_QA_PASSWORD   QA user password        (operator mode)
 *   BF_QA_TENANT_ID  optional — workspace to select (operator mode)
 */

export interface BfSession {
  webToken: string;
  tenantToken: string;
  user: { id: string; email: string; name?: string };
  tenant: { id: number; name: string; slug?: string; role?: string };
}

export function apiUrl(): string {
  return (process.env.BF_API_URL ?? 'https://api.builderforce.ai').replace(/\/$/, '');
}

export function baseUrl(): string {
  return (process.env.BF_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

async function postJson<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${apiUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`POST ${path} failed (${res.status}): ${txt.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function getJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${apiUrl()}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GET ${path} failed (${res.status}): ${txt.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

interface Tenant { id: number; name: string; slug?: string; role?: string }

/** Decode a JWT payload (no verification — we only read tid/sub the platform set). */
function decodeJwtPayload(token: string): { tid?: number; sub?: string; email?: string } {
  const part = token.split('.')[1];
  if (!part) return {};
  try {
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json) as { tid?: number; sub?: string; email?: string };
  } catch {
    return {};
  }
}

/**
 * Establish a session.
 *  - Agent mode: BF_AGENT_TOKEN is a tenant-scoped JWT the platform injected at
 *    dispatch. Use it directly; the tenant id comes from its `tid` claim. No
 *    human credentials, no /web/login round-trip.
 *  - Operator mode: log the QA user in and exchange for a tenant token.
 */
export async function login(): Promise<BfSession> {
  const agentToken = process.env.BF_AGENT_TOKEN?.trim();
  if (agentToken) {
    const claims = decodeJwtPayload(agentToken);
    if (!claims.tid) throw new Error('BF_AGENT_TOKEN has no tenant (tid) claim — not a tenant-scoped token.');
    return {
      webToken: agentToken,
      tenantToken: agentToken,
      user: { id: claims.sub ?? 'agent:qa-tester', email: claims.email ?? 'agent@builderforce.ai' },
      tenant: { id: claims.tid, name: 'agent', role: 'developer' },
    };
  }

  const email = requireEnv('BF_QA_EMAIL');
  const password = requireEnv('BF_QA_PASSWORD');

  const loginRes = await postJson<{
    token?: string;
    user?: { id: string; email: string; name?: string };
    mfaRequired?: boolean;
  }>('/api/auth/web/login', { email, password });

  if (loginRes.mfaRequired || !loginRes.token) {
    throw new Error('QA user requires MFA or login returned no token — use a dedicated non-MFA QA account.');
  }
  const webToken = loginRes.token;
  const user = loginRes.user ?? { id: 'qa', email };

  const tenantsRes = await getJson<Tenant[] | { tenants: Tenant[] }>('/api/auth/my-tenants', webToken);
  const tenants = Array.isArray(tenantsRes) ? tenantsRes : (tenantsRes.tenants ?? []);
  if (tenants.length === 0) throw new Error('QA user belongs to no workspace.');

  const wantId = process.env.BF_QA_TENANT_ID ? Number(process.env.BF_QA_TENANT_ID) : null;
  const tenant = (wantId ? tenants.find((t) => t.id === wantId) : tenants[0]) ?? tenants[0];

  const tokenRes = await postJson<{ token: string }>('/api/auth/tenant-token', { tenantId: tenant.id }, webToken);

  return { webToken, tenantToken: tokenRes.token, user, tenant };
}

export interface ActiveTest {
  id: string;
  name: string;
  slug: string;
  framework: string;
  spec: string;
}

export async function fetchActiveTests(session: BfSession): Promise<ActiveTest[]> {
  const res = await getJson<{ tests: ActiveTest[] }>('/api/qa/tests?status=active', session.tenantToken);
  return (res.tests ?? []).filter((t) => t.framework === 'playwright' && t.spec);
}

// ── Project mode ────────────────────────────────────────────────────────────
// When BF_PROJECT_ID is set, the harness tests a customer project: it pulls the
// project's target URL + active tests (each tagged with the persona it runs as)
// + the redacted credential list, then fetches each persona's decrypted secret
// to drive the site's login form.

export function projectId(): number | null {
  return process.env.BF_PROJECT_ID ? Number(process.env.BF_PROJECT_ID) : null;
}

export interface RunnerBundleTest { id: string; slug: string; name: string; spec: string; credentialId: string | null }
export interface RunnerCredential { id: string; label: string; role: string | null; username: string; loginUrl: string | null }
export interface RunnerBundle {
  target: { id: string; name: string; baseUrl: string } | null;
  tests: RunnerBundleTest[];
  credentials: RunnerCredential[];
}

export async function fetchRunnerBundle(session: BfSession, project: number): Promise<RunnerBundle> {
  return getJson<RunnerBundle>(`/api/qa/projects/${project}/runner-bundle`, session.tenantToken);
}

export interface CredentialSecret {
  id: string;
  username: string;
  password: string;
  loginUrl: string | null;
  loginSelectors: { usernameSelector?: string; passwordSelector?: string; submitSelector?: string } | null;
}

export async function fetchCredentialSecret(session: BfSession, credentialId: string): Promise<CredentialSecret> {
  return getJson<CredentialSecret>(`/api/qa/credentials/${credentialId}/secret`, session.tenantToken);
}

export interface RunReport {
  testSlug: string;
  projectId?: number | null;
  credentialId?: string | null;
  targetId?: string | null;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  browser?: string;
  targetUrl?: string;
  commitSha?: string;
  runKey?: string;
  durationMs?: number;
  errorMessage?: string;
  steps?: Array<{ seq: number; action: string; selector?: string; status: 'passed' | 'failed' | 'skipped'; durationMs?: number; errorMessage?: string }>;
}

export async function postRun(session: BfSession, report: RunReport): Promise<void> {
  await postJson('/api/qa/runs', report, session.tenantToken);
}

// ── Agentic Tester (heatmap-driven exploration) ──────────────────────────────
// The harness claims a queued exploration, drives a browser through its
// heat-derived plan, posts captured findings, and reports the outcome. Plan
// steps are QaStep-shaped; each carries the heat of the zone it targets.

export interface ExplorePlanStep {
  action: 'goto' | 'click' | 'fill' | 'expect' | 'press' | 'waitFor';
  selector?: string;
  route?: string;
  value?: string;
  assertion?: string;
  label?: string;
  heat?: number;
}

export interface ExplorationBundle {
  exploration: { id: string; status: string; projectId: number | null; heatBudget: number } | null;
  target?: { id: string; name: string; baseUrl: string } | null;
  credential?: { id: string; label: string; role: string | null; username: string; loginUrl: string | null } | null;
  plan?: ExplorePlanStep[];
}

export type ExploreFindingType = 'console' | 'pageerror' | 'network' | 'assertion' | 'crash' | 'navigation';

export interface ExploreFinding {
  type: ExploreFindingType;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  route?: string | null;
  selector?: string | null;
  message: string;
  detail?: string | null;
  heat?: number;
  screenshotKey?: string | null;
}

export interface ExplorationOutcome {
  status: 'running' | 'passed' | 'failed' | 'error';
  zonesExplored?: number;
  browser?: string;
  targetUrl?: string;
  commitSha?: string;
  runKey?: string;
  summary?: string;
  errorMessage?: string;
}

/** Claim a queued exploration (explicit id or oldest queued). Returns a bundle
 *  with `exploration: null` when there's nothing to run. */
export async function claimExploration(
  session: BfSession,
  opts: { explorationId?: string | null; projectId?: number | null } = {},
): Promise<ExplorationBundle> {
  return postJson<ExplorationBundle>('/api/qa/explorations/claim', {
    explorationId: opts.explorationId ?? undefined,
    projectId: opts.projectId ?? undefined,
  }, session.tenantToken);
}

export async function postFindings(session: BfSession, explorationId: string, findings: ExploreFinding[]): Promise<void> {
  if (findings.length === 0) return;
  await postJson(`/api/qa/explorations/${explorationId}/findings`, { findings }, session.tenantToken);
}

export async function patchExploration(session: BfSession, explorationId: string, outcome: ExplorationOutcome): Promise<void> {
  const res = await fetch(`${apiUrl()}/api/qa/explorations/${explorationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.tenantToken}` },
    body: JSON.stringify(outcome),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PATCH exploration failed (${res.status}): ${txt.slice(0, 300)}`);
  }
}
