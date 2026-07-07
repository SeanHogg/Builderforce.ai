/**
 * managerIdentity — resolve the DESIGNATED manager as a real identity.
 *
 * A project can name a specific cloud agent as its manager (`manager_ref = 'c:<id>'`).
 * Historically the manager pass always ran "as the system service": its LLM
 * judgement (business-value scoring) used the free pool with no persona and no
 * agent-specific model, so the designation was cosmetic. This resolver closes that
 * gap — it loads the designated agent's PERSONA (psychometric profile → prompt
 * directives) and its pinned MODEL (`base_model`), so a manager the tenant configured
 * to be, say, risk-averse and methodical actually scores the backlog that way, and
 * runs on the model the tenant chose for it. The result is threaded into
 * {@link scoreBusinessValueAI} and journalled so the manager feed shows WHO acted.
 *
 * System / human managers resolve to an empty identity (no persona, free pool) — the
 * behaviour is unchanged for them.
 */
import { and, eq } from 'drizzle-orm';
import { buildPsychometricBlock } from '@builderforce/agent-tools';
import type { Db } from '../../infrastructure/database/connection';
import { ideAgents } from '../../infrastructure/database/schema';
import type { EffectiveManagerPolicy } from './managerPolicy';

export interface ManagerIdentity {
  /** ide_agents.id when a cloud agent is the manager; null for system/human. */
  agentRef: string | null;
  /** Display name for journalling (agent name, or 'the system manager'). */
  label: string;
  /** The agent's pinned model (base_model), or null to use the free pool. */
  model: string | null;
  /** A persona system-prompt block compiled from the agent's psychometric profile;
   *  null when the agent has no profile (or manager is system/human). */
  personaDirective: string | null;
}

/** The identity used when no specific agent is the manager (system default). */
export const SYSTEM_MANAGER_IDENTITY: ManagerIdentity = {
  agentRef: null, label: 'the system manager', model: null, personaDirective: null,
};

/** Parse a stored psychometric JSON string into the shape the shared compiler reads. */
function parseProfile(raw: string | null): { vector?: Record<string, number>; enneagramType?: number } | undefined {
  if (!raw) return undefined;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o && typeof o === 'object') return o as { vector?: Record<string, number>; enneagramType?: number };
  } catch { /* ignore */ }
  return undefined;
}

/**
 * Resolve the effective policy's `managerRef` into a concrete {@link ManagerIdentity}.
 * Only a cloud-agent designation (`c:<ide_agents.id>`) loads a persona/model; system
 * and human managers resolve to {@link SYSTEM_MANAGER_IDENTITY}.
 */
export async function resolveManagerIdentity(
  db: Db, tenantId: number, policy: EffectiveManagerPolicy,
): Promise<ManagerIdentity> {
  if (policy.managerKind !== 'agent') return SYSTEM_MANAGER_IDENTITY;
  const ref = policy.managerRef?.trim() ?? '';
  if (!ref.startsWith('c:')) return SYSTEM_MANAGER_IDENTITY; // host agents run on their own runtime
  const agentId = ref.slice(2).trim();
  if (!agentId) return SYSTEM_MANAGER_IDENTITY;
  try {
    const [row] = await db
      .select({ name: ideAgents.name, baseModel: ideAgents.baseModel, psychometric: ideAgents.psychometric })
      .from(ideAgents)
      .where(and(eq(ideAgents.id, agentId), eq(ideAgents.tenantId, tenantId)))
      .limit(1);
    if (!row) return { ...SYSTEM_MANAGER_IDENTITY, agentRef: agentId };
    const profile = parseProfile(row.psychometric);
    const block = profile ? buildPsychometricBlock(profile as never) : '';
    return {
      agentRef: agentId,
      label: row.name?.trim() || `agent ${agentId}`,
      model: row.baseModel?.trim() || null,
      personaDirective: block.trim() ? block.trim() : null,
    };
  } catch {
    return { ...SYSTEM_MANAGER_IDENTITY, agentRef: agentId };
  }
}
