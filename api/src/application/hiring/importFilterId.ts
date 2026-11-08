/**
 * The id a board's applicant list is FILTERED by, when it is not the id the publication is
 * stored under.
 *
 * Ashby is the case: publishing creates a job POSTING (`jobPosting.create`, and
 * `jobPosting.list` is what linking reads), so the stored `external_id` is a posting id —
 * but `application.list` filters on the JOB id and every application names `job.id`.
 * Filtering by the posting id returns nothing, and comparing to it would drop everyone as
 * "another job's". The manifest's `applicants.filterIdFrom` names a sibling action that
 * turns one into the other; the answer is cached on the row (`board_filter_id`), so it is
 * looked up ONCE, not on every run. A board without `filterIdFrom` filters by the stored id.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { executeConnectorAction } from '../connectors/connectorRuntime';
import type { ConnectorApplicantMapping } from '../connectors/connectorManifest';
import { firstOf } from '../connectors/connectorResponseMapping';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { saveBoardFilterId, type PostedDistribution } from './postingDistributionSweepStore';

export type FilterIdResult = { ok: true; id: string; lookedUp: boolean } | { ok: false; error: string };

export async function resolveFilterId(
  db: Db,
  env: Env,
  row: PostedDistribution,
  mapping: ConnectorApplicantMapping,
  execute: typeof executeConnectorAction,
  actorKind: 'user' | 'system',
): Promise<FilterIdResult> {
  const lookup = mapping.filterIdFrom;
  if (!lookup) return { ok: true, id: row.externalId, lookedUp: false };
  if (row.boardFilterId) return { ok: true, id: row.boardFilterId, lookedUp: false };

  const result = await execute({
    db, env,
    tenantId: row.tenantId,
    connectorKey: row.connectorKey,
    actionKey: lookup.action,
    input: { [lookup.idParam]: row.externalId },
    ...(row.connectionId ? { connectionId: row.connectionId } : {}),
    actorKind,
  });
  if (!result.ok) return { ok: false, error: (result.error ?? `The job board answered ${result.status}.`).slice(0, 600) };
  const id = firstOf({ data: result.data }, lookup.select);
  // Importing with the posting id as the filter would read nothing and drop everyone: stop.
  if (!id) return { ok: false, error: 'The job board did not say which job this posting belongs to.' };
  try {
    await saveBoardFilterId(db, row, id);
  } catch (error) {
    // Not fatal: this run proceeds with the id it has, and the next run looks it up again.
    reportCaughtError(error, { source: 'application/hiring/importFilterId.ts', operation: 'saveBoardFilterId', level: 'warning' });
  }
  return { ok: true, id, lookedUp: true };
}
