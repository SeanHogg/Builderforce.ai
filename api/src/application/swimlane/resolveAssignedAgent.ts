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
 *   registered → `agent_registrations` row (endpoint-based; dispatched as a cloud
 *                runtime). agentRef is its uuid, or a legacy numeric `agents.id`
 *                (the dead `agents` table was folded in via `legacy_agent_id`)
 *   workforce  → `ide_agents` row: runtime_support/preferred_runtime → runtime,
 *                base_model → model (unless overridden)
 *
 * A WORKFORCE AGENT IS RESOLVABLE IF THE WORKSPACE OWNS IT **OR HIRED IT**. The
 * lookup used to require `ide_agents.tenant_id = tenantId`, which is never true
 * of a marketplace agent: its row belongs to the seller. So an agent a workspace
 * had paid for could be shown, hired and counted, and then failed to assign with
 * `Agent not found in registry` — the money moved and the agent could not be
 * given work. The hire in `agent_purchases` (`unhired_at IS NULL`) is the second
 * half of the predicate, and it is checked HERE at assign time rather than at
 * dispatch time so a released agent cannot be freshly assigned while the
 * assignments already compiled keep the fields they resolved to.
 */
import { and, eq, sql } from 'drizzle-orm';
import { agentRegistrations } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { LaneAgentRuntime } from './laneAutoRun';

export type AgentKind = 'workforce' | 'registered';

export interface ResolvedAgent {
  /** Persona/role string the dispatch carries (the agent's name). */
  role: string;
  /** Display name of the chosen agent. */
  name: string;
  /** Runtime tier the agent runs on. */
  runtime: LaneAgentRuntime;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres `integer` (int4). Digit strings outside this overflow the bind. */
const INT4_MAX = 2_147_483_647;

function parseInt4Id(ref: string): number | null {
  if (!/^\d+$/.test(ref)) return null;
  const n = Number(ref);
  if (!Number.isInteger(n) || n < 1 || n > INT4_MAX) return null;
  return n;
}

/** The base_model sentinel that means "no explicit model — use tenant default". */
const DEFAULT_MODEL_SENTINEL = 'builderforce-default';

/**
 * Map a workforce agent's runtime_support / preferred_runtime to an assignment
 * runtime tier. 'host' runs on a agentHost (a `remote` dispatch); 'cloud' stays
 * cloud; 'both' honours preferred_runtime (defaulting to cloud).
 */
function workforceRuntime(runtimeSupport: string | null, preferred: string | null): LaneAgentRuntime {
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
    const ref = opts.agentRef;
    const legacyId = parseInt4Id(ref);
    const key = UUID_RE.test(ref)
      ? eq(agentRegistrations.id, ref)
      : legacyId != null ? eq(agentRegistrations.legacyAgentId, legacyId) : null;
    const [row] = key
      ? await db.select({ name: agentRegistrations.name }).from(agentRegistrations)
          .where(and(key, eq(agentRegistrations.tenantId, tenantId))).limit(1)
      : [];
    if (!row) throw new AssignedAgentNotFoundError('registered', opts.agentRef);
    return { role: row.name, name: row.name, runtime: 'cloud', target: null, model: override };
  }

  // workforce: ide_agents is a raw-SQL table (not in the Drizzle schema).
  // OWNED (tenant_id = caller) OR ACTIVELY HIRED (an agent_purchases row this
  // workspace still holds). The EXISTS is a semi-join on the unique index
  // (tenant_id, agent_id), so it costs an index probe, not a scan; `status` is
  // checked on the hired branch because a seller may have retired the agent
  // since the hire, and dispatching a retired agent is a run that cannot start.
  const result = await db.execute(sql`
    SELECT name, base_model, runtime_support, preferred_runtime
    FROM ide_agents a
    WHERE a.id = ${opts.agentRef}
      AND (
        a.tenant_id = ${tenantId}
        OR (a.status = 'active' AND EXISTS (
          SELECT 1 FROM agent_purchases p
          WHERE p.agent_id = a.id AND p.tenant_id = ${tenantId} AND p.unhired_at IS NULL
        ))
      )
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
