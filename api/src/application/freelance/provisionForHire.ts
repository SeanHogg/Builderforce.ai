/**
 * Shared "make this user for-hire" provisioning.
 *
 * Gives a user a for-hire profile stub — a private, unpublished profile row plus a
 * hired.video job-seeker provisioning (native résumé path when the partner SDK isn't
 * configured). Idempotent (ON CONFLICT DO NOTHING). ONE implementation shared by:
 *   - the password-register + post-OAuth role chooser (a fresh 'freelancer' account), and
 *   - an EXISTING 'standard' builder opting in to being hired (POST /freelancers/me/availability),
 * so the row shape never drifts between the two entry points.
 */
import { provisionJobSeeker } from '../integrations/hiredVideo';
import { buildDatabase } from '../../infrastructure/database/connection';
import { freelancerProfiles } from '../../infrastructure/database/schema';
import type { Env } from '../../env';

export async function provisionForHireProfile(
  env: Env,
  user: { id: string; email: string; name?: string | null },
): Promise<void> {
  const prov = await provisionJobSeeker(env, {
    email: user.email,
    name: user.name ?? undefined,
    externalUserId: user.id,
  });
  const db = buildDatabase(env);
  await db
    .insert(freelancerProfiles)
    .values({
      userId: user.id,
      hiredVideoUserId: prov.hiredVideoUserId ?? null,
      hiredVideoConnectionId: prov.connectionId ?? null,
      hiredVideoClaimUrl: prov.claimUrl ?? null,
      hiredVideoResumeId: prov.resumeId ?? null,
    })
    .onConflictDoNothing({ target: freelancerProfiles.userId });
}
