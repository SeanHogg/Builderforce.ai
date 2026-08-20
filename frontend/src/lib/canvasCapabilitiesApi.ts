import { useEffect, useState } from 'react';
import { apiRequest } from './apiClient';

/**
 * The CANVAS CAPABILITIES this caller holds — resolved by the server, never guessed here.
 *
 * ── WHY THE BROWSER DOES NOT DECIDE ──────────────────────────────────────────────
 * Entitlement is one question with one evaluator (`planFeatures` + `featureGate`, per
 * [[paid-plan-feature-gate]]), and a second copy in the browser would be a place for the
 * rule to drift — the palette would show a card the server then refuses, or hide one it
 * would have allowed. So this fetches the ANSWER, not the inputs: no plan, no override
 * flag, no superadmin bit crosses the wire, only the capability ids that survived.
 *
 * ── AND WHY THE DEFAULT IS `null`, NOT AN EMPTY SET ─────────────────────────────
 * An empty set is a STATEMENT — "asked, and entitled to nothing" — and the palette locks
 * on it. `null` is the absence of an answer, and the palette locks nothing. The three
 * cases that produce it are all absences: a guest board with no workspace, the first
 * render before the fetch lands, and a fetch that failed. Treating any of them as "none"
 * would grey out a card somebody is paying for on a network blip, which is a worse
 * failure than an unlocked palette row — the API refuses on its own regardless.
 */
export interface CanvasCapabilitiesResponse { capabilities: string[] }

export function getCanvasCapabilities(tenantId: string | number): Promise<CanvasCapabilitiesResponse> {
  return apiRequest(`/api/tenants/${tenantId}/canvas-capabilities`);
}

/**
 * The capability set for the current workspace, or `null` when it is not KNOWN.
 *
 * ── UNKNOWN IS NOT NONE ─────────────────────────────────────────────────────────
 * `null` while loading, on a guest board with no workspace to be entitled through, and on
 * a failed read. The palette treats it as "lock nothing", which is deliberate in all
 * three cases: a loading state is not a refusal, a guest has no plan to have been sold,
 * and a network blip that greyed out a card somebody is paying for is a worse failure
 * than an unlocked palette entry — the API refuses on its own regardless of what the
 * palette drew, so this list is discovery, never the boundary.
 *
 * The `tenantId` is the dependency: switching workspace re-asks, because entitlement
 * belongs to the workspace and not to the person.
 */
export function useCanvasCapabilities(tenantId: string | number | null | undefined): ReadonlySet<string> | null {
  const [capabilities, setCapabilities] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    if (tenantId == null || tenantId === '') { setCapabilities(null); return; }
    let cancelled = false;
    getCanvasCapabilities(tenantId)
      .then((response) => { if (!cancelled) setCapabilities(new Set(response.capabilities ?? [])); })
      .catch(() => { if (!cancelled) setCapabilities(null); });
    return () => { cancelled = true; };
  }, [tenantId]);

  return capabilities;
}
