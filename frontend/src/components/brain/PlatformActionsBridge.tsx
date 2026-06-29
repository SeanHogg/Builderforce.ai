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

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { buildPlatformActions, focusDomainsForPath, useRegisterBrainActions, useBrainContext, useBrainConfig } from '@/lib/brain';
import { useAuth } from '@/lib/AuthContext';

export function PlatformActionsBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const { tenant } = useAuth();
  const { setOpen } = useBrainContext();
  const { transport } = useBrainConfig();
  const tenantId = tenant?.id ?? null;
  // Promote the current route's relevant tools first-class (string key so the
  // memo only recomputes when the focus set actually changes, not every nav).
  const focusKey = focusDomainsForPath(pathname).join(',');

  // The `domain.method` keys the server MCP catalog already provides. We DROP
  // those from this native manifest so the catalog (registered via
  // McpExtensionsBridge) is the single source for them — the web Brain and the
  // VS Code chat then share one tool set. Fetched once; as the catalog grows,
  // this set grows and the native manifest auto-shrinks. `excludeKey` is a stable
  // string so the actions memo only recomputes when the set actually changes.
  const [excludeKey, setExcludeKey] = useState('');
  useEffect(() => {
    let cancelled = false;
    const token = transport.getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch(`${transport.baseUrl}/llm/v1/mcp/tools`, { headers })
      .then((r) => (r.ok ? r.json() : { tools: [] }))
      .then((body: { tools?: Array<{ extensionId?: string; tool?: string }> }) => {
        if (cancelled) return;
        const keys = (body.tools ?? [])
          .filter((t) => t.extensionId === 'builtin' && typeof t.tool === 'string')
          .map((t) => t.tool as string)
          .sort()
          .join(',');
        setExcludeKey(keys);
      })
      .catch(() => { if (!cancelled) setExcludeKey(''); });
    return () => { cancelled = true; };
  }, [transport]);

  const actions = useMemo(
    () =>
      buildPlatformActions({
        excludeToolKeys: excludeKey ? new Set(excludeKey.split(',')) : undefined,
        navigate: (path: string) => {
          // Keep the Brain visible across Brain-initiated navigation. The
          // full-page Brain (/brainstorm) and the IDE-embedded Brain are
          // route-scoped and unmount when the Brain navigates the user, so
          // surface the persistent floating drawer on the destination page —
          // otherwise a redirect silently "closes" the Brain mid-task. The
          // active chat is shared via BrainContext, so the conversation resumes
          // seamlessly. setOpen(true) is a no-op when the drawer is already open.
          setOpen(true);
          router.push(path);
        },
        getTenantId: () => (tenantId != null ? Number(tenantId) : null),
        focusDomains: focusKey ? focusKey.split(',') : [],
      }),
    [router, tenantId, focusKey, setOpen, excludeKey],
  );

  useRegisterBrainActions(actions);
  return null;
}
