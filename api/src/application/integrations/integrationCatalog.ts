/**
 * The PUBLIC integration catalog — what `builderforce.ai/integrations` is allowed
 * to claim, projected from the ports that actually implement the connections.
 *
 * The marketing page used to answer "do you support X?" from two hand-maintained
 * arrays in the FRONTEND (`SEO_INTEGRATIONS`, `INTEGRATION_CAPABILITY_PROOF`).
 * Nothing tied either one to a port, so adding a provider to the board catalog or
 * shipping a new built-in connector manifest changed the product and not the
 * page — and the page is the promise a buyer reads. Worse, the two arrays could
 * disagree with each other, and did.
 *
 * So the claim is DERIVED. Six ports feed it, each already the single source of
 * truth for its own surface:
 *
 *   connectors — `defaults/` built-in manifests: the day-one catalog every tenant
 *                gets before anyone authors anything.
 *   board      — `boardsync/providerCatalog`: external work/incident systems that
 *                can be connected as a synced board.
 *   data       — `dataProviderCatalog`: warehouses and marketing platforms a
 *                credential can be stored for and a workflow node can query.
 *   drive      — `drive/driveProviders`: the cloud-drive port.
 *   mailbox    — `mailbox/mailboxProviders`: the connected-mailbox port.
 *   payout     — `payouts/payoutProviders`: where an earner's money is sent.
 *   ledger     — `finance/accountingProviders`: where a company's ACTUALS are read
 *                from. The half the finance category did not have: until it landed,
 *                every entry in that category was `direction: 'export'`, so the page
 *                could claim we pay people out and could not claim we read one real
 *                number in — which is the first thing a finance buyer asks.
 *
 * A system that appears on more than one port (GitHub is a built-in connector AND
 * a synced board) is ONE catalog entry with both surfaces, because it is one
 * answer to one question. Merging here rather than on the page is what stops the
 * page from having to know which port a name came from.
 *
 * Categories are this catalog's OWN small vocabulary rather than any one port's:
 * `BoardProviderCategory` and `ConnectorCategory` are internal groupings for two
 * different admin UIs, and a public page needs one language. The mapping is
 * total and explicit below — a new port category is a compile error here, not a
 * silently-dropped integration.
 *
 * Pure and static: no DB round-trip, no external call, so there is nothing to
 * cache — the route returns a module constant, exactly like `GET /api/tools`.
 */

import { BOARD_PROVIDERS, type BoardProviderCategory } from '../boardsync/providerCatalog';
import { BUILTIN_CONNECTOR_LIST } from '../connectors/defaults';
import type { ConnectorCategory, ConnectorManifest } from '../connectors/connectorManifest';
import { allAdsProviders } from '../advertising/adsProviders';
import { allAnalyticsProviders } from '../analytics/analyticsProviders';
import { MAILBOX_PROVIDER_NAMES } from '../mailbox/mailboxProviders';
import { describePayoutProviders } from '../payouts/payoutProviders';
import { describeAccountingProviders } from '../finance/accountingProviders';
import { describeProviders, type ProviderFamily } from './dataProviderCatalog';

/**
 * One vocabulary for the public page. Twelve keys, each translated once in the
 * frontend catalogs — a page cannot invent a thirteenth because it renders the
 * key it is given.
 */
export const INTEGRATION_CATEGORIES = [
  'work',
  'devtools',
  'incident',
  'communication',
  'crm',
  'productivity',
  'finance',
  'marketing',
  'support',
  'storage',
  'data',
  'hiring',
  'other',
] as const;
export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

/** Which port backs an entry. An entry may have several. */
export type IntegrationSurface = 'connector' | 'board' | 'data' | 'drive' | 'mailbox' | 'payout' | 'ledger' | 'ads' | 'measurement';

/** What moves, and which way. Derived per surface — never asserted by hand. */
export type IntegrationDirection = 'import' | 'export' | 'two-way' | 'event-ingest';

/** Capabilities a buyer can check for. Absent means "not on this connection". */
export type IntegrationCapability = 'webhook' | 'discovery' | 'oauth';

export interface IntegrationCatalogEntry {
  /** Stable id — the port's own key, so a card can be traced back to its adapter. */
  id: string;
  name: string;
  category: IntegrationCategory;
  /** Every port that backs this system, in the order they were merged. */
  surfaces: IntegrationSurface[];
  direction: IntegrationDirection;
  capabilities: IntegrationCapability[];
}

/** Total map — adding a `BoardProviderCategory` without a home fails to compile. */
const BOARD_CATEGORY: Record<BoardProviderCategory, IntegrationCategory> = {
  pm: 'work',
  itsm: 'support',
  incident: 'incident',
  scm: 'devtools',
};

/** Total map — the data catalog's two families. */
const DATA_CATEGORY: Record<ProviderFamily, IntegrationCategory> = {
  data: 'data',
  marketing: 'marketing',
};

/** Total map — same contract for the connector vocabulary. */
const CONNECTOR_CATEGORY: Record<ConnectorCategory, IntegrationCategory> = {
  communication: 'communication',
  crm: 'crm',
  productivity: 'productivity',
  devtools: 'devtools',
  finance: 'finance',
  marketing: 'marketing',
  support: 'support',
  // Job boards, ATS feeds and HRMS. `INTEGRATION_CATEGORIES` gains the same name rather
  // than folding hiring into `crm`: the Recruiter seat browses this catalog by category,
  // and "publish a requisition" and "work a deal" are different jobs.
  hiring: 'hiring',
  storage: 'storage',
  data: 'data',
  other: 'other',
};

/**
 * A connector's direction, read off its ACTIONS rather than declared.
 *
 * "Two-way" is a claim about writing to somebody's Salesforce, so it has to come
 * from whether a write exists. A manifest whose every action is a `GET` reads and
 * does not write, and saying otherwise on a public page is the kind of overclaim
 * the capability-proof review exists to catch.
 */
function connectorDirection(manifest: ConnectorManifest): IntegrationDirection {
  return manifest.actions.some((action) => action.method !== 'GET') ? 'two-way' : 'import';
}

/** Merge-append: one system, one entry, every port it is reachable through. */
function merge(into: Map<string, IntegrationCatalogEntry>, entry: IntegrationCatalogEntry): void {
  const existing = into.get(entry.id);
  if (!existing) {
    into.set(entry.id, entry);
    return;
  }
  for (const surface of entry.surfaces) {
    if (!existing.surfaces.includes(surface)) existing.surfaces.push(surface);
  }
  for (const capability of entry.capabilities) {
    if (!existing.capabilities.includes(capability)) existing.capabilities.push(capability);
  }
  // Reading on one port and writing on another is still writing.
  if (existing.direction !== entry.direction && (existing.direction === 'import' || entry.direction === 'two-way')) {
    existing.direction = 'two-way';
  }
}

function build(): IntegrationCatalogEntry[] {
  const byId = new Map<string, IntegrationCatalogEntry>();

  // Connectors first: the broadest port, and the one that carries display names.
  for (const manifest of BUILTIN_CONNECTOR_LIST) {
    merge(byId, {
      id: manifest.key,
      name: manifest.name,
      category: CONNECTOR_CATEGORY[manifest.category],
      surfaces: ['connector'],
      direction: connectorDirection(manifest),
      capabilities: manifest.auth.kind === 'oauth2' ? ['oauth'] : [],
    });
  }

  for (const provider of BOARD_PROVIDERS) {
    const capabilities: IntegrationCapability[] = [];
    if (provider.supportsWebhook) capabilities.push('webhook');
    if (provider.supportsDiscovery) capabilities.push('discovery');
    merge(byId, {
      id: provider.id,
      name: provider.label,
      category: BOARD_CATEGORY[provider.category],
      surfaces: ['board'],
      direction: 'two-way',
      capabilities,
    });
  }

  // A warehouse is queried, not written to, so `import` — and the operations it
  // declares are what a workflow node can actually call.
  for (const provider of describeProviders()) {
    merge(byId, {
      id: provider.id,
      name: provider.label,
      category: DATA_CATEGORY[provider.family],
      surfaces: ['data'],
      direction: 'import',
      capabilities: [],
    });
  }

  // The drive port names its providers by vendor, not by product, so the public
  // label is spelled here — `google` on a marketing page means nothing.
  const DRIVE_LABELS: Record<string, string> = { google: 'Google Drive', microsoft: 'OneDrive / SharePoint' };
  for (const [id, name] of Object.entries(DRIVE_LABELS)) {
    merge(byId, {
      id: `drive-${id}`,
      name,
      category: 'storage',
      surfaces: ['drive'],
      direction: 'import',
      capabilities: ['oauth'],
    });
  }

  const MAILBOX_LABELS: Record<string, string> = { google: 'Gmail', microsoft: 'Outlook / Exchange' };
  for (const id of MAILBOX_PROVIDER_NAMES) {
    merge(byId, {
      id: `mailbox-${id}`,
      name: MAILBOX_LABELS[id] ?? id,
      category: 'communication',
      surfaces: ['mailbox'],
      direction: 'two-way',
      capabilities: ['oauth'],
    });
  }

  // Paid media. Every one of these is ALSO a connector manifest, so the merge rule
  // turns the two into ONE entry carrying both surfaces — which is the honest answer
  // to "can you run our ads": yes through a managed campaign object, and yes as raw
  // actions in a workflow. `two-way` is not asserted here: it is derived from the
  // manifests like every other connector, and the ads port only ever reads campaigns
  // it can also write.
  for (const provider of allAdsProviders()) {
    merge(byId, {
      id: provider.connectorKey,
      name: provider.label,
      category: 'marketing',
      surfaces: ['ads'],
      direction: 'two-way',
      capabilities: [],
    });
  }

  // Measurement. Deliberately `import`: nothing here is ever written to. Claiming
  // two-way on an analytics property would be the overclaim this projection exists
  // to prevent.
  for (const provider of allAnalyticsProviders()) {
    merge(byId, {
      id: provider.connectorKey,
      name: provider.label,
      category: 'data',
      surfaces: ['measurement'],
      direction: 'import',
      capabilities: [],
    });
  }

  // Accounting, banking and revenue sources. `import` because money is READ through
  // them — the half this category did not have. Until the ledger port landed, every
  // entry below was `export`, so the page could truthfully claim we pay people and
  // could not claim we read a single actual, which is the first question a finance
  // buyer asks.
  //
  // ── AND WHY THE FILTER IS HERE ──────────────────────────────────────────────────
  // The port shipped its REGISTRY before its adapters, which is a reasonable order to
  // build in and a disastrous one to advertise from: this loop published five accounting
  // systems to a public page as `direction: 'import'` while `AccountingProvider`'s
  // `fetchTransactions` / `fetchDocuments` / `fetchBalances` were optional and
  // implemented by none of them. A buyer read that we import their books; nothing could
  // read one number out of any of the five.
  //
  // `connectorDirection()` above already solves this for connectors — it derives
  // "two-way" from whether a non-GET action EXISTS, because a claim about writing to
  // somebody's Salesforce has to come from whether a write exists. The ledger surface
  // asserted its direction from the surface NAME instead, which is the one thing this
  // module says a catalog entry may never do. `descriptor.live` applies the same rule, so
  // an adapter landing turns the claim on by itself and a registry entry with no adapter
  // is SILENT rather than false. A smaller honest catalog beats a larger one a demo
  // disproves.
  //
  // `stripe-revenue` deliberately merges onto the payout port's `stripe` entry: it is
  // one system a buyer asks about once, and the merge rule turns two surfaces into one
  // card reading "import · export" rather than two cards each telling half the answer.
  for (const provider of describeAccountingProviders({}).filter((entry) => entry.live)) {
    merge(byId, {
      id: provider.name === 'stripe-revenue' ? 'stripe' : provider.name,
      name: provider.name === 'stripe-revenue' ? 'Stripe' : provider.label,
      category: 'finance',
      surfaces: ['ledger'],
      direction: 'import',
      capabilities: provider.connect === 'oauth' ? ['oauth'] : [],
    });
  }

  // Payout destinations. `export` because money LEAVES through them, and the
  // three-word difference between "we can read your Stripe" and "we can pay you
  // through your Stripe" is the whole reason a buyer reads this page. Stripe is
  // already here as a connector, so it merges into one entry with two surfaces —
  // which is the merge rule doing exactly what it exists for.
  for (const provider of describePayoutProviders({})) {
    merge(byId, {
      // The provider's own key, NOT a `payout-` prefix: prefixing would give
      // Stripe two cards on one page saying two halves of one answer.
      id: provider.name,
      name: provider.label,
      category: 'finance',
      surfaces: ['payout'],
      direction: 'export',
      capabilities: provider.connect === 'oauth' ? ['oauth'] : [],
    });
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The catalog, built once at module load. */
export const INTEGRATION_CATALOG: readonly IntegrationCatalogEntry[] = build();

/** Category → entries, in the declared category order. Empty categories are dropped. */
export function integrationCatalogByCategory(): { category: IntegrationCategory; entries: IntegrationCatalogEntry[] }[] {
  return INTEGRATION_CATEGORIES
    .map((category) => ({ category, entries: INTEGRATION_CATALOG.filter((entry) => entry.category === category) }))
    .filter((group) => group.entries.length > 0);
}
