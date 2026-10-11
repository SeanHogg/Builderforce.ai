/**
 * agentPersonaBrief — "who is Ada?", answered once, for a delegation to run AS her.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────
 * Operator decision (2026-09-15): when the Brain does work locally instead of dispatching
 * it, the sub-agents it spawns should be the workspace's OWN agents — their role, bio,
 * skills and personality — rather than anonymous helpers running the surface's generic
 * instructions. A delegation to "Ada" that produced a nameless reader was the same work
 * done worse: the reason to have a data engineer on the team is that she reads a migration
 * differently from a generalist.
 *
 * ── ONE COMPILER, NOT A SECOND COPY ─────────────────────────────────────────────
 * `agentPrompt.ts` already turns an agent row into a persona prompt — the same lowering
 * (`buildAgentSystemPrompt` over `lowerAgentSpec`) that the dedicated chat endpoint, the
 * validate call and the OpenAI-standard gateway all use, including the compiled
 * psychometric directives. This module adds a RESOLVER (a ref may be an id or a name) and
 * nothing else; the brief itself is that compiler's output verbatim. Writing a second,
 * "simpler" persona string here is exactly how a workspace ends up with two Adas who
 * disagree.
 *
 * ── REFS ARE WHAT THE MODEL HAS ─────────────────────────────────────────────────
 * The parent model is asking for a teammate it saw in a chat roster or a list, so it has a
 * NAME far more often than an `ide_agents.id`. Resolving only ids would make the feature
 * unreachable from the surface that motivates it. Both spellings go through one
 * tenant-scoped query; the name match is case-insensitive and exact (a fuzzy match would
 * silently hand the work to the wrong teammate, which is worse than a refusal the parent
 * can read and retry).
 */
import { and, eq, sql as dsql } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { ideAgents } from '../../infrastructure/database/schema';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { buildAgentSystemPrompt, loadWorkforceAgentBase } from './agentPrompt';
import { agentRoleKeys, type RoleCapableAgentRow } from '../kanban/roleCapability';

/** What a delegation needs to run as an agent: who it is, and how it thinks. */
export interface AgentPersonaBrief {
  /** The resolved `ide_agents.id` — what the RESULT reports, so the parent learns which
   *  agent its guess actually named. */
  agentRef: string;
  name: string;
  title: string | null;
  /** The board role keys this agent can act as (`agentRoleKeys`: explicit ∪ built-in kind
   *  ∪ title/skill match) — what tells a Developer from a QA when a slice is delegated. */
  roleKeys: string[];
  /** The compiled persona system prompt (role, bio, skills, personality directives). */
  brief: string;
}

/**
 * Resolve `agent` (an id OR a case-insensitive exact name) to that tenant's agent row —
 * the id plus the fields role capability reads.
 *
 * ONE query for both spellings rather than "try the id, then try the name": two reads to
 * answer one question, and the miss path — the one a wrong guess always takes — would pay
 * for both. Read-through cached like the agent base it feeds, because a delegation loop
 * asks this on every spawn and the roster changes rarely.
 */
async function resolveAgentRow(env: Env, tenantId: number, agent: string): Promise<RoleCapableAgentRow | null> {
  const ref = agent.trim();
  if (!ref) return null;
  return getOrSetCached(
    env,
    // Lower-cased in the KEY as well as the query: "Ada" and "ada" are the same lookup,
    // and caching them separately would double the keyspace for one agent.
    `agent_persona:resolve:v2:${tenantId}:${ref.toLowerCase()}`,
    async (): Promise<RoleCapableAgentRow | null> => {
      const [row] = await buildDatabase(env)
        .select(ROLE_ROW_COLUMNS)
        .from(ideAgents)
        .where(and(
          eq(ideAgents.tenantId, tenantId),
          dsql`(${ideAgents.id} = ${ref} OR lower(${ideAgents.name}) = lower(${ref}))`,
        ))
        .limit(1);
      return row ?? null;
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}

/** The columns role capability reads, selected the same way by both queries here. */
const ROLE_ROW_COLUMNS = {
  id: ideAgents.id,
  name: ideAgents.name,
  title: ideAgents.title,
  skills: ideAgents.skills,
  builtinKind: ideAgents.builtinKind,
  roleKeys: ideAgents.roleKeys,
};

/**
 * The persona brief for one of this workspace's agents, or null when no agent in the
 * tenant carries that id or name.
 *
 * Null rather than a throw: a delegation naming an agent that does not exist is
 * INFORMATION for the parent model ("there is no Kevin here; these are the agents there
 * are"), and the callers turn it into exactly that. A throw would end a parent's turn over
 * a guess it can trivially correct.
 */
export async function resolveAgentPersonaBrief(
  env: Env,
  tenantId: number,
  agent: string,
): Promise<AgentPersonaBrief | null> {
  const row = await resolveAgentRow(env, tenantId, agent);
  if (!row) return null;
  const agentRef = row.id;

  const base = await loadWorkforceAgentBase(env, tenantId, agentRef);
  if (!base) return null;

  return {
    agentRef,
    name: base.descriptor.name,
    title: base.descriptor.title || null,
    roleKeys: [...agentRoleKeys(row)],
    // The SAME lowering every other surface runs this agent on — persona directives and
    // compiled personality included.
    brief: buildAgentSystemPrompt(base.descriptor),
  };
}

/**
 * The tenant's agent names, for the refusal path.
 *
 * A model told "no agent named Kevin" retries with another guess; told which agents exist,
 * it picks one. Bounded at 20 because the point is to make the next call correct, not to
 * enumerate a roster.
 */
export async function listTenantAgentNames(env: Env, tenantId: number, limit = 20): Promise<string[]> {
  const rows = await buildDatabase(env)
    .select({ name: ideAgents.name })
    .from(ideAgents)
    .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.status, 'active')))
    .limit(limit);
  return rows.map((r) => r.name).filter((n): n is string => !!n);
}

/**
 * The tenant's active agents that can act as `roleKey` — the refusal path when a slice was
 * handed to an agent without that role ("Ada is not a developer; these are").
 *
 * Read-through cached: a delegation loop that picks the wrong teammate asks this once per
 * wrong guess, and the roster changes rarely. Keyed on the tenant's agent-roster VERSION,
 * so an agent created or re-roled through `cloud_agents.create/update` is listed on the
 * very next read — a run that just hired a Developer must be able to find them.
 */
export async function listTenantAgentsForRole(env: Env, tenantId: number, roleKey: string, limit = 20): Promise<string[]> {
  const key = roleKey.trim();
  if (!key) return [];
  const ver = await getCacheVersion(env, agentRosterVersionKey(tenantId));
  return getOrSetCached(
    env,
    `agent_persona:role:${tenantId}:v${ver}:${key}:${limit}`,
    async (): Promise<string[]> => {
      const rows = await buildDatabase(env)
        .select(ROLE_ROW_COLUMNS)
        .from(ideAgents)
        .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.status, 'active')))
        .limit(200);
      return rows.filter((r) => agentRoleKeys(r).has(key)).map((r) => r.name).filter(Boolean).slice(0, limit);
    },
    { kvTtlSeconds: 300, l1TtlMs: 60_000 },
  );
}

/** Version token for the tenant's agent roster as role lookups read it. */
export const agentRosterVersionKey = (tenantId: number): string => `agent_roster:v:${tenantId}`;

/** An agent was created or its roles changed: role lookups must re-read the roster. */
export async function bumpAgentRosterVersion(env: Env, tenantId: number): Promise<void> {
  await bumpCacheVersion(env, agentRosterVersionKey(tenantId));
}
