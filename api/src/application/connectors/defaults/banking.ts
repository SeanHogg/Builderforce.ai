/**
 * Built-in connectors — BANKING and CAP TABLE.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * The finance seat leads with `finance.burn`, `finance.cash` and
 * `finance.runway_months`, and every one of those is computed from `expenses`
 * and `ledger_entries` — rows a founder TYPED. The flagship live-runway number
 * was live over data somebody entered by hand, and the platform offered no way at
 * all to reach the account the money actually left from.
 *
 * The same was true one layer up: `share_classes`, `equity_grants` and
 * `convertibles` exist as tables, and there was no way to reconcile them against
 * the register a company's lawyers and investors actually look at.
 *
 * ── WHY MANIFESTS AND NOT AN ADAPTER LAYER ───────────────────────────────────
 * Migration 0410 made a connector DATA. `accountingProviders.ts` takes the other
 * approach — a typed `LedgerTransaction` port with a normalised sign convention —
 * and it is the right one for the LEDGER, because the rollup divides by the
 * result and a sign error there produces a burn figure that is confidently
 * backwards. That port needs one sandbox account per vendor to land safely, and
 * it is tracked separately.
 *
 * This file is the honest thing that can ship without them: the raw, credentialled,
 * audited READ. An agent can list the transactions on a Mercury account and a
 * person can see them; nothing here feeds `financeRollup` and nothing here claims
 * a normalised sign. When the ledger port gets its sandbox accounts, these become
 * its transport rather than being replaced.
 *
 * ── READS ONLY, AND THAT IS A DECISION ───────────────────────────────────────
 * Not one action here moves money or edits a cap table. A payment initiation API
 * exists at Mercury and Brex; an agent with a credential and a bad prompt is not
 * something to point at one. `mutates: true` appears nowhere in this file, which
 * is checkable rather than promised.
 */

import type { ConnectorManifest } from '../connectorManifest';
import { p, q, qn } from './dsl';

/** The window every bank feed is asked for. Same three params, three vendors. */
const STATEMENT_QUERY = {
  start: q('ISO date — the beginning of the period'),
  end: q('ISO date — the end of the period'),
  limit: qn('Page size'),
};

const mercury: ConnectorManifest = {
  key: 'mercury',
  name: 'Mercury',
  description: 'Read Mercury accounts, balances and transactions — the money that actually left, beside the burn that was typed.',
  category: 'finance',
  icon: '🏦',
  baseUrl: 'https://api.mercury.com/api/v1',
  docsUrl: 'https://docs.mercury.com/reference',
  auth: {
    kind: 'bearer',
    fields: [{
      key: 'token',
      label: 'API token',
      secret: true,
      required: true,
      help: 'Mercury → Settings → API tokens. A READ-ONLY token is enough for every action here, and is what you should issue.',
    }],
  },
  actions: [
    {
      key: 'list_accounts', label: 'List accounts', description: 'Read every account and its current balance.',
      method: 'GET', path: '/accounts', mutates: false, resultPath: 'accounts', params: {},
    },
    {
      key: 'list_transactions', label: 'List transactions', description: 'Read the transactions on one account for a period — the cash side of burn.',
      method: 'GET', path: '/account/{account_id}/transactions', mutates: false, resultPath: 'transactions',
      params: { account_id: p('Mercury account id'), ...STATEMENT_QUERY },
    },
  ],
};

const brex: ConnectorManifest = {
  key: 'brex',
  name: 'Brex',
  description: 'Read Brex card transactions, accounts and expenses — spend as the card issuer saw it.',
  category: 'finance',
  icon: '💳',
  baseUrl: 'https://platform.brexapis.com',
  docsUrl: 'https://developer.brex.com/openapi/transactions_api/',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'token', label: 'API token', secret: true, required: true, help: 'Brex → Developer → API tokens. Grant the transactions and expenses READ scopes only.' }],
  },
  actions: [
    {
      key: 'list_card_transactions', label: 'List card transactions', description: 'Read settled card spend for a period.',
      method: 'GET', path: '/v2/transactions/card/primary', mutates: false, resultPath: 'items',
      params: { posted_at_start: q('ISO timestamp — earliest posting'), cursor: q('Pagination cursor'), limit: qn('Page size') },
    },
    {
      key: 'list_expenses', label: 'List expenses', description: 'Read expenses with their merchant, category and receipt state — the reconciliation view.',
      method: 'GET', path: '/v1/expenses', mutates: false, resultPath: 'items',
      params: { expand: q('Repeatable: merchant, budget, location, department, user'), cursor: q('Pagination cursor'), limit: qn('Page size') },
    },
    {
      key: 'list_accounts', label: 'List cash accounts', description: 'Read Brex Cash accounts and their balances.',
      method: 'GET', path: '/v2/accounts/cash', mutates: false, resultPath: 'items', params: { cursor: q('Pagination cursor') },
    },
  ],
};

/**
 * Plaid as a LIVE FEED, which is the half `accountingProviders.ts` declares and
 * has no implementation for.
 *
 * Plaid's access token is per ITEM (one connected institution), not per company,
 * so it is a credential field rather than something the manifest can discover —
 * the connect flow that mints one is Plaid Link, in the browser, and belongs to
 * the `providerOAuthConnect` path rather than to a manifest.
 */
const plaid: ConnectorManifest = {
  key: 'plaid',
  name: 'Plaid',
  description: 'Read balances and transactions from a bank connected through Plaid Link.',
  category: 'finance',
  icon: '🔗',
  baseUrl: 'https://production.plaid.com',
  docsUrl: 'https://plaid.com/docs/api/products/transactions/',
  auth: {
    kind: 'none',
    fields: [
      { key: 'client_id', label: 'Client ID', secret: false, required: true, help: 'Plaid dashboard → Team settings → Keys' },
      { key: 'secret', label: 'Secret', secret: true, required: true, help: 'Use the Production secret; Sandbox and Development have their own.' },
      { key: 'access_token', label: 'Item access token', secret: true, required: true, help: 'The access_token for ONE connected institution, exchanged from a Plaid Link public_token.' },
    ],
  },
  actions: [
    {
      key: 'get_balances', label: 'Read balances', description: 'Current and available balance for every account on the connected item.',
      method: 'POST', path: '/accounts/balance/get', mutates: false, resultPath: 'accounts',
      params: {
        client_id: { type: 'string', in: 'body', description: 'Plaid client id', default: '{{auth.client_id}}' },
        secret: { type: 'string', in: 'body', description: 'Plaid secret', default: '{{auth.secret}}' },
        access_token: { type: 'string', in: 'body', description: 'Item access token', default: '{{auth.access_token}}' },
      },
    },
    {
      key: 'list_transactions', label: 'List transactions', description: 'Read transactions for a date range across the connected accounts.',
      method: 'POST', path: '/transactions/get', mutates: false, resultPath: 'transactions',
      required: ['start_date', 'end_date'],
      params: {
        client_id: { type: 'string', in: 'body', description: 'Plaid client id', default: '{{auth.client_id}}' },
        secret: { type: 'string', in: 'body', description: 'Plaid secret', default: '{{auth.secret}}' },
        access_token: { type: 'string', in: 'body', description: 'Item access token', default: '{{auth.access_token}}' },
        start_date: { type: 'string', in: 'body', description: 'ISO date (inclusive)' },
        end_date: { type: 'string', in: 'body', description: 'ISO date (inclusive)' },
      },
    },
  ],
};

// ── Cap table ────────────────────────────────────────────────────────────────
//
// Read-only for a harder reason than the bank feeds: a cap table is a LEGAL
// record maintained by counsel and relied on by investors, and the platform's own
// `share_classes` / `equity_grants` tables are a model of it, not the register
// itself. Writing to Carta from here would make two systems both believe they are
// authoritative about who owns the company, which is the one place that must
// never be ambiguous. Reading is how the model gets reconciled against the truth.

const carta: ConnectorManifest = {
  key: 'carta',
  name: 'Carta',
  description: 'Read the cap table Carta holds — share classes, issuances and stakeholders — to reconcile against the equity model here.',
  category: 'finance',
  icon: '📜',
  baseUrl: 'https://api.carta.com/v1alpha1',
  docsUrl: 'https://developer.carta.com/',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'token', label: 'Access token', secret: true, required: true, help: 'Carta → Integrations → API. Issue a read-only token.' }],
  },
  actions: [
    {
      key: 'list_issuers', label: 'List issuers', description: 'The legal entities these credentials can read.',
      method: 'GET', path: '/issuers', mutates: false, resultPath: 'issuers', params: { limit: qn('Page size') },
    },
    {
      key: 'list_share_classes', label: 'List share classes', description: 'Authorised and outstanding shares per class.',
      method: 'GET', path: '/issuers/{issuer_id}/shareClasses', mutates: false, resultPath: 'shareClasses',
      params: { issuer_id: p('Carta issuer id'), limit: qn('Page size') },
    },
    {
      key: 'list_stakeholders', label: 'List stakeholders', description: 'Who holds what — the register the model here is reconciled against.',
      method: 'GET', path: '/issuers/{issuer_id}/stakeholders', mutates: false, resultPath: 'stakeholders',
      params: { issuer_id: p('Carta issuer id'), limit: qn('Page size') },
    },
    {
      key: 'list_securities', label: 'List securities', description: 'Issued securities — equity, options and convertibles — with their terms.',
      method: 'GET', path: '/issuers/{issuer_id}/securities', mutates: false, resultPath: 'securities',
      params: { issuer_id: p('Carta issuer id'), limit: qn('Page size') },
    },
  ],
};

const pulley: ConnectorManifest = {
  key: 'pulley',
  name: 'Pulley',
  description: 'Read the Pulley cap table — securities, stakeholders and the fully-diluted view.',
  category: 'finance',
  icon: '🧮',
  baseUrl: 'https://api.pulley.com/v1',
  docsUrl: 'https://pulley.readme.io/',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'token', label: 'API key', secret: true, required: true, help: 'Pulley → Settings → API. Read scope is enough.' }],
  },
  actions: [
    {
      key: 'list_companies', label: 'List companies', description: 'The companies these credentials can read.',
      method: 'GET', path: '/companies', mutates: false, params: { limit: qn('Page size') },
    },
    {
      key: 'list_securities', label: 'List securities', description: 'Issued securities with class, quantity and holder.',
      method: 'GET', path: '/companies/{company_id}/securities', mutates: false,
      params: { company_id: p('Pulley company id'), limit: qn('Page size') },
    },
    {
      key: 'list_stakeholders', label: 'List stakeholders', description: 'Holders of record and their holdings.',
      method: 'GET', path: '/companies/{company_id}/stakeholders', mutates: false,
      params: { company_id: p('Pulley company id'), limit: qn('Page size') },
    },
  ],
};

export const BANKING_CONNECTORS: readonly ConnectorManifest[] = [
  mercury,
  brex,
  plaid,
  carta,
  pulley,
];
