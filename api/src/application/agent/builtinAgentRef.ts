/**
 * Built-in agent lookup — resolve a tenant's active built-in agent (CTO, Product Owner,
 * Validator, Incident Manager, Security, PR reconciler, …) by its stable `builtin_kind`
 * marker, which survives a rename. ONE lookup, not a per-kind copy: the incident,
 * security, validation, RFP and PR-reconciliation paths each used to carry their own.
 */
import { and, eq } from 'drizzle-orm';
import { ideAgents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import { parseJsonArray } from '../../domain/shared/json';

export interface BuiltinAgentRef {
  id: string;
  name: string;
  bio: string | null;
  skills: string[];
}

/** Skills arrive as a JSON array or an already-decoded one; every entry is coerced to text. */
const parseSkills = (raw: unknown): string[] => parseJsonArray<unknown>(raw).map(String);

const activeOfKind = (tenantId: number, kind: string) =>
  and(eq(ideAgents.tenantId, tenantId), eq(ideAgents.builtinKind, kind), eq(ideAgents.status, 'active'));

/** Resolve a tenant's active built-in agent of the given kind, or null. */
export async function findBuiltinAgentRef(
  db: Db,
  tenantId: number,
  kind: string,
): Promise<BuiltinAgentRef | null> {
  const [row] = await db
    .select({ id: ideAgents.id, name: ideAgents.name, bio: ideAgents.bio, skills: ideAgents.skills })
    .from(ideAgents)
    .where(activeOfKind(tenantId, kind))
    .limit(1);
  if (!row) return null;
  return { id: row.id, name: row.name, bio: row.bio ?? null, skills: parseSkills(row.skills) };
}

/** Just the id — for dispatchers that only assign work, so the row stays one column wide. */
export async function findBuiltinAgentId(db: Db, tenantId: number, kind: string): Promise<string | null> {
  const [row] = await db.select({ id: ideAgents.id }).from(ideAgents).where(activeOfKind(tenantId, kind)).limit(1);
  return row?.id ?? null;
}
