/**
 * Write-time check of a hiring board's `sourceAliases` against the tenant's whole catalog.
 *
 * Split from `connectorService.ts`: this is the one place the generic connector CRUD has to
 * know what a job board is, and it is the same question wherever a manifest is written.
 */

import type { Db } from '../../infrastructure/database/connection';
import { ConnectorManifestError, parseConnectorManifest, type ConnectorManifest } from './connectorManifest';
import { listConnectorsForTenant } from './connectorRegistry';
import { sourceAliasConflicts } from '../hiring/applicantSource';

/**
 * Parse (STRICTLY — this is the write gate) a manifest and, for a hiring board that
 * declares source aliases, check them against EVERY board this tenant already has — the
 * built-ins, its own and installed ones (the catalog read the connector list uses) — so an
 * alias can never silently take applicants from a board that already owns that spelling.
 * Throws {@link ConnectorManifestError}.
 */
export async function parseManifestAgainstBoards(db: Db, tenantId: number, raw: unknown): Promise<ConnectorManifest> {
  const manifest = parseConnectorManifest(raw);
  if (manifest.sourceAliases?.length) {
    const boards = (await listConnectorsForTenant(db, tenantId))
      .filter((entry) => entry.manifest.category === 'hiring')
      .map((entry) => ({ key: entry.manifest.key, aliases: entry.manifest.sourceAliases ?? [] }));
    const conflicts = sourceAliasConflicts(manifest, boards);
    if (conflicts.length) throw new ConnectorManifestError(conflicts);
  }
  return manifest;
}
