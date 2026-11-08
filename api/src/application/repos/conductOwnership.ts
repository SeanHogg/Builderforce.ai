/**
 * conductOwnership — which review tickets the PR-conduct sweep is ACTUALLY conducting, as
 * stall triage needs to know it. Two facts, both required:
 *   • the `pr-ticket-reconciler` control is on (the sweep returns immediately when it is off);
 *   • the sweep examined the ticket recently (`conductMarker.ts`) — which also covers a
 *     disabled manager config, an exhausted tenant dispatch budget and a ticket past the cap.
 * Kept out of triageStage.ts so that file does not grow a new responsibility.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { reportedFallback } from '../observability/caughtErrorReporter';
import { cronSweepEnabled, readCronControls } from '../runtime/cronControls';
import { loadRecentlyConducted } from './conductMarker';

export async function loadSweepOwnedTickets(
  env: Env, db: Db,
  args: { tenantId: number; projectId: number; taskIds: readonly number[]; now: number },
): Promise<Set<number>> {
  if (!args.taskIds.length) return new Set();
  const controls = await readCronControls(env).catch(reportedFallback(null, { source: 'application/repos/conductOwnership.ts', operation: 'readCronControls', context: { tenantId: args.tenantId } }));
  // An unreadable control state is treated as ON: the marker alone still has to vouch for
  // the ticket, so this can never claim a ticket the sweep did not recently examine.
  if (controls && !cronSweepEnabled(controls, 'pr-ticket-reconciler')) return new Set();
  return loadRecentlyConducted(db, args);
}
