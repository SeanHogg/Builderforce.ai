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
import { neon } from '@neondatabase/serverless';
import { provisionJobSeeker } from '../integrations/hiredVideo';
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
  const sql = neon(env.NEON_DATABASE_URL);
  await sql`
    INSERT INTO freelancer_profiles
      (user_id, hired_video_user_id, hired_video_connection_id, hired_video_claim_url, hired_video_resume_id)
    VALUES
      (${user.id}, ${prov.hiredVideoUserId ?? null}, ${prov.connectionId ?? null}, ${prov.claimUrl ?? null}, ${prov.resumeId ?? null})
    ON CONFLICT (user_id) DO NOTHING
  `;
}
