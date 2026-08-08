'use client';

import { useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { getStoredTenant } from '@/lib/auth';
import { useConsumption } from '@/lib/useConsumption';
import { useAvailableForHire, useIsFreelancer, useIsSalesAssociate } from '@/lib/rbac';
import { navGroupsForAccountType } from '@/lib/navGroups';
import { listDestinations, type Destination } from './registry';

/** A destination plus whether a paid plan stands between this user and it. */
export interface GatedDestination extends Destination {
  /** True when the route's own API gate would refuse this tenant today. */
  locked: boolean;
  /** The lowest plan that unlocks it — only set when `locked`. */
  requiredPlan?: 'free' | 'pro' | 'teams';
}

/**
 * Where opening this destination should actually go.
 *
 * A locked destination routes to PRICING, not to a page the API would answer
 * with a 402. Shared because every door has to make the same call — the palette
 * on Enter, the Brain on `show_panel` — and two copies is how one of them starts
 * sending people into a wall.
 */
export function destinationHref(destination: GatedDestination): string {
  if (!destination.locked) return destination.href;
  return `/pricing?feature=${encodeURIComponent(destination.feature ?? '')}`;
}

/**
 * The destinations THIS account may reach, and which of them are plan-locked.
 *
 * ONE gate, applied once, for every door — the palette and the Brain both read
 * this rather than each re-deriving "is this person an owner / a superadmin / a
 * gig account / on a plan that includes this". The account-type split is the nav
 * config's own ({@link navGroupsForAccountType}), so a freelancer's palette can
 * never offer a builder route their route guard would bounce them out of.
 *
 * Two different kinds of "no", handled differently on purpose:
 *   - **Not for this account** (wrong account type, not an owner, not a platform
 *     operator) → the destination is ABSENT. It is not a thing this person can
 *     buy their way into, so offering it would only mislead.
 *   - **Not on this plan** → the destination is PRESENT and marked `locked`.
 *     Hiding it turns "you need Pro" into "this product cannot do that", which
 *     loses the upsell and misrepresents the product.
 *
 * Entitlement comes from the server's resolved feature set, never from
 * `plan.effective` — see the registry's note on why that matters.
 */
export function useDestinations(): GatedDestination[] {
  const { user } = useAuth();
  const isFreelancer = useIsFreelancer();
  const availableForHire = useAvailableForHire();
  const isSales = useIsSalesAssociate();
  const isSuperadmin = !!user?.isSuperadmin;
  const consumption = useConsumption();
  const features = consumption?.features;

  return useMemo(() => {
    const isOwner = getStoredTenant()?.role === 'owner';
    return listDestinations(navGroupsForAccountType(isFreelancer, availableForHire, isSales))
      .filter((destination) => (!destination.superadminOnly || isSuperadmin) && (!destination.ownerOnly || isOwner))
      .map((destination) => {
        // No feature declared, or no snapshot yet → nothing is KNOWN to be
        // locked. Defaulting to locked would flash every gated row as
        // unavailable on first paint.
        const locked = !!destination.feature && features?.entitled?.[destination.feature] === false;
        return {
          ...destination,
          locked,
          ...(locked && destination.feature
            ? { requiredPlan: features?.requiredPlan?.[destination.feature] }
            : {}),
        };
      });
  }, [availableForHire, features, isFreelancer, isSales, isSuperadmin]);
}
