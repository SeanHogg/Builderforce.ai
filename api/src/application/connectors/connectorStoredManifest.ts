/**
 * Reading a STORED connector manifest (a tenant's own row, a marketplace install).
 *
 * `parseConnectorManifest` is the WRITE gate and stays strict. A row written before a rule
 * tightened (the pattern grammar, a cursor that now needs an `order`) must not vanish from
 * the catalog over one data mapping: this read keeps the connector, disables only the
 * mapping that no longer validates, and records why on `manifest.degraded`. See the header
 * of `connectorActionValidation.ts` for the rule. Anything that is NOT a mapping fault (an
 * unknown method, a bad base URL, no actions) still throws — that connector cannot run.
 */

import { parseConnectorManifest, type ConnectorManifest } from './connectorManifest';

export function parseStoredConnectorManifest(raw: unknown): ConnectorManifest {
  const degraded: string[] = [];
  const manifest = parseConnectorManifest(raw, { lenient: true, degraded });
  return degraded.length ? { ...manifest, degraded } : manifest;
}
