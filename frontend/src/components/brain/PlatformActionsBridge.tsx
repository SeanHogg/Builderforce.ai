'use client';

/**
 * Registers the platform-action layer into the Brain's client tool loop — the
 * "MCP for every capability" registry. Rendered (null UI) inside the Brain
 * providers whenever the user is in a workspace, so BOTH the docked drawer and
 * the full Brain Storm page can drive the entire platform. Mirrors
 * McpExtensionsBridge (which registers the tenant's external MCP servers).
 *
 * Navigation needs the router and tenant-scoped calls need the workspace id, so
 * those are injected here; the manifest itself (platformActions.ts) stays free
 * of next/navigation and auth.
 */

import { useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { buildPlatformActions, focusDomainsForPath, useRegisterBrainActions } from '@/lib/brain';
import { useAuth } from '@/lib/AuthContext';

export function PlatformActionsBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? null;
  // Promote the current route's relevant tools first-class (string key so the
  // memo only recomputes when the focus set actually changes, not every nav).
  const focusKey = focusDomainsForPath(pathname).join(',');

  const actions = useMemo(
    () =>
      buildPlatformActions({
        navigate: (path: string) => router.push(path),
        getTenantId: () => (tenantId != null ? Number(tenantId) : null),
        focusDomains: focusKey ? focusKey.split(',') : [],
      }),
    [router, tenantId, focusKey],
  );

  useRegisterBrainActions(actions);
  return null;
}
