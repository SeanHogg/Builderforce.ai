/**
 * The CONNECT catalog — every provider a credential can be stored for, and how
 * its connect form looks. ONE list, served at `GET /api/integrations/connectable`.
 *
 * It used to be half a list. `describeProviders()` described the Data +
 * Marketing + Enrichment catalog, while the 20 hand-probed providers (GitHub,
 * Jira, Tavily, Gmail…) had their fields known only to their probes — so the
 * frontend re-declared all of them in a `PROVIDER_META` table of its own. The
 * integrations gallery then built its cards from that table, which is how
 * Postgres, Neon, Supabase, HubSpot, Mailchimp and ~19 more ended up with no
 * card at all (and a crash on `PROVIDER_META[provider]` had they had one).
 *
 * Now both halves are described here:
 *   • the LEGACY providers declare their form as data below — label, base-URL
 *     requirement and fields drawn from the shared vocabulary in
 *     `credentialFields.ts`;
 *   • the catalog providers are folded in from `describeProviders()`.
 *
 * `LEGACY_TESTS` (providerTests.ts) is typed by {@link LegacyProviderId}, so a
 * provider with a probe and no form — or a form and no probe — does not compile.
 *
 * ── CATEGORY ─────────────────────────────────────────────────────────────────
 * The gallery groups by {@link ConnectableCategory}. A synced-board provider's
 * category IS the board catalog's (never re-declared here); a catalog provider's
 * is its family; only the three non-board legacy groups (knowledge, search,
 * productivity) are stated by hand. The tuple's order is the gallery's section
 * order, so the page cannot re-derive it and disagree.
 *
 * Static and tenant-free: built once at module load, which is the whole cache.
 */

import { getBoardProviderMeta, type BoardProviderCategory } from '../boardsync/providerCatalog';
import {
  describeProviders,
  type OperationSpec,
  type ProviderFamily,
  type ProviderTransport,
} from './dataProviderCatalog';
import { credentialField, type CredentialField } from './credentialFields';

/** Every gallery section, in display order. Each is translated in the frontend
 *  catalogs under `integrations.gallery.category.<id>`. */
export const CONNECTABLE_CATEGORIES = [
  'pm',
  'scm',
  'itsm',
  'incident',
  'knowledge',
  'search',
  'productivity',
  'data',
  'marketing',
  'enrichment',
] as const;

export type ConnectableCategory = (typeof CONNECTABLE_CATEGORIES)[number];

/** The categories a board or a catalog family cannot supply. */
type StatedCategory = Exclude<ConnectableCategory, BoardProviderCategory | ProviderFamily>;

/** Whether the credential needs a base URL (self-hosted / tenant-scoped hosts). */
export type BaseUrlRequirement = 'required' | 'optional' | 'none';

interface LegacyForm {
  /** Brand name — substituted into localized sentences, so no parentheticals. */
  label: string;
  baseUrl: BaseUrlRequirement;
  fields: CredentialField[];
  /** Only for a provider that is NOT a synced board; a board's category is the board catalog's. */
  category?: StatedCategory;
}

const apiKey = (placeholder?: string) => credentialField('apiKey', { placeholder });
const text = { secret: false } as const;
/** Google OAuth offline credentials — client id/secret + a refresh token. */
const GOOGLE_OAUTH_FIELDS: CredentialField[] = [
  credentialField('clientId', { ...text, placeholder: '…apps.googleusercontent.com' }),
  credentialField('clientSecret'),
  credentialField('refreshToken'),
];

/**
 * The hand-probed providers' connect forms. The keys are exactly the keys each
 * probe reads (`creds.accessToken`, `creds.apiToken` + `creds.email`, …).
 */
export const LEGACY_PROVIDER_FORMS = {
  github: { label: 'GitHub', baseUrl: 'none', fields: [credentialField('accessToken', { placeholder: 'ghp_…' })] },
  gitlab: { label: 'GitLab', baseUrl: 'optional', fields: [credentialField('accessToken', { placeholder: 'glpat-…' })] },
  bitbucket: { label: 'Bitbucket', baseUrl: 'none', fields: [credentialField('accessToken')] },
  jira: { label: 'Jira', baseUrl: 'required', fields: [credentialField('email', text), credentialField('apiToken')] },
  confluence: {
    label: 'Confluence', baseUrl: 'required', category: 'knowledge',
    fields: [credentialField('email', text), credentialField('apiToken')],
  },
  freshservice: { label: 'Freshservice', baseUrl: 'required', fields: [apiKey()] },
  freshdesk: { label: 'Freshdesk', baseUrl: 'required', fields: [apiKey()] },
  servicenow: { label: 'ServiceNow', baseUrl: 'required', fields: [credentialField('username', text), credentialField('password')] },
  linear: { label: 'Linear', baseUrl: 'none', fields: [apiKey('lin_api_…')] },
  sentry: { label: 'Sentry', baseUrl: 'optional', fields: [credentialField('token', { placeholder: 'sntrys_…' })] },
  pagerduty: {
    label: 'PagerDuty', baseUrl: 'none',
    // `fromEmail` is only needed for write-back, so a read-only sync connects without it.
    fields: [credentialField('apiToken'), credentialField('fromEmail', { ...text, required: false, placeholder: 'you@company.com' })],
  },
  monday: { label: 'monday.com', baseUrl: 'none', fields: [credentialField('token')] },
  asana: { label: 'Asana', baseUrl: 'none', fields: [credentialField('accessToken')] },
  clickup: { label: 'ClickUp', baseUrl: 'none', fields: [credentialField('token', { placeholder: 'pk_…' })] },
  // BYO web-search keys WIDEN research from the keyless encyclopedic index to a
  // full web index. Search bills per query, so the key is yours. `ollama` is the
  // backup tried right after `tavily` (webSearchVendors.ts).
  tavily: { label: 'Tavily', baseUrl: 'none', category: 'search', fields: [apiKey('tvly-…')] },
  ollama: { label: 'Ollama', baseUrl: 'none', category: 'search', fields: [apiKey()] },
  exa: { label: 'Exa', baseUrl: 'none', category: 'search', fields: [apiKey('exa_…')] },
  linkup: { label: 'Linkup', baseUrl: 'none', category: 'search', fields: [apiKey('lp_…')] },
  // Gmail backs the email workflow node; Drive can back a project's file storage.
  gmail: {
    label: 'Gmail', baseUrl: 'none', category: 'productivity',
    fields: [...GOOGLE_OAUTH_FIELDS, credentialField('fromEmail', { ...text, placeholder: 'you@gmail.com' })],
  },
  google_drive: {
    label: 'Google Drive', baseUrl: 'none', category: 'productivity',
    fields: [...GOOGLE_OAUTH_FIELDS, credentialField('rootFolderId', { ...text, required: false })],
  },
} satisfies Record<string, LegacyForm>;

export type LegacyProviderId = keyof typeof LEGACY_PROVIDER_FORMS;

/** What the connect UI renders for one provider. */
export interface ConnectableProviderDescriptor {
  id: string;
  /** Brand name — rendered literally, never translated. */
  label: string;
  category: ConnectableCategory;
  baseUrl: BaseUrlRequirement;
  credentialFields: CredentialField[];
  transport: ProviderTransport;
  /** The Data/Marketing/Enrichment family; null for a legacy provider. */
  family: ProviderFamily | null;
  /** What a workflow node can call — catalog providers only. */
  operations: OperationSpec[];
  /** English; the UI renders its own localized note from `transport`. */
  transportNote: string | null;
}

function legacyCategory(id: string, form: LegacyForm): ConnectableCategory {
  const category = getBoardProviderMeta(id)?.category ?? form.category;
  // Loud at module load rather than a card silently filed under the wrong heading.
  if (!category) throw new Error(`connectableCatalog: legacy provider "${id}" is not a board and declares no category`);
  return category;
}

function build(): readonly ConnectableProviderDescriptor[] {
  const legacy = (Object.entries(LEGACY_PROVIDER_FORMS) as [LegacyProviderId, LegacyForm][]).map(
    ([id, form]): ConnectableProviderDescriptor => ({
      id,
      label: form.label,
      category: legacyCategory(id, form),
      baseUrl: form.baseUrl,
      credentialFields: form.fields,
      transport: 'http',
      family: null,
      operations: [],
      transportNote: null,
    }),
  );
  const catalog = describeProviders().map(
    (p): ConnectableProviderDescriptor => ({
      id: p.id,
      label: p.label,
      category: p.family,
      // A catalog provider's host lives in its own fields (DSN, project URL, endpoint).
      baseUrl: 'none',
      credentialFields: p.credentialFields,
      transport: p.transport,
      family: p.family,
      operations: p.operations,
      transportNote: p.transportNote,
    }),
  );
  const all = [...legacy, ...catalog];
  const seen = new Set<string>();
  for (const entry of all) {
    if (seen.has(entry.id)) throw new Error(`connectableCatalog: provider "${entry.id}" is described twice`);
    seen.add(entry.id);
  }
  return Object.freeze(all);
}

const CATALOG = build();

/** Every connectable provider's connect-form descriptor. */
export function connectableCatalog(): readonly ConnectableProviderDescriptor[] {
  return CATALOG;
}
