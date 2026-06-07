/**
 * resolveAssignedAgent — turn a chosen registry agent (agent_kind + agent_ref)
 * into the concrete dispatch fields a swimlane assignment stores.
 *
 * Resolution happens at ASSIGN time (POST .../agents), not at dispatch time, so
 * the runtime-agnostic dispatch pipeline (compileStage / SwimlaneCoordinator)
 * keeps reading the plain role/runtime/target/model columns unchanged. The
 * chosen agent already carries its own runtime/host/model defaults — the user
 * only optionally overrides the model.
 *
 *   registered → `agents` row (endpoint-based; dispatched as a cloud runtime)
 *   workforce  → `ide_agents` row: runtime_support/preferred_runtime → runtime,
 *                base_model → model (unless overridden)
 */
import { and, eq, sql } from 'drizzle-orm';
import { agents } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { AssignmentRuntime } from './compileStage';

export type AgentKind = 'workforce' | 'registered';

export interface ResolvedAgent {
  /** Persona/role string the dispatch carries (the agent's name). */
  role: string;
  /** Display name of the chosen agent. */
  name: string;
  /** Runtime tier the agent runs on. */
  runtime: AssignmentRuntime;
  /** Routing target (agentHost id) — null falls back to the tenant default. */
  target: string | null;
  /** LLM model — modelOverride wins, else the agent's default, else null. */
  model: string | null;
}

export class AssignedAgentNotFoundError extends Error {
  constructor(kind: AgentKind, ref: string) {
    super(`Agent not found in registry: ${kind}:${ref}`);
    this.name = 'AssignedAgentNotFoundError';
  }
}

/** The base_model sentinel that means "no explicit model — use tenant default". */
const DEFAULT_MODEL_SENTINEL = 'builderforce-default';

/**
 * Map a workforce agent's runtime_support / preferred_runtime to an assignment
 * runtime tier. 'host' runs on a agentHost (a `remote` dispatch); 'cloud' stays
 * cloud; 'both' honours preferred_runtime (defaulting to cloud).
 */
function workforceRuntime(runtimeSupport: string | null, preferred: string | null): AssignmentRuntime {
  const pick = runtimeSupport === 'both' ? (preferred ?? 'cloud') : (runtimeSupport ?? 'cloud');
  return pick === 'host' ? 'remote' : 'cloud';
}

export async function resolveAssignedAgent(
  db: Db,
  tenantId: number,
  opts: { agentKind: AgentKind; agentRef: string; modelOverride?: string | null },
): Promise<ResolvedAgent> {
  const override = opts.modelOverride?.trim() || null;

  if (opts.agentKind === 'registered') {
    const id = Number(opts.agentRef);
    const [row] = Number.isFinite(id)
      ? await db.select().from(agents).where(and(eq(agents.id, id), eq(agents.tenantId, tenantId)))
      : [];
    if (!row) throw new AssignedAgentNotFoundError('registered', opts.agentRef);
    return { role: row.name, name: row.name, runtime: 'cloud', target: null, model: override };
  }

  // workforce: ide_agents is a raw-SQL table (not in the Drizzle schema).
  const result = await db.execute(sql`
    SELECT name, base_model, runtime_support, preferred_runtime
    FROM ide_agents
    WHERE id = ${opts.agentRef} AND tenant_id = ${tenantId}
    LIMIT 1
  `);
  const row = (result.rows as Array<{
    name: string;
    base_model: string | null;
    runtime_support: string | null;
    preferred_runtime: string | null;
  }>)[0];
  if (!row) throw new AssignedAgentNotFoundError('workforce', opts.agentRef);

  const baseModel = row.base_model && row.base_model !== DEFAULT_MODEL_SENTINEL ? row.base_model : null;
  return {
    role: row.name,
    name: row.name,
    runtime: workforceRuntime(row.runtime_support, row.preferred_runtime),
    target: null,
    model: override ?? baseModel,
  };
}
