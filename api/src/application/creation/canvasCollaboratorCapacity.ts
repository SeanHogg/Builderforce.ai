/**
 * "May this board take one more collaborator?" — the plan cap that actually governs
 * canvas sharing (`maxCreationSessionCollaborators`).
 *
 * ── WHY IT IS ITS OWN MODULE ─────────────────────────────────────────────────────
 * There were nearly two definitions of it once already: the invite route enforced the
 * cap for somebody who had an account and enforced NOTHING for a cold email, so the
 * cap was whatever the invitee's signup status happened to be. Invite LINKS add a
 * THIRD way a person arrives on a board — they claim a link, with no address and no
 * prior invitation — and a link that let anybody in would make the cap decorative.
 * One function, three callers, so a plan limit cannot be enforced on the paths that
 * happen to have been written first.
 *
 * A pending invitation counts, exactly as a pending seat does: it is a promise of a
 * slot, and without counting it a Free board could queue twenty invites under a cap of
 * three and let them all land. An unredeemed LINK is deliberately NOT counted — it has
 * no holder yet, may be used by nobody, and is checked at the moment somebody actually
 * claims it, which is the only moment a person really arrives.
 *
 * Returns null when there is room, or the 403 body to answer with.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { listPending } from '../kernel/InvitationService';
import { resolveTenantEffectivePlan } from '../tenant/tenantPlanSnapshot';
import { getLimits } from '../../domain/tenant/PlanLimits';

export interface CollaboratorCapacityRefusal {
  error: string;
  code: 'CREATION_COLLABORATOR_QUOTA';
  usage: number;
  limit: number;
}

/** Who is arriving. `alreadyMember` — a re-invite, a role change, or a link claimed by
 *  somebody already on the board — consumes nothing, and neither does a repeat invite
 *  to an address that already holds a pending row for this board, which is why the
 *  address is excluded from the pending tally rather than counted against itself. */
export interface CollaboratorArrival {
  alreadyMember: boolean;
  email?: string;
}

export async function collaboratorCapacity(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    sessionId: string;
    /** The board's object-registry id, when it has one. Null = no invitations exist to tally. */
    objectId: string | null;
    /** `maxCreationSessionCollaborators` for the tenant's effective plan. -1 = unlimited. */
    limit: number;
    arrival: CollaboratorArrival;
  },
): Promise<CollaboratorCapacityRefusal | null> {
  if (input.arrival.alreadyMember) return null;
  if (input.limit === -1) return null;
  const [members, pending] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS count FROM creation_session_members WHERE session_id = ${input.sessionId}`)
      .then((result) => Number((result.rows[0] as { count?: number } | undefined)?.count ?? 0)),
    input.objectId
      ? listPending(db, env, input.tenantId, 'session').then((rows) => rows.filter((row) =>
        row.objectId === input.objectId && row.email !== (input.arrival.email ?? null)).length)
      : Promise.resolve(0),
  ]);
  const usage = members + pending;
  if (usage < input.limit) return null;
  return { error: 'Collaborator limit reached', code: 'CREATION_COLLABORATOR_QUOTA', usage, limit: input.limit };
}

/**
 * The cap itself, for a tenant. Read through the cached plan snapshot rather than a
 * fresh `tenants` SELECT per call — three callers now ask this on paths a person waits
 * on (mint, claim, invite), and the plan changes on a billing event, not on a click.
 */
export async function collaboratorLimitForTenant(
  env: Env | undefined, tenantId: number, db?: Db,
): Promise<number> {
  return getLimits(await resolveTenantEffectivePlan(env, tenantId, db)).maxCreationSessionCollaborators;
}
