'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { consumptionApi, type ConsumptionSnapshot } from '@/lib/builderforceApi';

/**
 * Shared month-to-date consumption snapshot hook (DRY) — the single fetch behind
 * BOTH the sidebar <UsageMeter/> and the dashboard AI-usage tile, so neither
 * re-implements the gating/fetch and both read the SAME cached endpoint. Returns
 * null until there's a tenant session and a successful fetch (the endpoint is
 * all-members, so no role gate here — capping is on processing, not visibility).
 */
export function useConsumption(): ConsumptionSnapshot | null {
  const { hasTenant } = useAuth();
  const [snapshot, setSnapshot] = useState<ConsumptionSnapshot | null>(null);

  useEffect(() => {
    if (!hasTenant) return;
    let active = true;
    consumptionApi
      .get()
      .then((s) => { if (active) setSnapshot(s); })
      .catch(() => { if (active) setSnapshot(null); });
    return () => { active = false; };
  }, [hasTenant]);

  return hasTenant ? snapshot : null;
}
