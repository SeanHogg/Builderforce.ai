/**
 * Built-in connectors — PAYROLL and TAX.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `payroll` appeared in this codebase only as a word in a lexicon and a provider
 * blurb; sales tax and VAT appeared nowhere at all. `compensation_structures`
 * and `timesheets` exist — the platform knows what a role costs and how many
 * hours were worked — and turning either into a PAY RUN did not. So a founder
 * could plan headcount, model its loaded cost, forecast the burn it produces and
 * then had to leave the product entirely to pay anybody, and had no way at all to
 * work out what tax was owed on what they sold.
 *
 * Those are the two largest recurring obligations a company has, and they were
 * the two the product could not reach even through an integration.
 *
 * ── WHY MANIFESTS AND NOT A PAYROLL ENGINE ───────────────────────────────────
 * Because running payroll is not a thing this product should ever do. Calculating
 * withholding across jurisdictions, filing returns and remitting to a revenue
 * authority is a regulated, per-country, continuously-changing obligation with
 * real liability attached, and every company that needs it already pays somebody
 * to do it. What the platform owes them is not a second payroll engine — it is
 * the ability to READ the run that happened, so the burn on the forecast is the
 * money that actually left, and to PUSH the hours it already holds so nobody
 * retypes a timesheet.
 *
 * The same argument holds for tax, one step harder: a rate table that is wrong is
 * worse than no rate table, because a wrong one is used.
 *
 * ── WHY THESE ARE DATA ───────────────────────────────────────────────────────
 * Migration 0410 made a connector DATA. Adding Payfit, Remote.com or a
 * country-specific bureau is an entry in this file — reviewed like data, validated
 * by the same `parseConnectorManifest` gate tenant-authored connectors pass, and
 * shipped with no new code path. Every call is credentialled per tenant and
 * audited, because it goes through `connectorTools.ts` like every other connector
 * call.
 *
 * ── THE READS ARE THE IMPORTANT HALF ─────────────────────────────────────────
 * Every manifest here leads with `list_pay_runs` / `list_payments` rather than
 * with a write. A founder's first question is "what did we actually pay last
 * month", the burn on their forecast is currently a number they typed, and the
 * answer is one authenticated GET away. The writes matter less and cost more to
 * get wrong: a mistaken push into a payroll provider is somebody's salary.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { b, bn, q, qn } from './dsl';

/**
 * The shared pay-run read, declared once.
 *
 * Every provider here answers the same three questions about a run — which
 * period, what it cost, and has it been paid — and they disagree only on field
 * names, which is what the manifest's `path`/`params` mapping is for. Writing
 * them out per vendor is how four providers come to expose slightly different
 * ideas of what a pay run is.
 */
const PAY_RUN_QUERY = {
  start_date: q('ISO date — only runs whose pay period starts on or after this'),
  end_date: q('ISO date — only runs whose pay period ends on or before this'),
  limit: qn('Page size. Keep it bounded; a full payroll history is not a page.'),
} as const;

const gusto: ConnectorManifest = {
  key: 'gusto',
  name: 'Gusto',
  description: 'Read pay runs, employee compensation and payroll cost from Gusto — so the burn on a forecast is money that actually left.',
  category: 'finance',
  icon: '💸',
  /**
   * The company id lives in the BASE URL rather than in each path.
   *
   * `{{auth.…}}` placeholders are resolved in `baseUrl` only — a path placeholder
   * has to be a real per-call parameter, and the validator says so. Every Gusto
   * action here is company-scoped, so binding it once is both correct and the
   * reason a caller never has to pass an id it could get wrong.
   */
  baseUrl: 'https://api.gusto.com/v1/companies/{{auth.company_id}}',
  docsUrl: 'https://docs.gusto.com/app-integrations/reference',
  auth: {
    kind: 'oauth2',
    fields: [
      { key: 'client_id', label: 'Client ID', secret: false, required: true, help: 'Gusto → Developer portal → your application' },
      { key: 'client_secret', label: 'Client secret', secret: true, required: true },
      { key: 'company_id', label: 'Company ID', secret: false, required: true, help: 'The Gusto company UUID these credentials act for.' },
    ],
  },
  actions: [
    {
      key: 'list_pay_runs', label: 'List pay runs', description: 'Read processed payrolls and what each cost.',
      method: 'GET', path: '/payrolls', mutates: false,
      params: PAY_RUN_QUERY,
    },
    {
      key: 'get_pay_run', label: 'Read one pay run', description: 'Read a single payroll with its per-employee lines.',
      method: 'GET', path: '/payrolls/{payroll_id}', mutates: false,
      params: { payroll_id: { type: 'string', in: 'path', description: 'Gusto payroll id' } },
    },
    {
      key: 'list_employees', label: 'List employees', description: 'Read the payroll roster and each person\'s compensation.',
      method: 'GET', path: '/employees', mutates: false,
      params: { terminated: { type: 'boolean', in: 'query', description: 'Include terminated employees' }, page: qn('Page number') },
    },
    {
      // The one write, and the safe one: hours are a fact the platform already
      // holds in `timesheets`, and pushing them replaces retyping rather than
      // authorising a payment.
      key: 'push_hours', label: 'Push timesheet hours', description: 'Write worked hours onto an open payroll from the timesheets this workspace already holds.',
      method: 'PUT', path: '/payrolls/{payroll_id}', mutates: true, required: ['payroll_id', 'employee_compensations'],
      params: {
        payroll_id: { type: 'string', in: 'path', description: 'The OPEN payroll to write into. Never a processed one.' },
        employee_compensations: { type: 'array', in: 'body', description: 'One entry per employee: {employee_id, hourly_compensations: [{name, hours}]}' },
      },
    },
  ],
};

const rippling: ConnectorManifest = {
  key: 'rippling',
  name: 'Rippling',
  description: 'Read payroll runs, employment records and cost from Rippling.',
  category: 'finance',
  icon: '🌊',
  baseUrl: 'https://api.rippling.com/platform/api',
  docsUrl: 'https://developer.rippling.com',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'api_key', label: 'API key', secret: true, required: true, help: 'Rippling → Company settings → API access. Sent as a bearer token.' }],
  },
  actions: [
    { key: 'list_pay_runs', label: 'List pay runs', description: 'Read payroll runs and their totals.', method: 'GET', path: '/payroll_runs', mutates: false, params: PAY_RUN_QUERY },
    { key: 'list_employees', label: 'List employees', description: 'Read the employment roster.', method: 'GET', path: '/employees', mutates: false, params: { limit: qn('Page size'), offset: qn('Offset') } },
    { key: 'list_compensation', label: 'List compensation', description: 'Read per-employee compensation, for pay-equity and loaded-cost checks.', method: 'GET', path: '/employees/include_terminated', mutates: false, params: { limit: qn('Page size') } },
    // The two HRIS reads, on THIS card rather than a second `rippling` in
    // `defaults/hrms.ts`. Rippling is one API and one credential: a separate HRMS
    // card would mean a second connection and two answers to "who works here".
    // The category stays `finance` because that is where a company goes looking
    // for Rippling; a connector is connected once, not once per question.
    { key: 'list_departments', label: 'List departments', description: 'Read the department list an org chart groups by.', method: 'GET', path: '/departments', mutates: false, params: { limit: qn('Page size') } },
    { key: 'list_leave_requests', label: 'List leave requests', description: 'Read time-off requests and their approval state, so capacity accounts for who is away.', method: 'GET', path: '/leave_requests', mutates: false, params: { from: q('ISO date'), to: q('ISO date'), status: q('APPROVED | PENDING | DECLINED') } },
  ],
};

const deel: ConnectorManifest = {
  key: 'deel',
  name: 'Deel',
  description: 'Read contractor and EOR payments from Deel — the half of the payroll picture a distributed team actually has.',
  category: 'finance',
  icon: '🌍',
  baseUrl: 'https://api.letsdeel.com/rest/v2',
  docsUrl: 'https://developer.deel.com',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'api_key', label: 'API token', secret: true, required: true, help: 'Deel → Developer → API tokens.' }],
  },
  actions: [
    { key: 'list_contracts', label: 'List contracts', description: 'Read active contractor and EOR contracts with their rates.', method: 'GET', path: '/contracts', mutates: false, params: { statuses: q('Comma-separated contract statuses'), limit: qn('Page size') } },
    { key: 'list_payments', label: 'List payments', description: 'Read what has actually been paid, per contract.', method: 'GET', path: '/payments', mutates: false, params: PAY_RUN_QUERY },
    { key: 'list_invoices', label: 'List Deel invoices', description: 'Read the invoices Deel raised for the workspace — the payable side of a distributed payroll.', method: 'GET', path: '/invoice-adjustments', mutates: false, params: { limit: qn('Page size') } },
  ],
};

const adp: ConnectorManifest = {
  key: 'adp-workforce',
  name: 'ADP Workforce Now',
  description: 'Read payroll output and worker records from ADP.',
  category: 'finance',
  icon: '🏛️',
  baseUrl: 'https://api.adp.com',
  docsUrl: 'https://developers.adp.com',
  auth: {
    kind: 'oauth2',
    fields: [
      { key: 'client_id', label: 'Client ID', secret: false, required: true, help: 'ADP → Developer portal → your application' },
      { key: 'client_secret', label: 'Client secret', secret: true, required: true },
    ],
  },
  actions: [
    { key: 'list_pay_runs', label: 'List pay runs', description: 'Read processed pay statements.', method: 'GET', path: '/payroll/v1/payroll-output', mutates: false, params: PAY_RUN_QUERY },
    { key: 'list_workers', label: 'List workers', description: 'Read the worker roster.', method: 'GET', path: '/hr/v2/workers', mutates: false, params: { $top: qn('Page size'), $skip: qn('Offset') } },
  ],
};

/**
 * A payroll BUREAU that is not a named vendor.
 *
 * The same argument `job-feed` makes in the hiring file, and it matters more
 * here: payroll is the most country-specific thing a company does, most of the
 * world's employers use a local bureau with no partner API, and no catalog will
 * ever finish enumerating them. A tenant whose accountant can export a CSV to a
 * URL gets the same reads everyone else does, and this is the connector that
 * works for every provider this file does not name.
 */
const payrollFile: ConnectorManifest = {
  key: 'payroll-file',
  name: 'Payroll file (CSV/JSON)',
  description: 'Read pay runs from your own bureau\'s export endpoint — the path that works for every provider without a partner API.',
  category: 'finance',
  icon: '📄',
  baseUrl: '{{auth.export_base_url}}',
  auth: {
    kind: 'api_key',
    // A bearer-style header rather than a query parameter: a payroll export is
    // salary data, and a credential in a query string is a credential in every
    // access log between here and the bureau.
    in: 'header',
    name: 'Authorization',
    fields: [
      { key: 'export_base_url', label: 'Export base URL', secret: false, required: true, placeholder: 'https://payroll.example.com/api', help: 'Where your bureau publishes its export. Ask them for a read-only endpoint.' },
      { key: 'api_key', label: 'API key', secret: true, required: true },
    ],
  },
  actions: [
    { key: 'list_pay_runs', label: 'List pay runs', description: 'Read every pay run in the export.', method: 'GET', path: '/pay-runs', mutates: false, resultPath: 'runs', params: PAY_RUN_QUERY },
    { key: 'get_pay_run', label: 'Read one pay run', description: 'Read one run with its per-employee lines.', method: 'GET', path: '/pay-runs/{run_id}', mutates: false, params: { run_id: { type: 'string', in: 'path', description: 'Your bureau\'s run id' } } },
  ],
};

/**
 * Tax. Two vendors and no rate table of our own.
 *
 * There is deliberately no built-in rate logic anywhere on this platform, and
 * there should not be: sales tax and VAT are jurisdiction-by-jurisdiction,
 * change without notice, and depend on what was sold, where the buyer is and
 * what they are registered for. A rate table that is out of date is worse than
 * none, because a wrong one gets used and the error compounds monthly until a
 * revenue authority finds it. These connectors ask a system whose entire job is
 * being right about that today.
 */
const stripeTax: ConnectorManifest = {
  key: 'stripe-tax',
  name: 'Stripe Tax',
  description: 'Calculate sales tax and VAT on a transaction, and read what has been collected. No rate table of our own — see the note in the manifest.',
  category: 'finance',
  icon: '🧾',
  baseUrl: 'https://api.stripe.com/v1',
  docsUrl: 'https://docs.stripe.com/tax',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'api_key', label: 'Secret key', secret: true, required: true, help: 'Stripe → Developers → API keys. A restricted key with Tax read/write is enough.' }],
  },
  actions: [
    {
      key: 'calculate_tax', label: 'Calculate tax', description: 'Work out the tax due on a sale, from the buyer\'s address and what was sold.',
      method: 'POST', path: '/tax/calculations', mutates: false, required: ['currency', 'line_items', 'customer_details'],
      params: {
        currency: b('ISO-4217 code for the sale'),
        line_items: { type: 'array', in: 'body', description: 'One entry per billed line: {amount, reference, tax_code}' },
        customer_details: { type: 'object', in: 'body', description: "The buyer's address and tax ids — what the rate actually depends on" },
      },
    },
    {
      key: 'list_registrations', label: 'List tax registrations', description: 'Read where this business is registered to collect — the list that decides whether tax is due at all.',
      method: 'GET', path: '/tax/registrations', mutates: false, params: { status: q('active | expired | scheduled'), limit: qn('Page size') },
    },
    {
      key: 'create_transaction', label: 'Record a taxable transaction', description: 'Commit a calculation as a real transaction, so it appears in the filing report.',
      method: 'POST', path: '/tax/transactions/create_from_calculation', mutates: true, required: ['calculation', 'reference'],
      params: { calculation: b('The calculation id to commit'), reference: b('Your own invoice reference, so a filing line can be traced back to the invoice') },
    },
  ],
};

const avalara: ConnectorManifest = {
  key: 'avalara-avatax',
  name: 'Avalara AvaTax',
  description: 'Calculate and commit sales tax through AvaTax, and read filing-ready totals.',
  category: 'finance',
  icon: '📐',
  baseUrl: 'https://rest.avatax.com/api/v2',
  docsUrl: 'https://developer.avalara.com/api-reference/avatax/rest/v2/',
  auth: {
    kind: 'basic',
    fields: [
      { key: 'username', label: 'Account ID', secret: false, required: true, help: 'Avalara → Settings → License and API keys. Used as the basic-auth username.' },
      { key: 'password', label: 'Licence key', secret: true, required: true },
    ],
  },
  actions: [
    {
      key: 'calculate_tax', label: 'Calculate tax', description: 'Create a SalesOrder transaction — a calculation that is not committed.',
      method: 'POST', path: '/transactions/create', mutates: false, required: ['type', 'companyCode', 'date', 'customerCode', 'lines'],
      params: {
        type: b('Use "SalesOrder" to calculate without committing, "SalesInvoice" to commit'),
        companyCode: b('Your Avalara company code'),
        date: b('ISO date of the transaction'),
        customerCode: b('Your own customer reference'),
        lines: { type: 'array', in: 'body', description: 'One entry per billed line: {number, amount, taxCode, addresses}' },
      },
    },
    {
      key: 'list_transactions', label: 'List transactions', description: 'Read committed transactions for a period — the filing view.',
      method: 'GET', path: '/companies/{company_code}/transactions', mutates: false,
      params: { company_code: { type: 'string', in: 'path', description: 'Your Avalara company code' }, $filter: q('OData filter, e.g. date ge 2026-01-01'), $top: qn('Page size') },
    },
  ],
};

export const PAYROLL_CONNECTORS: readonly ConnectorManifest[] = [
  payrollFile,
  gusto,
  rippling,
  deel,
  adp,
  stripeTax,
  avalara,
];
