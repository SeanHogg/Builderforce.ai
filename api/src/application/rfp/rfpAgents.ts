/**
 * Built-in agent lookup (PRD 15) — generalises the validator's `findTenantValidatorRef`
 * into a kind-agnostic helper so any caller can resolve a tenant's built-in agent (CTO,
 * Product Owner, Validator, …) by its stable `builtin_kind` marker. DRY: one lookup, not
 * a per-kind copy.
 */
import { and, eq } from 'drizzle-orm';
import { ideAgents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

export interface BuiltinAgentRef {
  id: string;
  name: string;
  bio: string | null;
  skills: string[];
}

function parseSkills(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Resolve a tenant's active built-in agent of the given kind, or null. */
export async function findBuiltinAgentRef(
  db: Db,
  tenantId: number,
  kind: string,
): Promise<BuiltinAgentRef | null> {
  const [row] = await db
    .select({ id: ideAgents.id, name: ideAgents.name, bio: ideAgents.bio, skills: ideAgents.skills })
    .from(ideAgents)
    .where(and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.builtinKind, kind), eq(ideAgents.status, 'active')))
    .limit(1);
  if (!row) return null;
  return { id: row.id, name: row.name, bio: row.bio ?? null, skills: parseSkills(row.skills) };
}

/** Compose a persona directive from a built-in agent's bio + skills, for steering an
 *  `ideProxy` analysis call "as" that agent (mirrors businessValueAI's personaDirective). */
export function personaDirectiveFor(agent: BuiltinAgentRef | null): string | null {
  if (!agent) return null;
  const skills = agent.skills.length ? ` Skills: ${agent.skills.join(', ')}.` : '';
  return `${agent.name}${agent.bio ? ` — ${agent.bio}` : ''}${skills}`;
}
