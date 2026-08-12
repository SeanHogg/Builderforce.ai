/**
 * The public integration catalog is a PROJECTION, and these assert the property
 * that makes it worth having: a system reachable through a port appears on the
 * page without anyone editing the page. Every one of these would have passed
 * vacuously against the hand-typed frontend array it replaced — which is the
 * point. They fail the moment the projection stops covering a port.
 */

import { describe, expect, it } from 'vitest';
import { BOARD_PROVIDERS } from '../boardsync/providerCatalog';
import { BUILTIN_CONNECTOR_LIST } from '../connectors/defaults';
import { MAILBOX_PROVIDER_NAMES } from '../mailbox/mailboxProviders';
import { PAYOUT_PROVIDER_NAMES } from '../payouts/payoutProviders';
import { describeProviders } from './dataProviderCatalog';
import {
  INTEGRATION_CATALOG,
  INTEGRATION_CATEGORIES,
  integrationCatalogByCategory,
} from './integrationCatalog';

const ids = new Set(INTEGRATION_CATALOG.map((entry) => entry.id));

describe('integration catalog projection', () => {
  it('covers every built-in connector', () => {
    for (const manifest of BUILTIN_CONNECTOR_LIST) expect(ids).toContain(manifest.key);
  });

  it('covers every board provider', () => {
    for (const provider of BOARD_PROVIDERS) expect(ids).toContain(provider.id);
  });

  it('covers every data/marketing provider', () => {
    for (const provider of describeProviders()) expect(ids).toContain(provider.id);
  });

  it('covers every mailbox provider', () => {
    for (const name of MAILBOX_PROVIDER_NAMES) expect(ids).toContain(`mailbox-${name}`);
  });

  it('covers every payout destination, as an export', () => {
    for (const name of PAYOUT_PROVIDER_NAMES) {
      expect(ids).toContain(name);
      const entry = INTEGRATION_CATALOG.find((item) => item.id === name);
      expect(entry?.surfaces).toEqual(expect.arrayContaining(['payout']));
    }
    // Stripe is a connector AND a payout destination — one entry, both surfaces,
    // exactly as GitHub is one entry across connector + board.
    const stripe = INTEGRATION_CATALOG.find((entry) => entry.id === 'stripe');
    expect(stripe?.surfaces).toEqual(expect.arrayContaining(['connector', 'payout']));
    expect(INTEGRATION_CATALOG.filter((entry) => entry.id === 'stripe')).toHaveLength(1);
  });

  it('names one entry per system, not one per port', () => {
    // GitHub is a built-in connector AND a synced board. A buyer asking "do you
    // support GitHub?" gets one answer, with both ways of connecting on it.
    const github = INTEGRATION_CATALOG.find((entry) => entry.id === 'github');
    expect(github).toBeDefined();
    expect(github?.surfaces).toEqual(expect.arrayContaining(['connector', 'board']));
    expect(INTEGRATION_CATALOG.filter((entry) => entry.id === 'github')).toHaveLength(1);
  });

  it('gives every entry a category from the published vocabulary', () => {
    for (const entry of INTEGRATION_CATALOG) {
      expect(INTEGRATION_CATEGORIES).toContain(entry.category);
    }
  });

  it('derives direction from what a connector can actually do', () => {
    // Not asserted per-connector: the claim is that the derivation is real, i.e.
    // a manifest with only reads is never advertised as two-way.
    for (const manifest of BUILTIN_CONNECTOR_LIST) {
      if (manifest.actions.every((action) => action.method === 'GET')) {
        const entry = INTEGRATION_CATALOG.find((item) => item.id === manifest.key);
        // Unless another port writes to the same system, in which case two-way
        // is the truth — that merge is asserted above.
        if (entry?.surfaces.length === 1) expect(entry.direction).toBe('import');
      }
    }
  });

  it('groups in the declared category order and drops empty categories', () => {
    const groups = integrationCatalogByCategory();
    const order = groups.map((group) => group.category);
    expect(order).toEqual([...INTEGRATION_CATEGORIES].filter((category) => order.includes(category)));
    for (const group of groups) expect(group.entries.length).toBeGreaterThan(0);
    expect(groups.flatMap((group) => group.entries)).toHaveLength(INTEGRATION_CATALOG.length);
  });
});
