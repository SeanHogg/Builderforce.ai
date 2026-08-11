/**
 * The DEFAULT connector catalog — what every tenant can connect on day one,
 * before anyone authors anything.
 *
 * Shipped as CODE, not as seeded rows. A seeded catalog would fork per tenant the
 * moment it was written: fixing a wrong path or adding an action would mean a data
 * migration across every tenant, and tenants created before the fix would keep the
 * broken copy forever. As code, every tenant reads the same current manifest and a
 * fix ships with the deploy. Tenant-authored connectors live in the `connectors`
 * table and are merged on top of these by {@link ../connectorRegistry}.
 */

import { parseConnectorManifest, type ConnectorManifest } from '../connectorManifest';
import { COMMUNICATION_CONNECTORS } from './communication';
import { TWILIO_CONNECTORS } from './twilio';
import { BUSINESS_CONNECTORS } from './business';
import { PRODUCTIVITY_CONNECTORS } from './productivity';
import { DEVTOOLS_CONNECTORS } from './devtools';
import { GENERIC_CONNECTORS } from './generic';
import { SOCIAL_CONNECTORS } from './social';

const ALL: readonly ConnectorManifest[] = [
  ...COMMUNICATION_CONNECTORS,
  ...TWILIO_CONNECTORS,
  ...BUSINESS_CONNECTORS,
  ...PRODUCTIVITY_CONNECTORS,
  ...DEVTOOLS_CONNECTORS,
  ...GENERIC_CONNECTORS,
  ...SOCIAL_CONNECTORS,
];

/** Built-in manifests, keyed for O(1) resolution. */
export const BUILTIN_CONNECTORS: ReadonlyMap<string, ConnectorManifest> = new Map(ALL.map((m) => [m.key, m]));

/** Built-in catalog as a list, in category order. */
export const BUILTIN_CONNECTOR_LIST: readonly ConnectorManifest[] = ALL;

/** Keys a tenant may NOT reuse when authoring a custom connector. */
export const RESERVED_CONNECTOR_KEYS: ReadonlySet<string> = new Set(ALL.map((m) => m.key));

/**
 * Run every built-in manifest through the SAME validator tenant input goes through.
 * Called by `defaults.test.ts` — a built-in with a typo'd path placeholder or an
 * undeclared `{{auth.x}}` would otherwise fail at call time, in a customer's account,
 * with an error that looks like their misconfiguration.
 */
export function validateBuiltinCatalog(): { key: string; errors: string[] }[] {
  const failures: { key: string; errors: string[] }[] = [];
  for (const manifest of ALL) {
    try {
      parseConnectorManifest(JSON.parse(JSON.stringify(manifest)));
    } catch (e) {
      failures.push({
        key: manifest.key,
        errors: e instanceof Error && 'errors' in e ? (e as { errors: string[] }).errors : [String(e)],
      });
    }
  }
  return failures;
}
