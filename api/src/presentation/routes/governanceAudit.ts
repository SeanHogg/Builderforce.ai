/**
 * The route-side half of the governance mutation-audit envelope: turn a request into the actor +
 * scope the envelope needs (`resolveActorFromContext`, `scope(c)`) and write it. Every governance
 * route that mutates — the generic tracker factory, the SOC 2 control patch, evidence attach, the
 * scan / DSR actions — calls this one function, so no route builds its own audit shape.
 */
import type { Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { resolveActorFromContext } from '../../application/activity/activityLog';
import { recordGovernanceMutation, type MutationAction } from '../../application/governance/mutationAudit';

export async function auditGovernanceMutation(
  c: Context<HonoEnv>,
  db: Db,
  entity: string,
  entityId: string | number | null,
  action: MutationAction,
  before: unknown,
  after: unknown,
): Promise<void> {
  const tenantId = c.get('tenantId');
  const segmentId = (c.get('segmentId') as string | undefined) ?? null;
  const actor = await resolveActorFromContext(c.env as Env, db, c);
  await recordGovernanceMutation(c.env as Env, db, { actor, tenantId, segmentId, entity, entityId, action, before, after });
}
