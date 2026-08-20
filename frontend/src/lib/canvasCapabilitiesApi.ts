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
 * ── AND WHY THE DEFAULT IS EMPTY ─────────────────────────────────────────────────
 * A guest board has no tenant and a first render has no answer yet. Both resolve to the
 * empty set, which hides the entitled kinds until the real answer lands. Defaulting the
 * other way would flash a card a person cannot place — and, worse, would make a failed
 * fetch look like a granted entitlement.
 */
export interface CanvasCapabilitiesResponse { capabilities: string[] }

export function getCanvasCapabilities(tenantId: string | number): Promise<CanvasCapabilitiesResponse> {
  return apiRequest(`/api/tenants/${tenantId}/canvas-capabilities`);
}

/**
 * The capability set for the current workspace, as a `Set` the palette filters by.
 *
 * Returns a stable empty set while loading, when signed out, and on failure. The
 * `tenantId` is the dependency: switching workspace re-asks, because entitlement belongs
 * to the workspace and not to the person.
 */
export function useCanvasCapabilities(tenantId: string | number | null | undefined): ReadonlySet<string> {
  const [capabilities, setCapabilities] = useState<ReadonlySet<string>>(EMPTY);

  useEffect(() => {
    if (tenantId == null || tenantId === '') { setCapabilities(EMPTY); return; }
    let cancelled = false;
    getCanvasCapabilities(tenantId)
      .then((response) => { if (!cancelled) setCapabilities(new Set(response.capabilities ?? [])); })
      // A failed read is NOT an entitlement. Falling back to the empty set means the
      // worst a network problem can do is hide a card, never unlock one.
      .catch(() => { if (!cancelled) setCapabilities(EMPTY); });
    return () => { cancelled = true; };
  }, [tenantId]);

  return capabilities;
}

/** One frozen instance, so a loading or signed-out render allocates nothing and does not
 *  re-render every consumer by handing them a new empty set each time. */
const EMPTY: ReadonlySet<string> = Object.freeze(new Set<string>()) as ReadonlySet<string>;
