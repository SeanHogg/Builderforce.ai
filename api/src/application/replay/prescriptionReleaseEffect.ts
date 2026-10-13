/**
 * THE verifier of a fix a person applied by hand from its prompt (PRD 33 §5.2,
 * §5.1.5): `copy_prompt`, `apply_page`, `apply_in_composer`. The fix's page metric on
 * the release that shipped it (`p=` in `action_ref`, set by
 * `prescriptionReleaseHooks.ts`) against the release before it, through the SAME
 * fold as a ticket's effect (`ticketEffect.momentEffect`, ≥ 200 visits before any
 * verdict).
 */

import { routeTemplate, type ReplayMomentMetric } from '@builderforce/interaction-contract';
import { asJsonRecord } from '../../domain/shared/json';
import { verdictFor } from '../../domain/replay/prescriptions/prescriptionState';
import type { Measurement, VerifyContext } from './prescriptionVerify';
import { ReplayReadService } from './ReplayReadService';
import { momentEffect } from './ticketEffect';

/** The rollup metric an acceptance speaks to (frustration / errors down, else conversions). */
export function momentMetricFor(acceptance: unknown): ReplayMomentMetric {
  const a = asJsonRecord(acceptance);
  const metric = typeof a.metric === 'string' ? a.metric : '';
  if (/error/.test(metric)) return 'errors';
  if (/rage|dead|frustrat|quickback|scroll/.test(metric)) return 'frustrated';
  return 'conversions';
}

/** THE verifier of a hand-applied fix: the page on the release that shipped it vs the release before. */
export async function viaReleaseEffect({ env, db, scope, row, refs }: VerifyContext): Promise<Measurement | null> {
  if (!refs.previewRelease || !row.pagePath) return null;
  const releases = await new ReplayReadService(env, db).releases(scope); // newest first
  const at = releases.findIndex((r) => r.releaseKey === refs.previewRelease);
  const before = at >= 0 ? releases[at + 1] : undefined;
  if (!before) return null;
  const metric = momentMetricFor(row.acceptance);
  const effect = await momentEffect(env, db, scope, {
    siteId: scope.siteId,
    recordingId: row.id,
    atMs: 0,
    releaseKey: before.releaseKey,
    metric,
    route: routeTemplate(row.pagePath),
  });
  if (effect.status !== 'measured' || effect.delta === null) return null;
  return {
    before: effect.before.rate,
    after: effect.after?.rate ?? null,
    delta: effect.delta,
    verdict: verdictFor(effect.delta, effect.before.rate, metric === 'conversions' ? 'up' : 'down'),
    source: 'ticket_effect',
    releaseKey: refs.previewRelease,
  };
}
