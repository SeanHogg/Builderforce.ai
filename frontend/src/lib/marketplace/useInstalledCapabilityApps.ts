// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary.

import { useEffect, useState } from 'react';
import { useOptionalAuth } from '@/lib/AuthContext';
import { creationListingApi } from '@/lib/creationListings';
import { CAPABILITY_CACHE_PREFIX, CAPABILITY_STATE_TTL_MS } from '@/lib/capabilityApi';
import { getOrSetClientCached } from '@/infrastructure/http/readThrough';
import { installedCapabilityApps, type CapabilityAppDef, type CapabilityAppId } from './capabilityApps';

export type InstalledCapabilityApp = CapabilityAppDef & { id: CapabilityAppId };

/**
 * The capability apps this workspace has installed: `CAPABILITY_APPS` ∩ the
 * listings it acquired (`GET /api/creation-listings/acquired`). Cached per
 * workspace under the capability prefix, so an install (which invalidates that
 * prefix) shows up in the rail on the next read.
 */
export function useInstalledCapabilityApps(): InstalledCapabilityApp[] {
  const auth = useOptionalAuth();
  const hasTenant = auth?.hasTenant ?? false;
  const tenantId = auth?.tenant?.id ?? null;
  const [apps, setApps] = useState<InstalledCapabilityApp[]>([]);

  useEffect(() => {
    if (!hasTenant || !tenantId) { setApps([]); return undefined; }
    let live = true;
    getOrSetClientCached(`${CAPABILITY_CACHE_PREFIX}acquired:${tenantId}`, () => creationListingApi.acquired(), { ttlMs: CAPABILITY_STATE_TTL_MS })
      .then((acquired) => { if (live) setApps(installedCapabilityApps(acquired.map((row) => row.slug))); })
      .catch(() => { if (live) setApps([]); });
    return () => { live = false; };
  }, [hasTenant, tenantId]);

  return apps;
}
