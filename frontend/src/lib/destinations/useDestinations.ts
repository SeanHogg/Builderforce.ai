'use client';

import { useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { getStoredTenant } from '@/lib/auth';
import { useAvailableForHire, useIsFreelancer, useIsSalesAssociate } from '@/lib/rbac';
import { navGroupsForAccountType } from '@/lib/navGroups';
import { listDestinations, type Destination } from './registry';

/**
 * The destinations THIS account may actually reach.
 *
 * One gate, applied once, for every door — the palette and the Brain both read
 * this rather than each re-deriving "is this person an owner / a superadmin / a
 * gig account". The account-type split is the nav config's own
 * ({@link navGroupsForAccountType}), so a freelancer's palette can never offer a
 * builder route their route guard would bounce them out of.
 */
export function useDestinations(): Destination[] {
  const { user } = useAuth();
  const isFreelancer = useIsFreelancer();
  const availableForHire = useAvailableForHire();
  const isSales = useIsSalesAssociate();
  const isSuperadmin = !!user?.isSuperadmin;

  return useMemo(() => {
    const isOwner = getStoredTenant()?.role === 'owner';
    return listDestinations(navGroupsForAccountType(isFreelancer, availableForHire, isSales))
      .filter((destination) => (!destination.superadminOnly || isSuperadmin) && (!destination.ownerOnly || isOwner));
  }, [availableForHire, isFreelancer, isSales, isSuperadmin]);
}
