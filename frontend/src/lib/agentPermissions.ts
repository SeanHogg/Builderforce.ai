import type { PublishedAgent } from './types';

/**
 * A tenant-owned agent may be deleted only while it is unpublished AND has no
 * purchases (hire_count === 0) — never pull a published/purchased agent out from
 * under its buyers. Shared by every surface that offers delete (the /workforce
 * card grid and the agent slide-out) so the rule lives in one place. The backend
 * enforces the same guard; this just decides whether to show the control.
 */
export function canDeleteAgent(a: Pick<PublishedAgent, 'published' | 'hire_count'>): boolean {
  return !a.published && (a.hire_count ?? 0) === 0;
}

/**
 * Does the signed-in tenant OWN this agent? True when the agent's owner tenant
 * matches the current tenant. Single source of truth for the "show manage
 * actions vs. a Hire button" decision on every surface that lists agents
 * (marketplace grid/table + workforce directory). Agent rows carry the owner as
 * `tenant_id` (number); the auth tenant id is a string — compare numerically.
 */
export function isAgentOwner(
  a: Pick<PublishedAgent, 'tenant_id'>,
  tenantId: string | number | null | undefined
): boolean {
  if (a.tenant_id == null || tenantId == null || tenantId === '') return false;
  return Number(a.tenant_id) === Number(tenantId);
}
