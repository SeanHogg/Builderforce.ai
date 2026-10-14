/**
 * The pickers a fix's actions need (PRD 33 §5.1.4): which `sequence` a Follow up may
 * enrol into, and which coding agent may take a Fix it task. Read from the same rows
 * the actions themselves accept (`prescriptionFollowUp.loadSequence` — a `sequence`
 * canvas object of this workspace; `prescriptionActions.agentOf` — an active agent of
 * this workspace), so a picked value is always one the action takes. Cached briefly:
 * both change outside Insights.
 */

import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { ReplayCodingAgentChoiceDto, ReplaySequenceChoiceDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { creationSessionObjects, creationSessions, ideAgents } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { asJsonRecord } from '../../domain/shared/json';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { replayReadKeys } from './replayCacheKeys';
import { getSiteForTenant } from './replaySites';

const CHOICES_MAX = 100;
const TTL = { kvTtlSeconds: 60, l1TtlMs: 15_000 };

/** A sequence's display name from its content (`name`, else `title`). */
export function sequenceName(content: unknown): string {
  const c = asJsonRecord(content);
  const name = typeof c.name === 'string' && c.name.trim() ? c.name : typeof c.title === 'string' ? c.title : '';
  return name.trim().slice(0, 200) || 'Sequence';
}

export async function listSequenceChoices(env: Env, db: Db, scope: ReplayScope): Promise<ReplaySequenceChoiceDto[]> {
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.choices('sequences'), async () => {
    const rows = await db
      .select({ id: creationSessionObjects.id, content: creationSessionObjects.content })
      .from(creationSessionObjects)
      .innerJoin(creationSessions, eq(creationSessions.id, creationSessionObjects.sessionId))
      .where(scopedToTenant(creationSessions, scope.tenantId, eq(creationSessionObjects.kind, 'sequence'), sql`${creationSessions.status} <> 'deleted'`))
      .orderBy(desc(creationSessionObjects.updatedAt))
      .limit(CHOICES_MAX);
    return rows.map((r) => ({ id: r.id, name: sequenceName(r.content) }));
  }, TTL);
}

/**
 * Active agents of the workspace that can run in the cloud, workspace-wide or on the
 * site's project. Empty for an external site: Fix it dispatches only for a hosted app.
 */
export async function listCodingAgentChoices(env: Env, db: Db, scope: ReplayScope): Promise<ReplayCodingAgentChoiceDto[]> {
  const site = await getSiteForTenant(env, db, scope.tenantId, scope.siteId);
  if (site.kind !== 'hosted' || site.projectId === null) return [];
  const projectId = site.projectId;
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.choices('coding-agents'), async () => {
    const rows = await db
      .select({ ref: ideAgents.id, name: ideAgents.name })
      .from(ideAgents)
      .where(scopedToTenant(ideAgents, scope.tenantId, and(
        eq(ideAgents.status, 'active'),
        ne(ideAgents.runtimeSupport, 'local'),
        or(isNull(ideAgents.projectId), eq(ideAgents.projectId, projectId)),
      )))
      .orderBy(ideAgents.name)
      .limit(CHOICES_MAX);
    return rows.map((r) => ({ ref: r.ref, name: r.name }));
  }, TTL);
}
