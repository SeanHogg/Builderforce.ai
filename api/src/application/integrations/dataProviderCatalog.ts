/**
 * Data + marketing provider catalog — THE source of truth for the 24
 * integrations the workflow builder advertised against nothing.
 *
 * The builder palette (`frontend/src/components/workflow-builder/integrations.ts`)
 * listed Postgres, Supabase, Snowflake, HubSpot, Mailchimp and 19 others as
 * droppable nodes. None of them could be connected — `integration_provider` had
 * no label to store them under — and none could run: every one compiles to the
 * `mcp` node kind, which the cloud executor refused outright. This module is the
 * missing backend for both halves:
 *
 *   • `credentialFields`  → what the connect form asks for, and what the
 *                           credential blob is allowed to contain.
 *   • `buildRequest`      → the actual HTTP call an operation makes, used
 *                           IDENTICALLY by the connectivity test and by the
 *                           workflow node. A provider that tests green therefore
 *                           cannot fail to execute for auth reasons.
 *
 * THE TRANSPORT BOUNDARY, STATED HONESTLY
 * A Cloudflare Worker cannot speak the MySQL, MongoDB, Redis or Snowflake wire
 * protocols — those need a raw TCP client this runtime does not carry. Rather
 * than offer a Connect button that silently never works, those providers are
 * marked `transport: 'tcp'`: their credentials still store and validate (so the
 * self-hosted runtime can use them), but the connectivity test and the cloud
 * node both return one specific, accurate message instead of a fake success.
 * `transport: 'http'` providers work end to end here.
 */

/** Which half of the catalog a provider belongs to. */
export type ProviderFamily = 'data' | 'marketing';

/** How the provider is reached from a Worker. See the transport note above. */
export type ProviderTransport = 'http' | 'tcp';

/** One credential input on the connect form. */
export interface CredentialField {
  key: string;
  label: string;
  /** `secret` fields are masked on read-back. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
}

/** A concrete HTTP call, or a stated refusal. */
export type ProviderRequest =
  | {
      ok: true;
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
    }
  | { ok: false; error: string };

export interface OperationSpec {
  id: string;
  label: string;
}

export interface ProviderSpec {
  id: string;
  label: string;
  family: ProviderFamily;
  transport: ProviderTransport;
  credentialFields: CredentialField[];
  operations: OperationSpec[];
  /** The operation the "Test connection" button runs — always a cheap read. */
  testOperation: string;
  /**
   * Build the HTTP call for an operation. `params` is the workflow node's
   * config, already parsed. Returns a refusal (never throws) so both callers
   * surface the same message.
   */
  buildRequest(op: string, creds: Record<string, unknown>, params: Record<string, unknown>): ProviderRequest;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/** A field the operation cannot run without. */
function missing(field: string): ProviderRequest {
  return { ok: false, error: `"${field}" is required for this operation.` };
}

function unsupportedOp(provider: string, op: string): ProviderRequest {
  return { ok: false, error: `${provider} does not support the "${op}" operation.` };
}

/** The one message every TCP-only provider gives, so the boundary reads the
 *  same everywhere it is hit. */
export function tcpTransportMessage(label: string): string {
  return `${label} speaks a binary database protocol that the cloud runtime cannot open. `
    + `The credential is stored and validated — run this node on a self-hosted agent host to use it.`;
}

/** Parse a `scheme://user:pass@host:port/db` DSN into its parts, or null. */
export interface ParsedDsn {
  scheme: string;
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
  params: Record<string, string>;
}

export function parseConnectionString(raw: string): ParsedDsn | null {
  const value = str(raw);
  if (!value) return null;
  // `new URL` handles the whole grammar including percent-encoded passwords,
  // which a hand-rolled regex reliably gets wrong.
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!url.protocol || !url.hostname) return null;
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { params[k] = v; });
  return {
    scheme: url.protocol.replace(/:$/, '').toLowerCase(),
    user: decodeURIComponent(url.username ?? ''),
    password: decodeURIComponent(url.password ?? ''),
    host: url.hostname.toLowerCase(),
    port: url.port,
    database: url.pathname.replace(/^\//, ''),
    params,
  };
}

/** Postgres-family DSN schemes we accept. */
const PG_SCHEMES = new Set(['postgres', 'postgresql']);

/**
 * Is this Postgres DSN reachable over HTTP?
 *
 * Neon exposes a first-class HTTP SQL endpoint, which is what makes "connect
 * your site's database" work from a Worker at all — and it is what this platform
 * itself runs on, so a site built here has one by default. Any other Postgres
 * host needs a TCP driver.
 */
export function isHttpQueryableDsn(dsn: ParsedDsn | null): boolean {
  if (!dsn || !PG_SCHEMES.has(dsn.scheme)) return false;
  return dsn.host.endsWith('.neon.tech');
}

/** Build the Neon HTTP-SQL request for a DSN + statement. */
export function neonSqlRequest(connectionString: string, statement: string, params: unknown[]): ProviderRequest {
  const dsn = parseConnectionString(connectionString);
  if (!dsn) return { ok: false, error: 'Connection string is not a valid postgres:// URL.' };
  if (!isHttpQueryableDsn(dsn)) {
    return {
      ok: false,
      error:
        `Host "${dsn.host}" is not reachable over HTTP from the cloud runtime. `
        + `Neon (*.neon.tech) exposes an HTTP SQL endpoint; other Postgres hosts need a self-hosted agent host.`,
    };
  }
  if (!statement) return missing('sql');
  return {
    ok: true,
    url: `https://${dsn.host}/sql`,
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      'neon-connection-string': connectionString,
      'neon-raw-text-output': 'true',
      'neon-array-mode': 'false',
    },
    body: JSON.stringify({ query: statement, params }),
  };
}

/** Credential field presets, so 24 providers do not each re-describe "API key". */
const API_KEY_FIELD: CredentialField = { key: 'apiKey', label: 'API key', secret: true, required: true };
const DSN_FIELD: CredentialField = {
  key: 'connectionString',
  label: 'Connection string',
  secret: true,
  required: true,
  placeholder: 'postgres://user:password@host/dbname',
};
const ACCESS_TOKEN_FIELD: CredentialField = { key: 'accessToken', label: 'Access token', secret: true, required: true };

/** A provider we can store + validate but not reach from this runtime. */
function tcpProvider(
  id: string,
  label: string,
  family: ProviderFamily,
  fields: CredentialField[] = [DSN_FIELD],
): ProviderSpec {
  return {
    id,
    label,
    family,
    transport: 'tcp',
    credentialFields: fields,
    operations: [{ id: 'query', label: 'Run a query' }],
    testOperation: 'query',
    buildRequest: () => ({ ok: false, error: tcpTransportMessage(label) }),
  };
}

// ---------------------------------------------------------------------------
// Data providers
// ---------------------------------------------------------------------------

const NEON_LIKE_OPS: OperationSpec[] = [
  { id: 'query', label: 'Run SQL' },
  { id: 'list-tables', label: 'List tables' },
];

/** Neon + generic Postgres share an implementation; only the label differs. */
function postgresLikeProvider(id: string, label: string): ProviderSpec {
  return {
    id,
    label,
    family: 'data',
    transport: 'http',
    credentialFields: [DSN_FIELD],
    operations: NEON_LIKE_OPS,
    testOperation: 'list-tables',
    buildRequest(op, creds, params) {
      const dsn = str(creds.connectionString);
      if (!dsn) return missing('connectionString');
      if (op === 'list-tables') {
        return neonSqlRequest(
          dsn,
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name LIMIT 200",
          [],
        );
      }
      if (op === 'query') {
        const statement = str(params.sql);
        const bind = Array.isArray(params.params) ? params.params : [];
        return neonSqlRequest(dsn, statement, bind);
      }
      return unsupportedOp(label, op);
    },
  };
}

const SUPABASE: ProviderSpec = {
  id: 'supabase',
  label: 'Supabase',
  family: 'data',
  transport: 'http',
  credentialFields: [
    { key: 'projectUrl', label: 'Project URL', secret: false, required: true, placeholder: 'https://abc.supabase.co' },
    { key: 'serviceKey', label: 'Service role key', secret: true, required: true },
  ],
  operations: [
    { id: 'list-rows', label: 'List rows' },
    { id: 'insert-row', label: 'Insert a row' },
  ],
  testOperation: 'list-rows',
  buildRequest(op, creds, params) {
    const base = str(creds.projectUrl).replace(/\/+$/, '');
    const key = str(creds.serviceKey);
    if (!base) return missing('projectUrl');
    if (!key) return missing('serviceKey');
    const headers = { ...JSON_HEADERS, apikey: key, authorization: `Bearer ${key}` };
    // The test runs against PostgREST's root, which lists the exposed schema —
    // a real auth check that needs no table name.
    if (op === 'list-rows' && !str(params.table)) {
      return { ok: true, url: `${base}/rest/v1/`, method: 'GET', headers };
    }
    const table = str(params.table);
    if (!table) return missing('table');
    if (op === 'list-rows') {
      const limit = Number(params.limit) > 0 ? Math.min(Number(params.limit), 1000) : 50;
      return { ok: true, url: `${base}/rest/v1/${encodeURIComponent(table)}?limit=${limit}`, method: 'GET', headers };
    }
    if (op === 'insert-row') {
      return {
        ok: true,
        url: `${base}/rest/v1/${encodeURIComponent(table)}`,
        method: 'POST',
        headers: { ...headers, prefer: 'return=representation' },
        body: JSON.stringify(params.record ?? {}),
      };
    }
    return unsupportedOp('Supabase', op);
  },
};

const AIRTABLE: ProviderSpec = {
  id: 'airtable',
  label: 'Airtable',
  family: 'data',
  transport: 'http',
  credentialFields: [API_KEY_FIELD],
  operations: [
    { id: 'list-bases', label: 'List bases' },
    { id: 'list-records', label: 'List records' },
    { id: 'create-record', label: 'Create a record' },
  ],
  testOperation: 'list-bases',
  buildRequest(op, creds, params) {
    const key = str(creds.apiKey);
    if (!key) return missing('apiKey');
    const headers = { ...JSON_HEADERS, authorization: `Bearer ${key}` };
    if (op === 'list-bases') {
      return { ok: true, url: 'https://api.airtable.com/v0/meta/bases', method: 'GET', headers };
    }
    const baseId = str(params.baseId);
    const table = str(params.table);
    if (!baseId) return missing('baseId');
    if (!table) return missing('table');
    const url = `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(table)}`;
    if (op === 'list-records') return { ok: true, url, method: 'GET', headers };
    if (op === 'create-record') {
      return { ok: true, url, method: 'POST', headers, body: JSON.stringify({ fields: params.record ?? {} }) };
    }
    return unsupportedOp('Airtable', op);
  },
};

const ELASTICSEARCH: ProviderSpec = {
  id: 'elasticsearch',
  label: 'Elasticsearch',
  family: 'data',
  transport: 'http',
  credentialFields: [
    { key: 'endpoint', label: 'Endpoint', secret: false, required: true, placeholder: 'https://my-cluster.es.io:9243' },
    API_KEY_FIELD,
  ],
  operations: [
    { id: 'cluster-info', label: 'Cluster info' },
    { id: 'search', label: 'Search an index' },
  ],
  testOperation: 'cluster-info',
  buildRequest(op, creds, params) {
    const base = str(creds.endpoint).replace(/\/+$/, '');
    const key = str(creds.apiKey);
    if (!base) return missing('endpoint');
    if (!key) return missing('apiKey');
    const headers = { ...JSON_HEADERS, authorization: `ApiKey ${key}` };
    if (op === 'cluster-info') return { ok: true, url: `${base}/`, method: 'GET', headers };
    if (op === 'search') {
      const index = str(params.index);
      if (!index) return missing('index');
      return {
        ok: true,
        url: `${base}/${encodeURIComponent(index)}/_search`,
        method: 'POST',
        headers,
        body: JSON.stringify(params.query ?? { query: { match_all: {} }, size: 10 }),
      };
    }
    return unsupportedOp('Elasticsearch', op);
  },
};

const CLICKHOUSE: ProviderSpec = {
  id: 'clickhouse',
  label: 'ClickHouse',
  family: 'data',
  transport: 'http',
  credentialFields: [
    { key: 'endpoint', label: 'HTTP endpoint', secret: false, required: true, placeholder: 'https://host:8443' },
    { key: 'username', label: 'Username', secret: false, required: true },
    { key: 'password', label: 'Password', secret: true, required: false },
  ],
  operations: [{ id: 'query', label: 'Run SQL' }],
  testOperation: 'query',
  buildRequest(op, creds, params) {
    const base = str(creds.endpoint).replace(/\/+$/, '');
    if (!base) return missing('endpoint');
    if (op !== 'query') return unsupportedOp('ClickHouse', op);
    const auth = btoa(`${str(creds.username)}:${str(creds.password)}`);
    // ClickHouse's HTTP interface takes the statement as the POST body.
    const statement = str(params.sql) || 'SELECT 1';
    return {
      ok: true,
      url: `${base}/?default_format=JSON`,
      method: 'POST',
      headers: { 'content-type': 'text/plain', authorization: `Basic ${auth}` },
      body: statement,
    };
  },
};

const BIGQUERY: ProviderSpec = {
  id: 'bigquery',
  label: 'Google BigQuery',
  family: 'data',
  transport: 'http',
  credentialFields: [
    { key: 'projectId', label: 'GCP project id', secret: false, required: true },
    ACCESS_TOKEN_FIELD,
  ],
  operations: [
    { id: 'list-datasets', label: 'List datasets' },
    { id: 'query', label: 'Run SQL' },
  ],
  testOperation: 'list-datasets',
  buildRequest(op, creds, params) {
    const project = str(creds.projectId);
    const token = str(creds.accessToken);
    if (!project) return missing('projectId');
    if (!token) return missing('accessToken');
    const headers = { ...JSON_HEADERS, authorization: `Bearer ${token}` };
    const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}`;
    if (op === 'list-datasets') return { ok: true, url: `${base}/datasets`, method: 'GET', headers };
    if (op === 'query') {
      const statement = str(params.sql);
      if (!statement) return missing('sql');
      return {
        ok: true,
        url: `${base}/queries`,
        method: 'POST',
        headers,
        body: JSON.stringify({ query: statement, useLegacySql: false }),
      };
    }
    return unsupportedOp('BigQuery', op);
  },
};

// ---------------------------------------------------------------------------
// Marketing providers
// ---------------------------------------------------------------------------

/**
 * Most marketing APIs are the same shape: a bearer key, a "who am I" read for
 * the connectivity test, and a contact upsert. Declaring them as data rather
 * than as 11 near-identical classes keeps the drift surface at zero.
 */
interface BearerMarketingSpec {
  id: string;
  label: string;
  base: string;
  /** Path the test hits — must be a cheap authenticated GET. */
  testPath: string;
  /** Path + body builder for `upsert-contact`. */
  contact?: (params: Record<string, unknown>) => { path: string; method: string; body: unknown };
  /** Header builder; defaults to `Authorization: Bearer <apiKey>`. */
  auth?: (creds: Record<string, unknown>) => Record<string, string>;
  listPath?: string;
}

function bearerMarketingProvider(spec: BearerMarketingSpec): ProviderSpec {
  const operations: OperationSpec[] = [
    { id: 'whoami', label: 'Check connection' },
    ...(spec.listPath ? [{ id: 'list-contacts', label: 'List contacts' }] : []),
    ...(spec.contact ? [{ id: 'upsert-contact', label: 'Add or update a contact' }] : []),
  ];
  return {
    id: spec.id,
    label: spec.label,
    family: 'marketing',
    transport: 'http',
    credentialFields: [API_KEY_FIELD],
    operations,
    testOperation: 'whoami',
    buildRequest(op, creds, params) {
      const key = str(creds.apiKey);
      if (!key) return missing('apiKey');
      const headers = { ...JSON_HEADERS, ...(spec.auth ? spec.auth(creds) : { authorization: `Bearer ${key}` }) };
      if (op === 'whoami') return { ok: true, url: `${spec.base}${spec.testPath}`, method: 'GET', headers };
      if (op === 'list-contacts' && spec.listPath) {
        return { ok: true, url: `${spec.base}${spec.listPath}`, method: 'GET', headers };
      }
      if (op === 'upsert-contact' && spec.contact) {
        const email = str(params.email);
        if (!email) return missing('email');
        const built = spec.contact(params);
        return {
          ok: true,
          url: `${spec.base}${built.path}`,
          method: built.method,
          headers,
          body: JSON.stringify(built.body),
        };
      }
      return unsupportedOp(spec.label, op);
    },
  };
}

const MARKETING_PROVIDER_SPECS: BearerMarketingSpec[] = [
  {
    id: 'hubspot',
    label: 'HubSpot',
    base: 'https://api.hubapi.com',
    testPath: '/crm/v3/objects/contacts?limit=1',
    listPath: '/crm/v3/objects/contacts?limit=100',
    contact: (p) => ({
      path: '/crm/v3/objects/contacts',
      method: 'POST',
      body: { properties: { email: str(p.email), firstname: str(p.name) } },
    }),
  },
  {
    id: 'klaviyo',
    label: 'Klaviyo',
    base: 'https://a.klaviyo.com',
    testPath: '/api/accounts/',
    listPath: '/api/profiles/',
    auth: (c) => ({ authorization: `Klaviyo-API-Key ${str(c.apiKey)}`, revision: '2024-10-15' }),
    contact: (p) => ({
      path: '/api/profiles/',
      method: 'POST',
      body: { data: { type: 'profile', attributes: { email: str(p.email), first_name: str(p.name) } } },
    }),
  },
  {
    id: 'customerio',
    label: 'Customer.io',
    base: 'https://api.customer.io',
    testPath: '/v1/api/segments',
    contact: (p) => ({
      path: `/v1/customers/${encodeURIComponent(str(p.email))}`,
      method: 'PUT',
      body: { email: str(p.email), name: str(p.name) },
    }),
  },
  {
    id: 'activecampaign',
    label: 'ActiveCampaign',
    base: 'https://account.api-us1.com',
    testPath: '/api/3/users/me',
    listPath: '/api/3/contacts?limit=100',
    auth: (c) => ({ 'api-token': str(c.apiKey) }),
    contact: (p) => ({
      path: '/api/3/contact/sync',
      method: 'POST',
      body: { contact: { email: str(p.email), firstName: str(p.name) } },
    }),
  },
  {
    id: 'attio',
    label: 'Attio',
    base: 'https://api.attio.com',
    testPath: '/v2/self',
    contact: (p) => ({
      path: '/v2/objects/people/records',
      method: 'PUT',
      body: { data: { values: { email_addresses: [{ email_address: str(p.email) }] } } },
    }),
  },
  {
    id: 'pipedrive',
    label: 'Pipedrive',
    base: 'https://api.pipedrive.com',
    testPath: '/v1/users/me',
    listPath: '/v1/persons',
    contact: (p) => ({
      path: '/v1/persons',
      method: 'POST',
      body: { name: str(p.name) || str(p.email), email: [{ value: str(p.email), primary: true }] },
    }),
  },
  {
    id: 'brevo',
    label: 'Brevo',
    base: 'https://api.brevo.com',
    testPath: '/v3/account',
    listPath: '/v3/contacts',
    auth: (c) => ({ 'api-key': str(c.apiKey) }),
    contact: (p) => ({
      path: '/v3/contacts',
      method: 'POST',
      body: { email: str(p.email), attributes: { FIRSTNAME: str(p.name) }, updateEnabled: true },
    }),
  },
  {
    id: 'zoho_crm',
    label: 'Zoho CRM',
    base: 'https://www.zohoapis.com',
    testPath: '/crm/v5/users?type=CurrentUser',
    auth: (c) => ({ authorization: `Zoho-oauthtoken ${str(c.apiKey)}` }),
    contact: (p) => ({
      path: '/crm/v5/Contacts/upsert',
      method: 'POST',
      body: { data: [{ Email: str(p.email), Last_Name: str(p.name) || str(p.email) }] },
    }),
  },
  {
    id: 'marketo',
    label: 'Adobe Marketo Engage',
    base: 'https://marketo.com',
    testPath: '/rest/v1/leads/describe.json',
    contact: (p) => ({
      path: '/rest/v1/leads.json',
      method: 'POST',
      body: { action: 'createOrUpdate', lookupField: 'email', input: [{ email: str(p.email) }] },
    }),
  },
  {
    id: 'salesforce',
    label: 'Salesforce',
    base: 'https://login.salesforce.com',
    testPath: '/services/oauth2/userinfo',
    contact: (p) => ({
      path: '/services/data/v60.0/sobjects/Contact',
      method: 'POST',
      body: { Email: str(p.email), LastName: str(p.name) || str(p.email) },
    }),
  },
];

/** Mailchimp is the one that does not fit the bearer shape — its host is
 *  datacenter-scoped and derived from the key's suffix. */
const MAILCHIMP: ProviderSpec = {
  id: 'mailchimp',
  label: 'Mailchimp',
  family: 'marketing',
  transport: 'http',
  credentialFields: [{ ...API_KEY_FIELD, placeholder: 'xxxxxxxx-us21' }],
  operations: [
    { id: 'whoami', label: 'Check connection' },
    { id: 'list-audiences', label: 'List audiences' },
    { id: 'upsert-contact', label: 'Add or update a contact' },
  ],
  testOperation: 'whoami',
  buildRequest(op, creds, params) {
    const key = str(creds.apiKey);
    if (!key) return missing('apiKey');
    const dc = key.split('-')[1];
    if (!dc) {
      return { ok: false, error: 'A Mailchimp key ends in its datacenter, like "…-us21".' };
    }
    const base = `https://${dc}.api.mailchimp.com/3.0`;
    const headers = { ...JSON_HEADERS, authorization: `Basic ${btoa(`anystring:${key}`)}` };
    if (op === 'whoami') return { ok: true, url: `${base}/`, method: 'GET', headers };
    if (op === 'list-audiences') return { ok: true, url: `${base}/lists`, method: 'GET', headers };
    if (op === 'upsert-contact') {
      const listId = str(params.listId);
      const email = str(params.email);
      if (!listId) return missing('listId');
      if (!email) return missing('email');
      return {
        ok: true,
        url: `${base}/lists/${encodeURIComponent(listId)}/members`,
        method: 'POST',
        headers,
        body: JSON.stringify({ email_address: email, status: 'subscribed', merge_fields: { FNAME: str(params.name) } }),
      };
    }
    return unsupportedOp('Mailchimp', op);
  },
};

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

const SPECS: ProviderSpec[] = [
  // data — HTTP reachable
  postgresLikeProvider('neon', 'Neon'),
  postgresLikeProvider('postgres', 'PostgreSQL'),
  SUPABASE,
  AIRTABLE,
  ELASTICSEARCH,
  CLICKHOUSE,
  BIGQUERY,
  // data — TCP only (stored + validated, executed on a self-hosted host)
  tcpProvider('mysql', 'MySQL', 'data'),
  tcpProvider('mongodb', 'MongoDB', 'data'),
  tcpProvider('redis', 'Redis', 'data'),
  tcpProvider('planetscale', 'PlanetScale', 'data'),
  tcpProvider('google_cloud_sql', 'Google Cloud SQL', 'data'),
  tcpProvider('snowflake', 'Snowflake', 'data', [
    { key: 'account', label: 'Account identifier', secret: false, required: true },
    { key: 'username', label: 'Username', secret: false, required: true },
    { key: 'password', label: 'Password', secret: true, required: true },
  ]),
  // marketing
  ...MARKETING_PROVIDER_SPECS.map(bearerMarketingProvider),
  MAILCHIMP,
];

/** Provider id → spec. */
export const PROVIDER_CATALOG: ReadonlyMap<string, ProviderSpec> = new Map(SPECS.map((s) => [s.id, s]));

/** Every id this catalog covers — the set the enum and the palette must match. */
export const CATALOG_PROVIDER_IDS: readonly string[] = SPECS.map((s) => s.id);

export const DATA_PROVIDER_IDS: readonly string[] = SPECS.filter((s) => s.family === 'data').map((s) => s.id);
export const MARKETING_PROVIDER_IDS: readonly string[] = SPECS.filter((s) => s.family === 'marketing').map((s) => s.id);

/**
 * Palette ids are kebab-case (`zoho-crm`, `google-cloud-sql`) because that is
 * what reads well in a UI list; Postgres enum labels are snake_case. Normalizing
 * here means the canvas can keep its own vocabulary and a node authored before
 * this catalog existed still resolves — rather than the two drifting into a
 * provider that renders in the palette and 404s at run time.
 */
export function normalizeProviderId(id: string): string {
  return String(id ?? '').trim().toLowerCase().replace(/-/g, '_');
}

export function providerSpec(id: string): ProviderSpec | null {
  return PROVIDER_CATALOG.get(normalizeProviderId(id)) ?? null;
}

/** The connect-form description for one provider — what the UI renders. */
export interface ProviderDescriptor {
  id: string;
  label: string;
  family: ProviderFamily;
  transport: ProviderTransport;
  credentialFields: CredentialField[];
  operations: OperationSpec[];
  /** Stated up front so the UI can warn BEFORE someone pastes a secret. */
  transportNote: string | null;
}

export function describeProviders(): ProviderDescriptor[] {
  return SPECS.map((s) => ({
    id: s.id,
    label: s.label,
    family: s.family,
    transport: s.transport,
    credentialFields: s.credentialFields,
    operations: s.operations,
    transportNote: s.transport === 'tcp' ? tcpTransportMessage(s.label) : null,
  }));
}

/**
 * Validate a credential blob against a provider's declared fields.
 *
 * Runs BEFORE encryption, so a credential that could never work is rejected at
 * the connect form rather than discovered at 3am by a failing workflow. DSN
 * fields get a real parse, not just a presence check.
 */
export function validateCredentials(
  spec: ProviderSpec,
  creds: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  for (const field of spec.credentialFields) {
    const value = creds[field.key];
    if (field.required && !str(value)) {
      return { ok: false, error: `${field.label} is required.` };
    }
    if (field.key === 'connectionString' && str(value) && !parseConnectionString(str(value))) {
      return { ok: false, error: 'Connection string must be a URL like postgres://user:password@host/dbname.' };
    }
    if (field.key === 'projectUrl' || field.key === 'endpoint') {
      const url = str(value);
      if (url && !/^https?:\/\//i.test(url)) {
        return { ok: false, error: `${field.label} must start with https://.` };
      }
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ProviderCallResult {
  ok: boolean;
  status: number;
  /** Parsed JSON when the response was JSON, else the raw text (capped). */
  body: unknown;
  error?: string;
}

/** Response bodies are capped: a workflow payload must not be unbounded. */
const MAX_RESPONSE_CHARS = 32_000;

/**
 * Execute one provider operation. THE single place an integration's HTTP call
 * is made — the connectivity test and the workflow `mcp` node both land here, so
 * "it tested green" and "it ran" cannot mean different things.
 */
export async function callProvider(
  providerId: string,
  op: string,
  creds: Record<string, unknown>,
  params: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderCallResult> {
  const spec = providerSpec(providerId);
  if (!spec) return { ok: false, status: 0, body: null, error: `Unknown provider "${providerId}".` };

  const request = spec.buildRequest(op, creds, params);
  if (!request.ok) return { ok: false, status: 0, body: null, error: request.error };

  try {
    const res = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    const text = (await res.text().catch(() => '')).slice(0, MAX_RESPONSE_CHARS);
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (an HTML error page, a plain-text quota notice). The raw text
      // IS the answer the workflow node should see, so it becomes the body.
      body = text;
    }
    return {
      ok: res.ok,
      status: res.status,
      body,
      error: res.ok ? undefined : `${spec.label} returned ${res.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: error instanceof Error ? error.message : `${spec.label} request failed.`,
    };
  }
}

/**
 * Connectivity test for a catalog provider — the same call the node makes,
 * against the provider's designated cheap read.
 */
export async function testCatalogProvider(
  providerId: string,
  creds: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; message: string }> {
  const spec = providerSpec(providerId);
  if (!spec) return { ok: false, message: `Unknown provider "${providerId}".` };
  if (spec.transport === 'tcp') {
    return { ok: false, message: tcpTransportMessage(spec.label) };
  }
  const result = await callProvider(providerId, spec.testOperation, creds, {}, fetchImpl);
  if (result.ok) return { ok: true, message: `Connected to ${spec.label}.` };
  return { ok: false, message: result.error ?? `${spec.label} rejected the credentials.` };
}
