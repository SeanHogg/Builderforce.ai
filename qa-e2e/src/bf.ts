/**
 * Builderforce auth + QA API helpers for the harness.
 *
 * Logs into the real auth API as the dedicated QA user, selects a workspace,
 * and exchanges for a tenant-scoped JWT — exactly what a real browser session
 * carries. The tokens are then injected into the browser's storageState
 * (see global-setup.ts) so generated specs run already-authenticated.
 *
 * Required env:
 *   BF_API_URL       default https://api.builderforce.ai
 *   BF_BASE_URL      the app under test, e.g. https://builderforce.ai
 *   BF_QA_EMAIL      QA user email
 *   BF_QA_PASSWORD   QA user password
 *   BF_QA_TENANT_ID  optional — workspace to select (else the first one)
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

/** Full login → workspace-select → tenant-token exchange. */
export async function login(): Promise<BfSession> {
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

export interface RunReport {
  testSlug: string;
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
