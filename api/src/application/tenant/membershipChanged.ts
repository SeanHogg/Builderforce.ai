/**
 * THE membership mutation hook.
 *
 * `tenant_members` is written from several shapes that cannot sensibly be one
 * statement — the aggregate's replace-all in `TenantRepository`, an admin role
 * change, a demote/remove, the demo seeder, an invitation that auto-accepts. What
 * they DO share is the consequence: three independent caches are now stale, and
 * every one of them was left to expire on its own timer.
 *
 * Two files say so in their own comments. `keyResolutionCache.ts`: *"tenant_members
 * rows are mutated from many scattered sites … There is no single membership-change
 * hook to invalidate from, so this path self-heals via a short TTL instead."*
 * `llmRoutes.ts`: *"tenant_members has no single mutation hook; a removed/demoted
 * member keeps cached access for at most that window."* And the footer roster read
 * the same fact a third way — a person who joined a workspace did not appear beside
 * their team for up to 120 seconds.
 *
 * This is that hook. It is the CONSEQUENCE that is shared, so this is what is
 * extracted: one call at the end of every membership write, naming every cache the
 * fact reaches. A new consumer of "who is in this tenant" adds its invalidation
 * HERE, once, instead of discovering months later that it had been serving a stale
 * answer — which is exactly how the three above happened.
 *
 * Best-effort by construction: a cache that cannot be cleared must not fail the
 * write that already committed. The short TTLs remain the floor beneath this, not
 * the mechanism.
 */
import { invalidateJwtMembershipCache } from '../../infrastructure/auth/keyResolutionCache';
import { invalidateTeamCaches } from '../kernel/TeamRoster';
import type { Env } from '../../env';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { bumpInboxes } from '../messaging/dmThreadsCache';
import { invalidateMyWorkspaces, invalidateTenantSnapshot } from './tenantReadCache';

/**
 * What the change did to access. `revoke` = remove / deactivate / demote / role change /
 * workspace delete (access may have SHRUNK, so a stale cached entry is a security hole and its
 * invalidation is strict). `grant` = add / create / reactivate / upgrade (access only grew).
 */
export type MembershipChange = 'grant' | 'revoke';

/**
 * Announce that a tenant's membership changed.
 *
 * @param userIds the members affected. A role change or a removal knows exactly
 *   who; a replace-all does not, and passing none simply leaves that member's
 *   short-TTL auth entry to expire on its own.
 * @param change see {@link MembershipChange}.
 */
export async function membershipChanged(
  env: Env,
  tenantId: number,
  userIds: readonly string[],
  change: MembershipChange,
): Promise<void> {
  // The JWT membership entry decides whether this person still has access, and is served as
  // last-known-good through a database outage. For a `revoke` its delete is STRICT: a failure is
  // raised (after the best-effort clears below have still run) instead of leaving a removed
  // member with access for days. A `grant` only ever under-grants while stale, so it reports.
  const [accessFailure] = await Promise.all([
    Promise.all(userIds.map((userId) => invalidateJwtMembershipCache(env, tenantId, userId, change)))
      .then(() => undefined, (error: unknown) => ({ error })),
    Promise.all([
      // The footer roster (PRD 21 §4.1) and the assignable-workforce union the
      // pickers read — two projections of one fact, cleared together.
      invalidateTeamCaches(env, tenantId),
      // The snapshot lists every member; the affected people's workspace lists carry their role.
      invalidateTenantSnapshot(env, tenantId),
      invalidateMyWorkspaces(env, userIds),
      // A DM inbox shows only people the viewer may reach, which membership decides.
      bumpInboxes(env, userIds),
    ]).catch((error: unknown) => {
      reportCaughtError(error, { source: 'application/tenant/membershipChanged.ts', operation: 'membershipChanged', context: { tenantId } });
    }),
  ]);
  if (accessFailure) throw accessFailure.error;
}
