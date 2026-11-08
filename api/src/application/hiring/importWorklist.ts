/**
 * Which boards the scheduled applicant import visits.
 *
 * A board is importable when its list action declares an `applicants` mapping — that is
 * the whole rule, for built-in boards AND for a tenant's own or installed ones. The
 * built-ins are known at build time ({@link IMPORTABLE_BOARD_KEYS}); a tenant's are only
 * knowable by reading that tenant's catalog, so the sweep resolves each tenant that has a
 * non-built-in board live ONCE (the catalog is cached) and adds the importable ones to the
 * worklist. Otherwise a board a customer authored would import by hand and never on the
 * schedule.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { listConnectorsForTenant } from '../connectors/connectorRegistry';
import type { ConnectorAction, ConnectorApplicantMapping } from '../connectors/connectorManifest';
import { BUILTIN_CONNECTORS } from '../connectors/defaults';
import { HIRING_CONNECTORS } from '../connectors/defaults/hiring';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { LIST_APPLICANTS_ACTIONS } from './postingActionKeys';
import {
  listPostedDistributionsForSweep,
  listTenantBoardKeys,
  type PostedDistribution,
  type TenantBoard,
} from './postingDistributionSweepStore';
import { MAX_WORKLIST_TENANTS } from './importBudget';

/** The list action a manifest imports through, or null. */
export function importAction(actions: readonly ConnectorAction[]): (ConnectorAction & { applicants: ConnectorApplicantMapping }) | null {
  for (const key of LIST_APPLICANTS_ACTIONS) {
    const action = actions.find((candidate) => candidate.key === key);
    if (action?.applicants) return action as ConnectorAction & { applicants: ConnectorApplicantMapping };
  }
  return null;
}

/** The built-in boards that CAN be imported from — the sweep's worklist filter, so a board
 *  with nothing to import never spends its budget. */
export const IMPORTABLE_BOARD_KEYS: readonly string[] = HIRING_CONNECTORS
  .filter((manifest) => importAction(manifest.actions))
  .map((manifest) => manifest.key);

/** Pairs read per sweep before they are narrowed to the importable ones. */
const MAX_TENANT_BOARD_PAIRS = 100;

/** The tenant-authored / installed boards that are importable: one catalog read per tenant. */
async function importableTenantBoards(db: Db, env: Env): Promise<TenantBoard[]> {
  const pairs = await listTenantBoardKeys(db, [...BUILTIN_CONNECTORS.keys()], MAX_TENANT_BOARD_PAIRS);
  const byTenant = new Map<number, Set<string>>();
  for (const pair of pairs) byTenant.set(pair.tenantId, (byTenant.get(pair.tenantId) ?? new Set()).add(pair.connectorKey));

  const importable: TenantBoard[] = [];
  for (const [tenantId, keys] of [...byTenant].slice(0, MAX_WORKLIST_TENANTS)) {
    try {
      const catalog = await listConnectorsForTenant(db, tenantId, env); // cached per tenant
      for (const entry of catalog) {
        if (keys.has(entry.manifest.key) && entry.status === 'published' && importAction(entry.manifest.actions)) {
          importable.push({ tenantId, connectorKey: entry.manifest.key });
        }
      }
    } catch (error) {
      // One tenant's unreadable catalog must not take the sweep down.
      reportCaughtError(error, { source: 'application/hiring/importWorklist.ts', operation: 'importableTenantBoards', context: { tenantId } });
    }
  }
  return importable;
}

/** The sweep's next batch: built-in importable boards plus the tenants' own importable ones. */
export async function listImportWorklist(db: Db, env: Env, limit: number): Promise<PostedDistribution[]> {
  const tenantBoards = await importableTenantBoards(db, env);
  return listPostedDistributionsForSweep(db, limit, {
    connectorKeys: IMPORTABLE_BOARD_KEYS,
    ...(tenantBoards.length ? { tenantBoards } : {}),
  });
}
