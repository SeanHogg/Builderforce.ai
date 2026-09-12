/**
 * The connect catalog is the ONE source of every connect form.
 *
 * The regression this guards: the frontend kept its own `PROVIDER_META` table,
 * the gallery built cards from it, and 24 catalog providers (Postgres, Neon,
 * Supabase, HubSpot, Mailchimp…) had no card and no form. Now every connectable
 * provider — legacy and catalog alike — is described here, and the UI renders
 * only what this list says.
 */
import { describe, expect, it } from 'vitest';
import { readFrontendSource } from '../../../scripts/lib/frontendSource.mjs';
import { BOARD_PROVIDERS } from '../boardsync/providerCatalog';
import { CATALOG_PROVIDER_IDS } from './dataProviderCatalog';
import { CREDENTIAL_FIELD_LABELS } from './credentialFields';
import {
  CONNECTABLE_CATEGORIES,
  LEGACY_PROVIDER_FORMS,
  connectableCatalog,
} from './connectableCatalog';
import { CONNECTABLE_PROVIDERS } from './providerTests';

const byId = new Map(connectableCatalog().map((entry) => [entry.id, entry]));

describe('connectableCatalog', () => {
  it('describes EVERY provider the connect endpoint accepts — legacy and catalog', () => {
    expect(CONNECTABLE_PROVIDERS.length).toBeGreaterThan(40);
    for (const id of CONNECTABLE_PROVIDERS) {
      const entry = byId.get(id);
      expect(entry, `${id} has no connect-form descriptor`).toBeDefined();
      expect(entry!.credentialFields.length, `${id} has an empty form`).toBeGreaterThan(0);
      expect(entry!.label.trim()).not.toBe('');
    }
    for (const id of CATALOG_PROVIDER_IDS) expect(byId.has(id), id).toBe(true);
    for (const id of Object.keys(LEGACY_PROVIDER_FORMS)) expect(byId.has(id), id).toBe(true);
  });

  it('serves the legacy providers’ fields from the catalog, not from the frontend', () => {
    const jira = byId.get('jira')!;
    expect(jira.baseUrl).toBe('required');
    expect(jira.credentialFields.map((f) => f.key)).toEqual(['email', 'apiToken']);
    expect(jira.credentialFields[0]).toMatchObject({ secret: false, required: true });

    const gmail = byId.get('gmail')!;
    expect(gmail.credentialFields.map((f) => f.key)).toEqual(['clientId', 'clientSecret', 'refreshToken', 'fromEmail']);

    // An optional field is declared optional, so the form does not demand it.
    const drive = byId.get('google_drive')!;
    expect(drive.credentialFields.find((f) => f.key === 'rootFolderId')?.required).toBe(false);
    expect(byId.get('pagerduty')!.credentialFields.find((f) => f.key === 'fromEmail')?.required).toBe(false);
  });

  it('files every provider under a gallery category — boards by the board catalog, the rest by family or declaration', () => {
    const categories = new Set<string>(CONNECTABLE_CATEGORIES);
    for (const entry of connectableCatalog()) expect(categories.has(entry.category), `${entry.id}: ${entry.category}`).toBe(true);
    for (const board of BOARD_PROVIDERS) {
      const entry = byId.get(board.id);
      if (entry) expect(entry.category, board.id).toBe(board.category);
    }
    expect(byId.get('confluence')!.category).toBe('knowledge');
    expect(byId.get('tavily')!.category).toBe('search');
    expect(byId.get('gmail')!.category).toBe('productivity');
    expect(byId.get('postgres')!.category).toBe('data');
    expect(byId.get('hubspot')!.category).toBe('marketing');
    expect(byId.get('clearbit')!.category).toBe('enrichment');
  });

  it('draws every field label from the ONE vocabulary', () => {
    for (const entry of connectableCatalog()) {
      for (const field of entry.credentialFields) {
        expect(field.label, `${entry.id}.${field.key}`).toBe(CREDENTIAL_FIELD_LABELS[field.key]);
      }
    }
  });
  // A legacy form without a probe (or the reverse) is a COMPILE error:
  // `LEGACY_TESTS` is typed `Record<LegacyProviderId, ProviderTest>`.
});

/**
 * The connect UI translates field labels, gallery categories and board hints
 * by KEY (`integrationCredentials.fields.<fieldKey>`,
 * `integrations.gallery.category.<category>`,
 * `boardConnections.externalBoardIdHint.<boardId>`). A key the catalogs lack
 * renders as a raw dotted path, so every value this module can emit must be
 * carried by all five catalogs.
 */
describe('connect catalog ↔ frontend message catalogs', () => {
  const LOCALES = ['en', 'zh', 'es', 'fr', 'de'] as const;
  type Node = Record<string, unknown>;
  const at = (root: Node, path: string[]): unknown => path.reduce<unknown>((node, part) => (node as Node | undefined)?.[part], root);

  it.each(LOCALES)('%s carries every field, category and board-hint key', (locale) => {
    const messages = JSON.parse(readFrontendSource(`frontend/src/i18n/messages/${locale}.json`, 'connect-catalog labels')) as Node;
    const missing: string[] = [];
    for (const key of Object.keys(CREDENTIAL_FIELD_LABELS)) {
      if (typeof at(messages, ['integrationCredentials', 'fields', key]) !== 'string') missing.push(`integrationCredentials.fields.${key}`);
    }
    for (const category of CONNECTABLE_CATEGORIES) {
      if (typeof at(messages, ['integrations', 'gallery', 'category', category]) !== 'string') missing.push(`integrations.gallery.category.${category}`);
    }
    for (const board of BOARD_PROVIDERS) {
      if (typeof at(messages, ['boardConnections', 'externalBoardIdHint', board.id]) !== 'string') missing.push(`boardConnections.externalBoardIdHint.${board.id}`);
    }
    expect(missing).toEqual([]);
  });
});
