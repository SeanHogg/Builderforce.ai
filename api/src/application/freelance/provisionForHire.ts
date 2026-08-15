/**
 * Shared "make this user for-hire" provisioning.
 *
 * Gives a user a for-hire profile stub — a private, unpublished profile row — plus the
 * personal workspace their own artefacts live in. Idempotent (ON CONFLICT DO NOTHING).
 * ONE implementation shared by:
 *   - the password-register + post-OAuth role chooser (a fresh 'freelancer' account), and
 *   - an EXISTING 'standard' builder opting in to being hired (POST /freelancers/me/availability),
 * so the row shape never drifts between the two entry points.
 *
 * ── WHAT CHANGED IN 0471 ─────────────────────────────────────────────────────────
 * This used to call out to hired.video and provision a job-seeker account there,
 * storing four vendor ids on the profile. It no longer calls anything: the résumé is a
 * Canvas object this platform owns. What a new for-hire account needs is therefore not
 * a remote account but a LOCAL workspace to hold one, which is what
 * `ensurePersonalWorkspace` provides. Nothing here can fail on a third party being down.
 */
import { ensurePersonalWorkspace } from '../tenant/starterWorkspace';
import { buildDatabase } from '../../infrastructure/database/connection';
import { freelancerProfiles } from '../../infrastructure/database/schema';
import type { Env } from '../../env';

export async function provisionForHireProfile(
  env: Env,
  user: { id: string; email: string; name?: string | null },
): Promise<void> {
  const db = buildDatabase(env);
  await db
    .insert(freelancerProfiles)
    .values({ userId: user.id })
    .onConflictDoNothing({ target: freelancerProfiles.userId });

  // Never throws — a provisioning failure must not fail the signup it rides on; the
  // next `/me` retries it. See `ensurePersonalWorkspace`.
  await ensurePersonalWorkspace(env, db, {
    id: user.id,
    email: user.email,
    displayName: user.name ?? null,
    accountType: 'freelancer',
  });
}
