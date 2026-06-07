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
