/**
 * WHERE A WORKSPACE STANDS WITH ONE MARKETPLACE CAPABILITY (`CapabilityStateDto`).
 *
 * The one read every capability surface opens with — the canvas Insights surface's
 * three states (not installed → listing link; installed, not switched on → switch;
 * otherwise the app), the set-up page, the nav's app entry. It is answerable by ANY
 * member and never gated on the capability itself: it is how a surface decides
 * whether to show the gate.
 *
 * Built only from cached reads (held licences, the plan snapshot, the site list, the
 * usage snapshot), each invalidated by its own writer, so it is fresh straight after
 * an install without a composite cache that would have to know every writer.
 *
 * Capability-specific numbers (sites, usage) come from {@link CAPABILITY_STATE_DETAILS},
 * keyed by slug — a new capability is a row there, not a branch here.
 */
import type { CapabilityStateDto, ReplayUsageDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { CAPABILITY_FEATURES } from '../../domain/tenant/capabilityFeatures';
import { resolveFeatureEntitlement } from './featureEntitlements';
import { tenantHoldsCapability } from './heldCapabilities';
import { listSiteDtos } from '../replay/replaySiteAdmin';
import { usageSnapshot } from '../replay/replayUsage';

interface CapabilityDetails {
  siteCount: number;
  usage: ReplayUsageDto | null;
}

type DetailsReader = (env: Env, db: Db, tenantId: number) => Promise<CapabilityDetails>;

const CAPABILITY_STATE_DETAILS: Readonly<Record<string, DetailsReader>> = {
  'session-replay': async (env, db, tenantId) => {
    const [sites, usage] = await Promise.all([
      listSiteDtos(env, db, tenantId),
      usageSnapshot(env, db, tenantId),
    ]);
    return { siteCount: sites.length, usage };
  },
};

/** The state of `slug` for this caller's workspace, or null for an unknown capability. */
export async function capabilityState(
  env: Env,
  db: Db,
  input: { tenantId: number; userId: string | null; slug: string },
): Promise<CapabilityStateDto | null> {
  const features = CAPABILITY_FEATURES[input.slug];
  if (!features) return null;

  const [installed, verdicts] = await Promise.all([
    tenantHoldsCapability(env, db, input.tenantId, input.slug),
    Promise.all(features.map((feature) => resolveFeatureEntitlement(env, input.tenantId, input.userId, feature))),
  ]);
  const entitled = verdicts.every((verdict) => verdict.entitled);

  const reader = CAPABILITY_STATE_DETAILS[input.slug];
  const details: CapabilityDetails = entitled && reader
    ? await reader(env, db, input.tenantId)
    : { siteCount: 0, usage: null };

  return { slug: input.slug, installed, entitled, ...details };
}
