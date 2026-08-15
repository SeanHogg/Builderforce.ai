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
import { HIRING_CONNECTORS } from './hiring';
import { ADVERTISING_CONNECTORS } from './advertising';
import { ANALYTICS_CONNECTORS } from './analytics';
import { MARKETING_PLATFORM_CONNECTORS } from './marketing';
// Payroll and tax — the two largest recurring obligations a company has, and the
// two that appeared nowhere in this codebase at all. Reads lead, deliberately:
// see the file's own note on why the platform must not become a payroll engine.
import { PAYROLL_CONNECTORS } from './payroll';
// The whiteboard a team is leaving. Read-shaped, because the point of connecting
// one is to bring its boards across once — see the file's own note.
import { WHITEBOARD_CONNECTORS } from './whiteboard';

const ALL: readonly ConnectorManifest[] = [
  ...COMMUNICATION_CONNECTORS,
  ...TWILIO_CONNECTORS,
  ...BUSINESS_CONNECTORS,
  ...PRODUCTIVITY_CONNECTORS,
  ...DEVTOOLS_CONNECTORS,
  ...GENERIC_CONNECTORS,
  ...SOCIAL_CONNECTORS,
  ...ADVERTISING_CONNECTORS,
  ...MARKETING_PLATFORM_CONNECTORS,
  ...ANALYTICS_CONNECTORS,
  ...HIRING_CONNECTORS,
  ...PAYROLL_CONNECTORS,
  ...WHITEBOARD_CONNECTORS,
];

/** Built-in manifests, keyed for O(1) resolution. */
export const BUILTIN_CONNECTORS: ReadonlyMap<string, ConnectorManifest> = new Map(ALL.map((m) => [m.key, m]));

/** Built-in catalog as a list, in category order. */
export const BUILTIN_CONNECTOR_LIST: readonly ConnectorManifest[] = ALL;

/** Keys a tenant may NOT reuse when authoring a custom connector. */
export const RESERVED_CONNECTOR_KEYS: ReadonlySet<string> = new Set(ALL.map((m) => m.key));

/**
 * True when `key` names a built-in and therefore cannot be claimed by anyone else.
 *
 * Lives beside the set rather than in `connectorRegistry` (which re-exports it for
 * its existing callers) because both the tenant-authoring path and the marketplace
 * review path need it, and routing the review path through the registry would put
 * `connectorRegistry → extensionInstalls → packageReview → connectorRegistry` in
 * the module graph. The predicate belongs with its data; the cycle was the hint.
 */
export function isReservedConnectorKey(key: string): boolean {
  return RESERVED_CONNECTOR_KEYS.has(key);
}

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
