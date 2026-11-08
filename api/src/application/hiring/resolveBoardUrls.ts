/**
 * Close the "published, but no link yet" gap.
 *
 * A board's create answer does not always carry a public link or the id the link is built
 * from: Greenhouse returns a job id while its public page is addressed by a job-POST id,
 * and LinkedIn returns a task that only later names the job. A board that can answer
 * that question declares a `resolve_url` action with a match rule (see
 * `ConnectorUrlResolution`); this runs it for confirmed rows whose `url` is still NULL
 * and writes what it found through the same {@link publicUrl} filter as every other URL.
 *
 * Vendor-blind: the action, the match rule and the selectors are manifest data; this file
 * only calls the action through `executeConnectorAction` and reads it with
 * `extractResolvedUrl`. Best-effort and quiet — a miss leaves the row as it was, and the
 * next pass tries again.
 *
 * THE ID IS NEVER REPLACED ON ITS OWN. A resolved id (LinkedIn's job id replacing its task
 * urn) is written only together with a valid URL: an id swapped in without the link that
 * proves it resolved would leave a row whose reference no longer matches what the board
 * was told, with nothing to show for it.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveConnector } from '../connectors/connectorRegistry';
import { templateConnectionFields } from '../connectors/connectorMappingValidators';
import { encodeResolveId, extractResolvedUrl } from '../connectors/connectorUrlResolution';
import { HIRING_CONNECTORS } from '../connectors/defaults/hiring';
import { isUniqueViolation } from '../../infrastructure/database/uniqueViolation';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { BOARD_JOB_UNIQUE_INDEX } from './postingActionKeys';
import {
  DEFAULT_DISTRIBUTE_DEPS,
  connectionBackedInput,
  missingConnectionParams,
  pinnedPublicUrl,
  publicUrl,
  type DistributeDeps,
} from './postingDistributionSupport';
import {
  listPostedDistributionsForSweep,
  markResolveConflict,
  recordResolvedLink,
  touchPostedDistribution,
  type PostedDistribution,
} from './postingDistributionSweepStore';

export const RESOLVE_URL_ACTION = 'resolve_url';
/** Rows one sweep tries to link. Each is at most one upstream call. */
export const MAX_URL_RESOLUTIONS_PER_SWEEP = 40;

/**
 * The built-in boards that HAVE a `resolve_url` action — the sweep's worklist filter, so a
 * board that cannot resolve (Indeed has no link by design) never spends the budget. A
 * tenant-authored board with `resolve_url` is resolved when its postings are imported by
 * hand, not by the sweep.
 */
export const RESOLVABLE_BOARD_KEYS: readonly string[] = HIRING_CONNECTORS
  .filter((manifest) => manifest.actions.some((action) => action.key === RESOLVE_URL_ACTION && action.resolve))
  .map((manifest) => manifest.key);

export type UrlResolutionOutcome = 'linked' | 'unresolved' | 'unsupported';

/** Try to find ONE confirmed publication's link. Never throws. */
export async function resolveDistributionUrl(
  db: Db,
  env: Env,
  row: PostedDistribution,
  deps: DistributeDeps = DEFAULT_DISTRIBUTE_DEPS,
  actorKind: 'user' | 'system' = 'system',
): Promise<UrlResolutionOutcome> {
  try {
    const resolved = await resolveConnector(db, row.tenantId, row.connectorKey, env);
    const action = resolved?.manifest.actions.find((candidate) => candidate.key === RESOLVE_URL_ACTION);
    const resolve = action?.resolve;
    if (!action || !resolve) return 'unsupported';

    // Connection facts: the action's `{{auth.x}}` params and the template's
    // `{connection.x}` fields. A missing one means the call (or the link) cannot be right.
    const auth = row.connectionId
      ? (await (deps.loadConnection ?? DEFAULT_DISTRIBUTE_DEPS.loadConnection!)(db, env, row.tenantId, row.connectionId)).auth
      : {};
    const input: Record<string, unknown> = { ...connectionBackedInput(action, auth) };
    if (missingConnectionParams(action, input).length) return 'unresolved';
    if (resolve.idParam) input[resolve.idParam] = encodeResolveId(resolve, row.externalId);

    const result = await deps.execute({
      db, env,
      tenantId: row.tenantId,
      connectorKey: row.connectorKey,
      actionKey: action.key,
      input,
      ...(row.connectionId ? { connectionId: row.connectionId } : {}),
      actorKind,
    });
    if (!result.ok) return 'unresolved';

    const connection: Record<string, string> = {};
    for (const field of templateConnectionFields(resolve.urlTemplate)) connection[field] = auth[field] ?? '';

    // A link the board REPORTS must be on its own domain; one the manifest BUILDS is authored.
    const found = extractResolvedUrl(
      resolve, result.data, row.externalId, connection,
      (reported) => pinnedPublicUrl(reported, resolved!.manifest),
    );
    const url = publicUrl(found.url);
    // No valid URL ⇒ nothing is written, not even a resolved id (see the header).
    if (!url) return 'unresolved';
    await recordResolvedLink(db, row, { url, externalId: found.resolvedId });
    return 'linked';
  } catch (error) {
    // A resolved id another posting already holds (1328's unique index) is the board
    // telling us this is not ours to link: say so on the row and back it off, rather than
    // retrying the same collision every sweep. Anything else is reported.
    if (isUniqueViolation(error, BOARD_JOB_UNIQUE_INDEX)) {
      await markResolveConflict(db, row, 'The board job this resolved to is already linked to another posting here, so its link was not recorded.')
        .catch((markError: unknown) => reportCaughtError(markError, {
          source: 'application/hiring/resolveBoardUrls.ts',
          operation: 'markResolveConflict',
          level: 'warning',
        }));
    } else {
      reportCaughtError(error, {
        source: 'application/hiring/resolveBoardUrls.ts',
        operation: 'resolveDistributionUrl',
        context: { tenantId: row.tenantId, connectorKey: row.connectorKey },
      });
    }
    return 'unresolved';
  }
}

export interface UrlResolutionSweepResult { checked: number; linked: number }

/** The lightweight pass inside the applicant sweep: a bounded, rotating batch of rows with no link. */
export async function runUrlResolutionPass(
  db: Db,
  env: Env,
  deps: DistributeDeps = DEFAULT_DISTRIBUTE_DEPS,
  limit: number = MAX_URL_RESOLUTIONS_PER_SWEEP,
): Promise<UrlResolutionSweepResult> {
  const result: UrlResolutionSweepResult = { checked: 0, linked: 0 };
  const rows = await listPostedDistributionsForSweep(db, limit, {
    missingUrlOnly: true,
    connectorKeys: RESOLVABLE_BOARD_KEYS,
  });
  for (const row of rows) {
    // Rotate FIRST, so a row that cannot resolve (or crashes the pass) does not starve the rest.
    await touchPostedDistribution(db, row);
    const outcome = await resolveDistributionUrl(db, env, row, deps, 'system');
    result.checked += 1;
    if (outcome === 'linked') result.linked += 1;
  }
  return result;
}
