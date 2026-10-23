/**
 * AgentAssignmentService — THE read/write path for the canonical agent-assignment model
 * (schema.agentAssignments). Every surface that needs to know "which agents are assigned
 * here" — project staffing, a workspace's agent identities, workflow, security, brain,
 * chat — goes through this, so the lookup, the side-effects of a write and the caching
 * live in ONE place rather than each surface re-querying.
 *
 * Since migration 1265 this is also where project staffing lives (`project_agents` was
 * folded in): a project attachment is `scope = 'project'`, an agent's workspace identity
 * `scope = 'workspace'`, and each row's integer `agentHandle` is what per-agent capability
 * assignments (`artifact_assignments.scope = 'agent'`) and per-agent schedules key on.
 *
 * CACHING. Reads go through the canonical read-through cache (L1 Map + L2 KV) under ONE
 * per-tenant version token ({@link agentAssignmentsVersionKey}); every write bumps it
 * (deduped per request through `bumpVersion`), so a single bump orphans every
 * (scope, target) variant without enumerating them.
 * Lane staffing (`scope = 'swimlane'`) is the exception: it is written by its own
 * writers through `application/swimlane/laneAgentAssignments.ts` and read there
 * uncached on every autonomy evaluation, so this service reads that scope uncached too
 * rather than serve a list those writers never invalidate.
 * Without an Env (no request scope — a test, a bare script) reads go straight to the DB.
 */
import { eq, inArray, isNull } from 'drizzle-orm';
import { agentAssignments, artifactAssignments, cronJobs } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { ambientEnv, bumpVersion, versionToken } from '../../infrastructure/cache/versionToken';
import { AssignmentScope as ArtifactScope } from '../../domain/shared/types';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  agentAssignmentsVersionKey,
  normaliseScopeId,
  projectIdForScope,
  toAssignment,
  type AgentAssignment,
  type AssignInput,
  type AssignmentScope,
} from './agentAssignmentModel';

export type { AgentAssignment, AssignInput, AssignmentScope, ExecutionScope } from './agentAssignmentModel';

/** Bump the tenant's assignment token — deduped within a request (KV allows one write
 *  per key per second; the first bump already orphaned every cached variant). */
export function bumpAgentAssignmentsVersion(env: Env | undefined, tenantId: number): Promise<void> {
  return bumpVersion(agentAssignmentsVersionKey(tenantId), 'bumpAgentAssignmentsVersion', env ?? ambientEnv());
}

/** The tenant's current assignment token — for caches DERIVED from assignments (run
 *  governance, agent manifests) to fold into their own keys. '0' without an Env. */
export async function agentAssignmentsVersion(env: Env | undefined, tenantId: number): Promise<string> {
  const target = env ?? ambientEnv();
  if (!target) return '0';
  return versionToken(target, agentAssignmentsVersionKey(tenantId));
}

/** What an unassign must be removing — a caller acting on ONE target (a chat, a project)
 *  names it, so an id smuggled in from another target is refused rather than deleted. */
export interface ExpectedTarget {
  scope: AssignmentScope | readonly AssignmentScope[];
  scopeId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `row` is the target the caller said it was acting on. */
export function matchesTarget(row: AgentAssignment, expected: ExpectedTarget): boolean {
  const scopes: readonly AssignmentScope[] = typeof expected.scope === 'string' ? [expected.scope] : expected.scope;
  if (!scopes.includes(row.scope)) return false;
  if (expected.scopeId === undefined) return true;
  return row.scopeId === normaliseScopeId(row.scope, expected.scopeId);
}

export class AgentAssignmentService {
  constructor(private readonly db: Db, private readonly env?: Env) {}

  private get cacheEnv(): Env | undefined {
    return this.env ?? ambientEnv();
  }

  private async cached<T>(tenantId: number, suffix: string, load: () => Promise<T>): Promise<T> {
    const env = this.cacheEnv;
    if (!env) return load();
    const version = await versionToken(env, agentAssignmentsVersionKey(tenantId));
    return getOrSetCached(env, `agent-assign:${tenantId}:${version}:${suffix}`, load);
  }

  private bump(tenantId: number): Promise<void> {
    return bumpAgentAssignmentsVersion(this.cacheEnv, tenantId);
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  /** Assignments for a scope (and optional target). Cached under the tenant token
   *  (lane staffing excepted — see the module note). */
  async list(tenantId: number, scope: AssignmentScope, scopeId?: string | null): Promise<AgentAssignment[]> {
    const target = scopeId == null ? null : normaliseScopeId(scope, scopeId);
    const load = async () => {
      const rows = await this.db
        .select()
        .from(agentAssignments)
        .where(scopedToTenant(agentAssignments, tenantId,
          eq(agentAssignments.scope, scope),
          target != null ? eq(agentAssignments.scopeId, target) : undefined));
      return rows.map(toAssignment);
    };
    if (scope === 'swimlane') return load();
    return this.cached(tenantId, `${scope}:${target ?? '_'}`, load);
  }

  /** The agents staffed on a project. */
  listForProject(tenantId: number, projectId: number): Promise<AgentAssignment[]> {
    return this.list(tenantId, 'project', String(projectId));
  }

  /** Every workspace identity of the tenant (one row per agent the workspace holds). */
  workspaceIdentities(tenantId: number): Promise<AgentAssignment[]> {
    return this.list(tenantId, 'workspace');
  }

  /**
   * `agentRef → agentHandle` of the workspace identities for one agent kind, optionally
   * narrowed to `refs`. The handle is the `scope_id` of that agent's
   * `artifact_assignments.scope = 'agent'` rows.
   */
  async identityHandles(tenantId: number, agentKind: string, refs?: readonly string[]): Promise<Map<string, number>> {
    const wanted = refs ? new Set(refs) : null;
    const out = new Map<string, number>();
    for (const row of await this.workspaceIdentities(tenantId)) {
      if (row.agentKind !== agentKind || (wanted && !wanted.has(row.agentRef))) continue;
      if (!out.has(row.agentRef)) out.set(row.agentRef, row.agentHandle);
    }
    return out;
  }

  /** One assignment by its uuid, or by its integer handle (a legacy project-agents id). */
  async find(tenantId: number, idOrHandle: string): Promise<AgentAssignment | null> {
    const byHandle = /^\d{1,9}$/.test(idOrHandle);
    // A string that is neither a handle nor a uuid names no row — and asking Postgres
    // would 500 on the uuid cast.
    if (!byHandle && !UUID_RE.test(idOrHandle)) return null;
    const [row] = await this.db
      .select()
      .from(agentAssignments)
      .where(scopedToTenant(agentAssignments, tenantId,
        byHandle ? eq(agentAssignments.agentHandle, Number(idOrHandle)) : eq(agentAssignments.id, idOrHandle)))
      .limit(1);
    return row ? toAssignment(row) : null;
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  /**
   * Create-or-update an assignment (idempotent on tenant+agent+scope+target). The unique
   * guard is an expression index (COALESCE on a nullable scopeId), which onConflict cannot
   * target by column list — so the insert is conflict-tolerant and a lost race re-reads.
   *
   * A workspace identity is tenant-wide by definition: its scopeId is forced to NULL.
   * A project scopeId is normalised (`'012'` and `'12'` are the same project).
   */
  async assign(tenantId: number, input: AssignInput): Promise<AgentAssignment> {
    const scopeId = input.scope === 'workspace' ? null : normaliseScopeId(input.scope, input.scopeId ?? null);
    const match = scopedToTenant(agentAssignments, tenantId,
      eq(agentAssignments.agentKind, input.agentKind),
      eq(agentAssignments.agentRef, input.agentRef),
      eq(agentAssignments.scope, input.scope),
      scopeId == null ? isNull(agentAssignments.scopeId) : eq(agentAssignments.scopeId, scopeId));

    const [existing] = await this.db.select().from(agentAssignments).where(match).limit(1);
    if (existing && input.onExisting === 'keep') return toAssignment(existing);

    const now = new Date();
    let row: typeof agentAssignments.$inferSelect | undefined;
    if (existing) {
      [row] = await this.db
        .update(agentAssignments)
        .set({
          executionScope: input.executionScope ?? existing.executionScope,
          role: input.role ?? existing.role,
          ...(input.name?.trim() ? { name: input.name.trim() } : {}),
          updatedAt: now,
        })
        .where(scopedToTenant(agentAssignments, tenantId, eq(agentAssignments.id, existing.id)))
        .returning();
    } else {
      [row] = await this.db
        .insert(agentAssignments)
        .values({
          tenantId,
          agentKind: input.agentKind,
          agentRef: input.agentRef,
          scope: input.scope,
          scopeId,
          projectId: projectIdForScope(input.scope, scopeId),
          executionScope: input.executionScope ?? (input.scope === 'workspace' ? 'global' : 'project'),
          role: input.role ?? 'default',
          name: input.name?.trim() || null,
          addedBy: input.addedBy ?? null,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      // Lost an insert race — the other request's row is the assignment.
      if (!row) [row] = await this.db.select().from(agentAssignments).where(match).limit(1);
    }
    if (!row) throw new Error(`agent assignment upsert returned no row (${input.scope}:${scopeId ?? '_'})`);
    await this.bump(tenantId);
    return toAssignment(row);
  }

  /** Set (or clear) an assignment's per-agent governance. Null when it does not exist. */
  async setGovernance(tenantId: number, idOrHandle: string, governance: string | null): Promise<AgentAssignment | null> {
    const current = await this.find(tenantId, idOrHandle);
    if (!current) return null;
    const [row] = await this.db
      .update(agentAssignments)
      .set({ governance, updatedAt: new Date() })
      .where(scopedToTenant(agentAssignments, tenantId, eq(agentAssignments.id, current.id)))
      .returning();
    if (!row) return null;
    // Run governance folds the assignment token into its cache key, so this bump is what
    // makes the new rules bind the very next run.
    await this.bump(tenantId);
    return toAssignment(row);
  }

  /**
   * Remove an assignment by uuid or handle (tenant-scoped), with the per-agent capability
   * assignments and schedules keyed on its handle.
   *
   * `expected` is REQUIRED: every caller acts on one target (a chat, a project, a scope
   * the route gated on) and must say which, so an id copied from a different target —
   * another chat's invite, a lane's staffing — is refused (false) rather than deleted.
   */
  async unassign(tenantId: number, idOrHandle: string, expected: ExpectedTarget): Promise<boolean> {
    const current = await this.find(tenantId, idOrHandle);
    if (!current || !matchesTarget(current, expected)) return false;
    await this.removeRows(tenantId, [current]);
    return true;
  }

  /**
   * The workspace identity of an agent — created if it is not there yet — and its handle.
   * Shared by the owner-side bridge route and hire provisioning, so both create the SAME
   * canonical row.
   */
  async ensureIdentity(
    tenantId: number,
    input: { agentKind?: string; agentRef: string; name: string; addedBy: string | null },
  ): Promise<number> {
    const identity = await this.assign(tenantId, {
      agentKind: input.agentKind ?? 'workforce',
      agentRef: input.agentRef,
      scope: 'workspace',
      executionScope: 'global',
      name: input.name,
      addedBy: input.addedBy,
      onExisting: 'keep',
    });
    return identity.agentHandle;
  }

  /** Drop an agent's workspace identity (and the capabilities on it). Returns rows removed. */
  async removeIdentities(tenantId: number, input: { agentKind?: string; agentRef: string }): Promise<number> {
    const rows = await this.db
      .select()
      .from(agentAssignments)
      .where(scopedToTenant(agentAssignments, tenantId,
        eq(agentAssignments.agentKind, input.agentKind ?? 'workforce'),
        eq(agentAssignments.agentRef, input.agentRef),
        eq(agentAssignments.scope, 'workspace')));
    if (rows.length === 0) return 0;
    await this.removeRows(tenantId, rows.map(toAssignment));
    return rows.length;
  }

  /**
   * Capabilities FIRST: `artifact_assignments.scope_id` has no FK behind it (it is
   * polymorphic across scopes), so dropping the assignment first would leave rows pointing
   * at a handle nobody holds. Schedules are removed explicitly too: between migrations
   * 1265 and 1269 `cron_jobs.project_agent_id` carries no FK, so nothing cascades them.
   */
  private async removeRows(tenantId: number, rows: readonly AgentAssignment[]): Promise<void> {
    const handles = rows.map((r) => r.agentHandle);
    await this.db
      .delete(artifactAssignments)
      .where(scopedToTenant(artifactAssignments, tenantId,
        eq(artifactAssignments.scope, ArtifactScope.AGENT),
        inArray(artifactAssignments.scopeId, handles)));
    await this.db
      .delete(cronJobs)
      .where(scopedToTenant(cronJobs, tenantId, inArray(cronJobs.projectAgentId, handles)));
    await this.db
      .delete(agentAssignments)
      .where(scopedToTenant(agentAssignments, tenantId, inArray(agentAssignments.id, rows.map((r) => r.id))));
    await this.bump(tenantId);
  }
}
