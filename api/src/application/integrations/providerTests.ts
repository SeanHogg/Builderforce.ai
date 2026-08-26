/**
 * Connectivity tests for every connectable provider — ONE registry.
 *
 * These used to be 17 functions and a 17-case `switch` inside
 * `presentation/routes/integrationRoutes.ts`. Adding the Data + Marketing
 * families would have made that switch 41 cases long in a route handler, so the
 * dispatch is now a lookup table and the HTTP clients live in the application
 * layer where they belong.
 *
 * Two sources feed the table:
 *   • the SCM/PM/ITSM providers below, each with its own hand-written probe;
 *   • the Data + Marketing catalog (`dataProviderCatalog.ts`), whose probe is
 *     derived from the same `buildRequest` the workflow node executes — so for
 *     those providers a passing test and a working node are the same code path
 *     by construction, not by review.
 *
 * Every probe returns `{ ok, message }` and never throws: a failed test is a
 * normal answer, and the message is shown to the user verbatim.
 */

import { githubStatusMessage } from './githubTestError';
import { exaSearchVendor, linkupSearchVendor, ollamaSearchVendor, tavilySearchVendor, type WebSearchVendor } from '../runtime/webSearchVendors';
import { testGmail, testGoogleDrive } from './googleOAuth';
import {
  CATALOG_PROVIDER_IDS,
  describeProviders,
  providerSpec,
  testCatalogProvider,
  validateCredentials,
  type ProviderDescriptor,
} from './dataProviderCatalog';

export interface TestResult {
  ok: boolean;
  message: string;
}

/** A probe: takes the decrypted blob and the credential's optional base URL. */
export type ProviderTest = (
  creds: Record<string, unknown>,
  baseUrl: string | null,
) => Promise<TestResult>;

// ---------------------------------------------------------------------------
// SCM / PM / ITSM probes
// ---------------------------------------------------------------------------

async function testGitHub(creds: Record<string, unknown>): Promise<TestResult> {
  const token = creds.accessToken as string;
  if (!token) return { ok: false, message: 'accessToken is required' };
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Builderforce/1.0', Accept: 'application/vnd.github+json' },
    });
    return res.ok
      ? { ok: true, message: 'Connected' }
      : { ok: false, message: githubStatusMessage(res.status, 'token') };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Network error contacting GitHub' };
  }
}

/** Connectivity test for a BYO web-search key: run one real query through the SAME
 *  vendor adapter the agent uses, so "Test" proves exactly what `web_search` will do
 *  (right key, right endpoint, right parse) rather than a look-alike request.
 *
 *  One factory for every keyed search vendor — the adapters already differ where they
 *  need to, and a per-vendor copy of this would only differ in the noun. */
function testWebSearchVendor(vendor: WebSearchVendor) {
  return async (creds: Record<string, unknown>): Promise<TestResult> => {
    const raw = creds.apiKey ?? creds.apiToken ?? creds.token;
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key) return { ok: false, message: 'apiKey is required' };
    const r = await vendor.search('builderforce connectivity check', { apiKey: key });
    return r.ok
      ? { ok: true, message: `Connected — ${r.results?.length ?? 0} result(s). Research now searches ${vendor.label}'s full web index instead of the keyless encyclopedic one.` }
      : { ok: false, message: r.error ?? 'Search request failed' };
  };
}

async function testJira(creds: Record<string, unknown>, baseUrl: string | null): Promise<TestResult> {
  const token = creds.apiToken as string;
  const email = creds.email as string;
  if (!token || !email || !baseUrl) return { ok: false, message: 'email, apiToken, and baseUrl are required' };
  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/myself`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${btoa(`${email}:${token}`)}`, Accept: 'application/json' },
  });
  return res.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `Jira API returned ${res.status}` };
}

async function testBitbucket(creds: Record<string, unknown>): Promise<TestResult> {
  const token = creds.accessToken as string;
  if (!token) return { ok: false, message: 'accessToken is required' };
  const res = await fetch('https://api.bitbucket.org/2.0/user', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `Bitbucket API returned ${res.status}` };
}

async function testGitLab(creds: Record<string, unknown>, baseUrl: string | null): Promise<TestResult> {
  const token = creds.accessToken as string;
  if (!token) return { ok: false, message: 'accessToken is required' };
  // Self-hosted GitLab supported via baseUrl; default to gitlab.com.
  const root = baseUrl?.replace(/\/$/, '') || 'https://gitlab.com';
  const res = await fetch(`${root}/api/v4/user`, {
    headers: { Authorization: `Bearer ${token}`, 'PRIVATE-TOKEN': token },
  });
  return res.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `GitLab API returned ${res.status}` };
}

async function testConfluence(creds: Record<string, unknown>, baseUrl: string | null): Promise<TestResult> {
  const token = creds.apiToken as string;
  const email = creds.email as string;
  if (!token || !email || !baseUrl) return { ok: false, message: 'email, apiToken, and baseUrl are required' };
  // Confluence Cloud REST API — list spaces (limit 1 is a lightweight auth probe)
  const url = `${baseUrl.replace(/\/$/, '')}/wiki/rest/api/space?limit=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${btoa(`${email}:${token}`)}`, Accept: 'application/json' },
  });
  return res.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `Confluence API returned ${res.status}` };
}

async function testFreshservice(creds: Record<string, unknown>, baseUrl: string | null): Promise<TestResult> {
  const apiKey = creds.apiKey as string;
  if (!apiKey || !baseUrl) return { ok: false, message: 'apiKey and baseUrl are required' };
  // Freshservice REST API — fetch the authenticated agent profile. Basic auth
  // with apiKey as username and "X" as password.
  const url = `${baseUrl.replace(/\/$/, '')}/api/v2/agents/me`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${btoa(`${apiKey}:X`)}`, Accept: 'application/json' },
  });
  return res.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `Freshservice API returned ${res.status}` };
}

async function testFreshdesk(creds: Record<string, unknown>, baseUrl: string | null): Promise<TestResult> {
  const apiKey = creds.apiKey as string;
  if (!apiKey || !baseUrl) return { ok: false, message: 'apiKey and baseUrl are required' };
  const url = `${baseUrl.replace(/\/$/, '')}/api/v2/agents?per_page=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${btoa(`${apiKey}:X`)}`, Accept: 'application/json' },
  });
  return res.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `Freshdesk API returned ${res.status}` };
}

async function testLinear(creds: Record<string, unknown>): Promise<TestResult> {
  const apiKey = creds.apiKey as string;
  if (!apiKey) return { ok: false, message: 'apiKey is required' };
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ viewer { id } }' }),
  });
  if (!res.ok) return { ok: false, message: `Linear API returned ${res.status}` };
  const json = (await res.json()) as { errors?: unknown[] };
  return json.errors?.length ? { ok: false, message: 'Linear rejected the API key' } : { ok: true, message: 'Connected' };
}

async function testSentry(creds: Record<string, unknown>, baseUrl: string | null): Promise<TestResult> {
  const token = creds.token as string;
  if (!token) return { ok: false, message: 'token is required' };
  const root = baseUrl?.replace(/\/$/, '') || 'https://sentry.io';
  const res = await fetch(`${root}/api/0/organizations/`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return res.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `Sentry API returned ${res.status}` };
}

async function testPagerDuty(creds: Record<string, unknown>): Promise<TestResult> {
  const apiToken = creds.apiToken as string;
  if (!apiToken) return { ok: false, message: 'apiToken is required' };
  const res = await fetch('https://api.pagerduty.com/users?limit=1', {
    headers: { Authorization: `Token token=${apiToken}`, Accept: 'application/vnd.pagerduty+json;version=2' },
  });
  return res.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `PagerDuty API returned ${res.status}` };
}

async function testServiceNow(creds: Record<string, unknown>, baseUrl: string | null): Promise<TestResult> {
  const username = creds.username as string;
  const password = creds.password as string;
  if (!username || !password || !baseUrl) return { ok: false, message: 'username, password, and baseUrl are required' };
  const url = `${baseUrl.replace(/\/$/, '')}/api/now/table/sys_user?sysparm_limit=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${btoa(`${username}:${password}`)}`, Accept: 'application/json' },
  });
  return res.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `ServiceNow API returned ${res.status}` };
}

async function testMonday(creds: Record<string, unknown>): Promise<TestResult> {
  const token = creds.token as string;
  if (!token) return { ok: false, message: 'token is required' };
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json', 'API-Version': '2024-01' },
    body: JSON.stringify({ query: '{ me { id } }' }),
  });
  if (!res.ok) return { ok: false, message: `monday API returned ${res.status}` };
  const json = (await res.json()) as { errors?: unknown[] };
  return json.errors?.length ? { ok: false, message: 'monday rejected the token' } : { ok: true, message: 'Connected' };
}

async function testAsana(creds: Record<string, unknown>): Promise<TestResult> {
  const token = creds.accessToken as string;
  if (!token) return { ok: false, message: 'accessToken is required' };
  const res = await fetch('https://app.asana.com/api/1.0/users/me', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return res.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `Asana API returned ${res.status}` };
}

async function testClickUp(creds: Record<string, unknown>): Promise<TestResult> {
  const token = creds.token as string;
  if (!token) return { ok: false, message: 'token is required' };
  const res = await fetch('https://api.clickup.com/api/v2/user', {
    headers: { Authorization: token, Accept: 'application/json' },
  });
  return res.ok ? { ok: true, message: 'Connected' } : { ok: false, message: `ClickUp API returned ${res.status}` };
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** Hand-written probes, keyed by provider id. */
const LEGACY_TESTS: Record<string, ProviderTest> = {
  github: testGitHub,
  gitlab: testGitLab,
  jira: testJira,
  bitbucket: testBitbucket,
  confluence: testConfluence,
  freshservice: testFreshservice,
  freshdesk: testFreshdesk,
  linear: testLinear,
  sentry: testSentry,
  pagerduty: testPagerDuty,
  servicenow: testServiceNow,
  monday: testMonday,
  asana: testAsana,
  clickup: testClickUp,
  tavily: testWebSearchVendor(tavilySearchVendor),
  ollama: testWebSearchVendor(ollamaSearchVendor),
  exa: testWebSearchVendor(exaSearchVendor),
  linkup: testWebSearchVendor(linkupSearchVendor),
  gmail: (creds) => testGmail(creds),
  google_drive: (creds) => testGoogleDrive(creds),
};

/**
 * Every provider a credential can be stored for. Derived — the catalog half is
 * not re-listed here, so adding a provider to the catalog cannot leave the
 * connect endpoint rejecting it.
 *
 * `google_calendar`, `rally` and `freshworks` are deliberately absent: they are
 * managed by their own OAuth/board-sync flows, not this CRUD.
 */
export const CONNECTABLE_PROVIDERS: readonly string[] = [
  ...Object.keys(LEGACY_TESTS),
  ...CATALOG_PROVIDER_IDS,
];

const CONNECTABLE_SET = new Set(CONNECTABLE_PROVIDERS);

export function isConnectableProvider(provider: unknown): provider is string {
  return typeof provider === 'string' && CONNECTABLE_SET.has(provider);
}

/**
 * Run the connectivity probe for a provider.
 *
 * Catalog providers route through `testCatalogProvider`, which issues the same
 * request their workflow node will; legacy providers use their bespoke probe.
 */
export async function testProviderCredential(
  provider: string,
  creds: Record<string, unknown>,
  baseUrl: string | null,
): Promise<TestResult> {
  const legacy = LEGACY_TESTS[provider];
  if (legacy) return legacy(creds, baseUrl);
  if (providerSpec(provider)) return testCatalogProvider(provider, creds);
  return { ok: false, message: `Connectivity test not available for provider: ${provider}` };
}

/**
 * Validate a credential blob before it is encrypted and stored.
 *
 * Only catalog providers declare their fields, so only they can be checked;
 * legacy providers keep today's behaviour (their probe is the validation).
 */
export function validateProviderCredentials(
  provider: string,
  creds: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  const spec = providerSpec(provider);
  if (!spec) return { ok: true };
  return validateCredentials(spec, creds);
}

/** The catalog descriptors the connect UI renders. */
export function connectableCatalog(): ProviderDescriptor[] {
  return describeProviders();
}
