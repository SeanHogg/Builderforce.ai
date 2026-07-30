/**
 * managerChat — WHO answers when a person asks the AI Manager to account for the day,
 * and the conversation they answer in.
 *
 * ── WHY THIS IS A THIN RESOLVER AND NOT A NEW CHAT SYSTEM ────────────────────────
 * The question this exists to serve — "what did you and the team get done today, and
 * why not more?" — is a CONVERSATION, and the platform already has one: Brain chats,
 * with a transcript, members, agent participants, an addressed-agent reply loop that
 * runs a bounded tool turn, and a persisted trace of every tool it called. Growing a
 * second, manager-shaped Q&A log beside it would have duplicated all of that and then
 * diverged from it. So the manager chat IS a Brain chat (`origin='manager'`, one per
 * project, migration 0376) and the manager answers through the SAME `agentReply` path
 * any other agent teammate answers through.
 *
 * What is genuinely manager-specific is only this: WHICH agent speaks as the manager.
 *
 * ── THE DESIGNATION IS AUTHORITATIVE ─────────────────────────────────────────────
 * A project can designate its manager (`project_manager_configs.manager_ref`) as a
 * human (`u:`), a cloud agent (`c:`), an on-prem host (`h:`) or nothing at all (the
 * built-in service). Only a CLOUD agent can hold a conversation, so:
 *
 *   • designated cloud agent → it answers, in its own persona. The person who chose
 *     that agent to run the backlog is entitled to be answered by it.
 *   • anything else (human / host / the system service) → the built-in Manager agent
 *     (`ide_agents.builtin_kind='manager'`) answers. It is the service's face: the
 *     same machinery that ran the passes, given a voice.
 *
 * A human designation deliberately does NOT silence the chat. The backlog work is still
 * being done by the manager service on that project's behalf, and its record — the
 * digest, the decisions, the census, the policy — is exactly what someone asking "why
 * did nothing move?" needs. Refusing to answer because a person's name is in the
 * designation field would withhold the account from the one case where a human is
 * already accountable for it.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ideAgents } from '../../infrastructure/database/schema';
import { getEffectiveManagerPolicy } from './ManagerService';
import { provisionBuiltinAgents } from '../agent/provisionBuiltinAgents';

/** `ide_agents.builtin_kind` of the seeded Manager agent (0376). */
export const MANAGER_BUILTIN_KIND = 'manager';

/** The agent that speaks as the manager on a project. */
export interface ManagerVoice {
  /** `ide_agents.id` — what `agentReply` addresses. */
  agentRef: string;
  name: string;
  /** True when this is the project's DESIGNATED manager rather than the built-in one. */
  designated: boolean;
}

/** Look up a tenant's built-in Manager agent row, if it has been provisioned. */
async function findBuiltinManager(db: Db, tenantId: number): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: ideAgents.id, name: ideAgents.name })
    .from(ideAgents)
    .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.builtinKind, MANAGER_BUILTIN_KIND)))
    .limit(1);
  return row ?? null;
}

/** Look up a designated cloud agent, confirming it belongs to this tenant. */
async function findTenantAgent(db: Db, tenantId: number, agentRef: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: ideAgents.id, name: ideAgents.name })
    .from(ideAgents)
    .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.id, agentRef)))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve who answers as the manager on this project.
 *
 * Falls back through: the designated cloud agent → the built-in Manager agent →
 * provisioning the built-in agent on the spot. That last hop matters: the seed is
 * backfilled by migration 0376 and created for new tenants by `provisionBuiltinAgents`,
 * but a tenant created between the two, or one whose row was deleted, would otherwise
 * have a Manager page whose chat could never answer. Provisioning is idempotent, so
 * self-healing here costs one NOT-EXISTS check on the miss path only.
 */
export async function resolveManagerVoice(
  env: Env,
  db: Db,
  args: { tenantId: number; projectId: number },
): Promise<ManagerVoice | null> {
  const policy = await getEffectiveManagerPolicy(db, args.tenantId, args.projectId, env).catch(() => null);
  const ref = policy?.managerRef?.trim() ?? '';
  if (ref.startsWith('c:')) {
    const designated = await findTenantAgent(db, args.tenantId, ref.slice(2).trim()).catch(() => null);
    if (designated) return { agentRef: designated.id, name: designated.name, designated: true };
    // A designation pointing at an agent that no longer exists is a stale row, not a
    // reason to go silent — fall through to the built-in voice.
  }

  let builtin = await findBuiltinManager(db, args.tenantId).catch(() => null);
  if (!builtin) {
    await provisionBuiltinAgents(db, args.tenantId).catch(() => undefined);
    builtin = await findBuiltinManager(db, args.tenantId).catch(() => null);
  }
  return builtin ? { agentRef: builtin.id, name: builtin.name, designated: false } : null;
}
