/**
 * Built-in connectors — HRMS and ATS, the READ side.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * The catalog could publish a requisition outward (`defaults/hiring.ts`) and read
 * a pay run back (`defaults/payroll.ts`), and had no way at all to read the
 * customer's OWN people. So `employees`, `project_role_assignments`, capacity and
 * every headcount number the PMO surfaces were typed in by hand, and the answer
 * to "who actually works here" lived in a system this product could not reach.
 * `hiring` was a category with one direction.
 *
 * ── READ-ONLY, ON PURPOSE ────────────────────────────────────────────────────
 * Every action here is a GET. Not an oversight — a decision, and the same one
 * `defaults/payroll.ts` made one domain over: an HRMS is the system of record for
 * somebody's employment, compensation and leave, and a mistaken write into it is
 * a person's salary or their termination date. What this platform owes a customer
 * is the ability to READ their roster so the org chart, the capacity model and the
 * burn forecast describe real people, not a spreadsheet somebody re-keyed.
 *
 * The one shape that is genuinely bidirectional — a requisition going out and
 * applications coming back — already exists as `defaults/hiring.ts`, and stays
 * there. A tenant will commonly have both, pointed at different systems: Workday
 * as the roster, Greenhouse as the funnel. Collapsing them would make "where do
 * our applications come from" unanswerable, which is exactly why `hiring.ts` says
 * so in its own header.
 *
 * ── WHY THE SAME VENDOR APPEARS TWICE ────────────────────────────────────────
 * `greenhouse-job-board` (hiring) and `greenhouse-ats` (here) are two manifests on
 * ONE API for the same reason `twilio` and `twilio-conversations` are: they are
 * connected by different people for different reasons, and a single card carrying
 * both would put "publish this role" and "read our candidate pipeline" behind the
 * same consent. The connection is per-manifest, so a recruiter can be given the
 * funnel without being given the roster.
 *
 * ── WHY THESE ARE DATA ───────────────────────────────────────────────────────
 * Migration 0410 made a connector DATA. Adding Personio, Hibob or a
 * country-specific HRIS is an entry in this file — reviewed like data, validated
 * by the same `parseConnectorManifest` gate tenant-authored connectors pass, and
 * shipped with no new code path. Every call is credentialled per tenant and
 * audited, because it goes through `connectorTools.ts` like every other connector
 * call. There is no HRMS *service*, and there should not be one.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, p, q, qn } from './dsl';

/**
 * The shared roster read, declared once.
 *
 * Every HRIS here answers the same three questions about a person — who they are,
 * where they sit in the org, and are they still employed — and they disagree only
 * on field names, which is what the manifest's `path`/`params` mapping is for.
 * Writing them out per vendor is how five providers come to expose five slightly
 * different ideas of what an employee is.
 *
 * `updated_since` is on every one of them deliberately: a full roster is not a
 * page, and a sync that can only ever re-read everything is a sync nobody can run
 * on a schedule.
 */
const ROSTER_QUERY = {
  updated_since: q('ISO date — only people whose record changed on or after this. Use it for every repeat sync; a full roster is not a page.'),
  page: qn('1-based page number'),
  per_page: qn('Page size. Keep it bounded.'),
} as const;

/**
 * Workday — the one that is a tenant URL, not a vendor URL.
 *
 * Every other API here lives at the vendor's own host. Workday is deployed per
 * customer, so the host, the tenant name AND the API version are all customer
 * facts, which is why three of them are auth fields rather than constants. A
 * manifest that hard-coded `https://wd2-impl-services1.workday.com` would work for
 * exactly one customer.
 *
 * The REST API is version-pinned in the PATH (`/ccx/api/v1/{tenant}`), so the
 * version has to be part of the base URL rather than a header — which is also why
 * it is asked for on the form: a customer on v1 and a customer on v2 cannot share
 * a constant, and guessing wrong 404s every call with no clue why.
 */
const workday: ConnectorManifest = {
  key: 'workday',
  name: 'Workday',
  description: 'Read the employee roster, org structure and time-off balances from Workday — so headcount and capacity describe real people.',
  category: 'hiring',
  icon: '🏢',
  baseUrl: 'https://{{auth.host}}/ccx/api/{{auth.apiVersion}}/{{auth.tenant}}',
  docsUrl: 'https://community.workday.com/sites/default/files/file-hosting/restapi/',
  auth: {
    kind: 'bearer',
    fields: [
      {
        key: 'host', label: 'Workday host', secret: false, required: true,
        placeholder: 'wd2-impl-services1.workday.com',
        help: 'The hostname from your Workday URL, with no scheme and no trailing slash. Workday is deployed per customer, so there is no shared host.',
      },
      {
        key: 'tenant', label: 'Tenant name', secret: false, required: true,
        placeholder: 'acme_pt1',
        help: 'The tenant segment of your Workday URL — the part after the host and before the module.',
      },
      {
        key: 'apiVersion', label: 'API version', secret: false, required: true,
        placeholder: 'v1',
        help: 'Workday pins the REST version in the path, not a header. Copy it from the API endpoint Workday shows you; guessing 404s every call.',
      },
      {
        key: 'token', label: 'Access token', secret: true, required: true,
        help: 'An OAuth 2.0 bearer token for an Integration System User with the Workers domain. Workday tokens expire — reconnect when calls start returning 401.',
      },
    ],
  },
  actions: [
    {
      key: 'list_workers', label: 'List employees', description: 'Read the worker roster — names, job titles, org and employment status.',
      method: 'GET', path: '/workers', mutates: false, resultPath: 'data',
      params: ROSTER_QUERY,
    },
    {
      key: 'get_worker', label: 'Get one employee', description: 'Read one worker in full by their Workday id.',
      method: 'GET', path: '/workers/{worker_id}', mutates: false,
      params: { worker_id: p('Workday worker WID') },
    },
    {
      key: 'list_organizations', label: 'List organizations', description: 'Read the supervisory org tree — what the org chart is actually shaped like.',
      method: 'GET', path: '/supervisoryOrganizations', mutates: false, resultPath: 'data',
      params: { limit: qn('Page size'), offset: qn('0-based offset') },
    },
    {
      key: 'list_time_off', label: 'List time off', description: 'Read absence and leave entries, so capacity accounts for who is away.',
      method: 'GET', path: '/workers/{worker_id}/timeOffEntries', mutates: false, resultPath: 'data',
      params: { worker_id: p('Workday worker WID'), fromDate: q('ISO date'), toDate: q('ISO date') },
    },
  ],
};

/**
 * BambooHR — also a per-customer host, and the auth that reads as a mistake.
 *
 * The API key goes in the basic-auth USERNAME and the password is literally the
 * string `x`. That is BambooHR's documented scheme, not a workaround, and the
 * `help` text says so because an operator who assumes the key is the password
 * gets a 401 with nothing on the form to explain it — the same trap
 * `TWILIO_REST_CREDENTIALS` exists to close.
 */
const bamboohr: ConnectorManifest = {
  key: 'bamboohr',
  name: 'BambooHR',
  description: 'Read the employee directory, job history and time-off requests from BambooHR.',
  category: 'hiring',
  icon: '🎋',
  baseUrl: 'https://api.bamboohr.com/api/gateway.php/{{auth.subdomain}}/v1',
  docsUrl: 'https://documentation.bamboohr.com/reference',
  auth: {
    kind: 'basic',
    fields: [
      {
        key: 'subdomain', label: 'Company subdomain', secret: false, required: true,
        placeholder: 'acme',
        help: 'The first part of your BambooHR URL — acme.bamboohr.com → acme.',
      },
      {
        key: 'username', label: 'API key', secret: true, required: true,
        help: 'BambooHR → your profile → API Keys. It goes in the USERNAME field; the password below is the literal letter x, which is BambooHR\'s documented scheme rather than a placeholder.',
      },
      {
        key: 'password', label: 'Password (use "x")', secret: false, required: true,
        placeholder: 'x',
        help: 'BambooHR ignores this and documents the literal value "x". Putting the API key here instead is the usual cause of a 401.',
      },
    ],
  },
  // BambooHR answers XML unless asked otherwise, and the JSON it returns when
  // asked is a different shape entirely — so the pin belongs on every action.
  defaultHeaders: { Accept: 'application/json' },
  actions: [
    {
      key: 'list_employees', label: 'List employees', description: 'Read the employee directory.',
      method: 'GET', path: '/employees/directory', mutates: false, resultPath: 'employees',
      params: {},
    },
    {
      key: 'get_employee', label: 'Get one employee', description: 'Read one employee\'s fields.',
      method: 'GET', path: '/employees/{employee_id}', mutates: false,
      params: {
        employee_id: p('BambooHR employee id, or "0" for the authenticated user'),
        fields: q('Comma-separated field list, e.g. "firstName,lastName,jobTitle,department,hireDate,status"'),
      },
    },
    {
      key: 'list_time_off_requests', label: 'List time-off requests', description: 'Read leave requests in a date window.',
      method: 'GET', path: '/time_off/requests', mutates: false,
      params: {
        start: q('ISO date — window start (required by BambooHR)'),
        end: q('ISO date — window end (required by BambooHR)'),
        status: q('approved | denied | superseded | requested | canceled'),
        employeeId: qn('Restrict to one employee'),
      },
    },
    {
      key: 'list_changed_employees', label: 'List changed employees', description: 'Read only the people whose record changed since a timestamp — the incremental sync.',
      method: 'GET', path: '/employees/changed', mutates: false, resultPath: 'employees',
      params: { since: q('ISO 8601 instant'), type: q('inserted | updated | deleted') },
    },
  ],
};

/**
 * HiBob — the roster read whose pagination is a body field.
 *
 * `/people/search` is a POST that RETURNS data, which makes `mutates: false` look
 * wrong and is exactly why the flag is a declaration rather than an inference off
 * the HTTP method: the confirm gate must not prompt somebody for reading their own
 * directory, and inferring "POST means write" would make it do so.
 */
const hibob: ConnectorManifest = {
  key: 'hibob',
  name: 'HiBob',
  description: 'Read the people directory, org structure and time off from HiBob (Bob).',
  category: 'hiring',
  icon: '🟡',
  baseUrl: 'https://api.hibob.com/v1',
  docsUrl: 'https://apidocs.hibob.com',
  auth: {
    kind: 'basic',
    fields: [
      { key: 'username', label: 'Service user ID', secret: false, required: true, help: 'Bob → Settings → Integrations → Service users. The ID, not the token.' },
      { key: 'password', label: 'Service user token', secret: true, required: true, help: 'The token generated alongside the service user ID above.' },
    ],
  },
  actions: [
    {
      // POST, and still a read — see the header.
      key: 'search_people', label: 'List employees', description: 'Read the people directory. A POST that returns data, not a write.',
      method: 'POST', path: '/people/search', mutates: false, resultPath: 'employees',
      params: {
        fields: b('Array of field paths to return, e.g. ["root.id","root.fullName","work.title","work.department"]'),
        showInactive: b('Set true to include leavers'),
        humanReadable: b('APPEND | REPLACE — returns display values instead of internal ids'),
      },
    },
    {
      key: 'get_person', label: 'Get one employee', description: 'Read one person by id or email.',
      method: 'GET', path: '/people/{identifier}', mutates: false,
      params: { identifier: p('Employee id or work email') },
    },
    {
      key: 'list_time_off', label: 'List who is out', description: 'Read who is away on a given day — the read capacity planning actually needs.',
      method: 'GET', path: '/timeoff/outtoday', mutates: false, resultPath: 'outs',
      params: { date: q('ISO date (defaults to today)'), includeHourly: q('true to include part-day absences') },
    },
  ],
};

/**
 * Personio — the one whose token is minted per call.
 *
 * Personio's `client_id`/`client_secret` exchange for a SHORT-LIVED bearer, and
 * the manifest runtime has no token-exchange step: it sends the credential it was
 * given. So the field asked for is the token itself, and the help text says where
 * it comes from and that it expires — which is honest, rather than a form that
 * looks like it will keep working and stops after 24 hours with a 401.
 *
 * Recorded in the register as the reason a `client_credentials` grant type in the
 * connector runtime would be worth building: four manifests across this catalog
 * would use it.
 */
const personio: ConnectorManifest = {
  key: 'personio',
  name: 'Personio',
  description: 'Read the employee list, attendance and absences from Personio.',
  category: 'hiring',
  icon: '🧿',
  baseUrl: 'https://api.personio.de/v1',
  docsUrl: 'https://developer.personio.de/reference',
  auth: {
    kind: 'bearer',
    fields: [
      {
        key: 'token', label: 'Access token', secret: true, required: true,
        help: 'POST your client_id + client_secret to https://api.personio.de/v1/auth and paste the token it returns. Personio tokens are short-lived — reconnect when calls start returning 401.',
      },
    ],
  },
  actions: [
    {
      key: 'list_employees', label: 'List employees', description: 'Read the employee roster.',
      method: 'GET', path: '/company/employees', mutates: false, resultPath: 'data',
      params: { limit: qn('Page size'), offset: qn('0-based offset'), updated_since: q('ISO instant') },
    },
    {
      key: 'get_employee', label: 'Get one employee', description: 'Read one employee record.',
      method: 'GET', path: '/company/employees/{employee_id}', mutates: false, resultPath: 'data',
      params: { employee_id: p('Personio employee id') },
    },
    {
      key: 'list_absences', label: 'List absences', description: 'Read absence periods, so capacity accounts for who is away.',
      method: 'GET', path: '/company/time-offs', mutates: false, resultPath: 'data',
      params: { start_date: q('ISO date'), end_date: q('ISO date'), limit: qn('Page size'), offset: qn('0-based offset') },
    },
    {
      key: 'list_attendances', label: 'List attendance', description: 'Read logged working time — the hours half of a capacity model.',
      method: 'GET', path: '/company/attendances', mutates: false, resultPath: 'data',
      params: { start_date: q('ISO date'), end_date: q('ISO date'), limit: qn('Page size'), offset: qn('0-based offset') },
    },
  ],
};

/**
 * Rippling — the roster read behind a per-app bearer.
 *
 * Included because it is the HRIS a startup that already uses this product is most
 * likely to be on, and because its roster endpoint answers the org-chart question
 * (`manager`, `department`, `workLocation`) in one call rather than three.
 */
const rippling: ConnectorManifest = {
  key: 'rippling',
  name: 'Rippling',
  description: 'Read employees, departments and work locations from Rippling.',
  category: 'hiring',
  icon: '🌊',
  baseUrl: 'https://api.rippling.com/platform/api',
  docsUrl: 'https://developer.rippling.com/documentation/rest-api',
  auth: {
    kind: 'bearer',
    fields: [
      { key: 'token', label: 'API key', secret: true, required: true, help: 'Rippling → Settings → API access → generate an API key for your app. Scope it to read-only; nothing here writes.' },
    ],
  },
  actions: [
    {
      key: 'list_employees', label: 'List employees', description: 'Read the employee roster with manager, department and location.',
      method: 'GET', path: '/employees', mutates: false,
      params: { limit: qn('Page size'), offset: qn('0-based offset') },
    },
    {
      key: 'get_employee', label: 'Get one employee', description: 'Read one employee in full.',
      method: 'GET', path: '/employees/{employee_id}', mutates: false,
      params: { employee_id: p('Rippling employee id') },
    },
    {
      key: 'list_departments', label: 'List departments', description: 'Read the department list the org chart groups by.',
      method: 'GET', path: '/departments', mutates: false,
      params: { limit: qn('Page size') },
    },
    {
      key: 'list_leave_requests', label: 'List leave requests', description: 'Read time-off requests and their approval state.',
      method: 'GET', path: '/leave_requests', mutates: false,
      params: { from: q('ISO date'), to: q('ISO date'), status: q('APPROVED | PENDING | DECLINED') },
    },
  ],
};

/**
 * Greenhouse — the ATS half, read-only.
 *
 * Same Harvest API as `greenhouse-job-board`, deliberately a separate card: see
 * the file header on why one vendor appears twice. This one reads the PIPELINE —
 * candidates, applications, scheduled interviews and scorecards — which is what a
 * hiring-funnel view needs and what publishing a requisition does not give you.
 */
const greenhouseAts: ConnectorManifest = {
  key: 'greenhouse-ats',
  name: 'Greenhouse (ATS)',
  description: 'Read candidates, applications, interviews and scorecards from Greenhouse — the pipeline, not the job board.',
  category: 'hiring',
  icon: '🌿',
  baseUrl: 'https://harvest.greenhouse.io/v1',
  docsUrl: 'https://developers.greenhouse.io/harvest.html',
  auth: {
    kind: 'basic',
    fields: [
      { key: 'username', label: 'Harvest API key', secret: true, required: true, help: 'Greenhouse → Configure → Dev Center → API Credential Management. Grant it only the read permissions; nothing here writes. Used as the basic-auth username with an empty password.' },
    ],
  },
  actions: [
    {
      key: 'list_candidates', label: 'List candidates', description: 'Read candidates and their current stage.',
      method: 'GET', path: '/candidates', mutates: false,
      params: { updated_after: q('ISO instant — the incremental sync'), job_id: qn('Restrict to one job'), per_page: qn('Page size (max 500)'), page: qn('1-based page') },
    },
    {
      key: 'list_applications', label: 'List applications', description: 'Read applications and their status.',
      method: 'GET', path: '/applications', mutates: false,
      params: { job_id: qn('Restrict to one job'), status: q('active | rejected | hired'), last_activity_after: q('ISO instant'), per_page: qn('Page size') },
    },
    {
      key: 'list_scheduled_interviews', label: 'List interviews', description: 'Read scheduled interviews — who is meeting whom, and when.',
      method: 'GET', path: '/scheduled_interviews', mutates: false,
      params: { starts_after: q('ISO instant'), ends_before: q('ISO instant'), per_page: qn('Page size') },
    },
    {
      key: 'list_scorecards', label: 'List scorecards', description: 'Read interview feedback — the evidence behind a hire/no-hire.',
      method: 'GET', path: '/scorecards', mutates: false,
      params: { created_after: q('ISO instant'), per_page: qn('Page size') },
    },
    {
      key: 'list_offers', label: 'List offers', description: 'Read offers and their status, which is where a funnel actually ends.',
      method: 'GET', path: '/offers', mutates: false,
      params: { status: q('draft | approved | sent | accepted | rejected'), created_after: q('ISO instant'), per_page: qn('Page size') },
    },
  ],
};

/**
 * SAP SuccessFactors — the OData one.
 *
 * The odd shape here is real and not a mistake: SuccessFactors is OData v2, so the
 * paging parameters are `$top`/`$skip` and the response nests under `d.results`.
 * `resultPath` absorbs that so a caller sees a plain array like every other
 * connector, which is the entire reason `resultPath` exists.
 */
const successfactors: ConnectorManifest = {
  key: 'sap-successfactors',
  name: 'SAP SuccessFactors',
  description: 'Read employee records and employment history from SAP SuccessFactors (OData v2).',
  category: 'hiring',
  icon: '🧩',
  baseUrl: 'https://{{auth.apiHost}}/odata/v2',
  docsUrl: 'https://api.sap.com/api/ECEmploymentInformation/overview',
  auth: {
    kind: 'basic',
    fields: [
      {
        key: 'apiHost', label: 'API host', secret: false, required: true,
        placeholder: 'api4.successfactors.com',
        help: 'The datacenter host for your instance, with no scheme. SuccessFactors is region-sharded; the wrong host returns 401 rather than a redirect.',
      },
      {
        key: 'username', label: 'User@company', secret: false, required: true,
        placeholder: 'sfapiuser@acmeP1',
        help: 'The API user, then @, then your company id — SuccessFactors requires the company id in the username itself.',
      },
      { key: 'password', label: 'Password', secret: true, required: true, help: 'The API user\'s password.' },
    ],
  },
  defaultHeaders: { Accept: 'application/json' },
  actions: [
    {
      key: 'list_employees', label: 'List employees', description: 'Read person records.',
      method: 'GET', path: '/PerPerson', mutates: false, resultPath: 'd.results',
      params: {
        $top: qn('Page size'),
        $skip: qn('0-based offset'),
        $filter: q('OData filter, e.g. lastModifiedDateTime gt datetime\'2026-01-01T00:00:00\''),
        $select: q('Comma-separated fields to return'),
      },
    },
    {
      key: 'list_employment', label: 'List employment records', description: 'Read employment history — hire dates, terminations, transfers.',
      method: 'GET', path: '/EmpEmployment', mutates: false, resultPath: 'd.results',
      params: { $top: qn('Page size'), $skip: qn('0-based offset'), $filter: q('OData filter') },
    },
    {
      key: 'list_job_info', label: 'List job info', description: 'Read the job/org assignment behind the org chart.',
      method: 'GET', path: '/EmpJob', mutates: false, resultPath: 'd.results',
      params: { $top: qn('Page size'), $skip: qn('0-based offset'), $filter: q('OData filter') },
    },
  ],
};

/**
 * The generic SCIM 2.0 reader — the one that matters most.
 *
 * SCIM is the standard directory API, and Okta, Entra ID, OneLogin, JumpCloud and
 * a long tail of HRIS products all speak it. So this single manifest reaches every
 * system not enumerated above, which is why this file is not a race to add
 * vendors — the same argument `hiring.ts` makes for its `job-feed` entry.
 *
 * Read-only for the same reason as everything else here: SCIM's write side
 * provisions and DEPROVISIONS accounts, and an agent with a deprovision call is a
 * agent that can lock a company out of its own systems.
 */
const scimDirectory: ConnectorManifest = {
  key: 'scim-directory',
  name: 'SCIM Directory',
  description: 'Read users and groups from any SCIM 2.0 directory — Okta, Entra ID, OneLogin, JumpCloud, or an HRIS that speaks the standard.',
  category: 'hiring',
  icon: '📇',
  baseUrl: '{{auth.baseUrl}}',
  docsUrl: 'https://datatracker.ietf.org/doc/html/rfc7644',
  auth: {
    kind: 'bearer',
    fields: [
      {
        key: 'baseUrl', label: 'SCIM base URL', secret: false, required: true,
        placeholder: 'https://acme.okta.com/api/v1/scim/v2',
        help: 'The root your provider documents, ending just before /Users. Must be https.',
      },
      { key: 'token', label: 'Bearer token', secret: true, required: true, help: 'The SCIM API token your provider issues. Read scopes only — nothing here writes.' },
    ],
  },
  defaultHeaders: { Accept: 'application/scim+json' },
  actions: [
    {
      key: 'list_users', label: 'List users', description: 'Read directory users.',
      method: 'GET', path: '/Users', mutates: false, resultPath: 'Resources',
      params: {
        filter: q('SCIM filter, e.g. active eq true — or userName sw "a"'),
        startIndex: qn('1-based start index (SCIM pages from 1, not 0)'),
        count: qn('Page size'),
        attributes: q('Comma-separated attributes to return'),
      },
    },
    {
      key: 'get_user', label: 'Get one user', description: 'Read one user by SCIM id.',
      method: 'GET', path: '/Users/{user_id}', mutates: false,
      params: { user_id: p('SCIM user id') },
    },
    {
      key: 'list_groups', label: 'List groups', description: 'Read directory groups — the team structure a roster alone does not carry.',
      method: 'GET', path: '/Groups', mutates: false, resultPath: 'Resources',
      params: { filter: q('SCIM filter'), startIndex: qn('1-based start index'), count: qn('Page size') },
    },
  ],
};

export const HRMS_CONNECTORS: readonly ConnectorManifest[] = [
  workday,
  bamboohr,
  hibob,
  personio,
  rippling,
  greenhouseAts,
  successfactors,
  scimDirectory,
];
