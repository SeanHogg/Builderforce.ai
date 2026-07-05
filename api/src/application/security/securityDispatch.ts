/**
 * Security-agent dispatch — kicks off the Security agent to run a SOC 2 audit of a
 * project's codebase, and the recurring sweep that audits each tenant on a cadence.
 *
 * The Security agent is a normal, assignable cloud agent (seeded, migration 0291)
 * marked builtin_kind='security'. Its persona/skills steer the cloud run to audit
 * across all five Trust Service Criteria and file each finding via the
 * `security.record_finding` MCP tool (→ SecurityAuditService: audit ledger + one
 * access-restricted SECURITY task per finding). Auto-audit activates per-tenant the
 * moment a tenant has a Security agent — no separate feature flag: no Security agent
 * ⇒ the sweep no-ops for that tenant.
 *
 * The cloud-run path (dispatchCloudRunForTask) is task-centric, so each audit hangs
 * on a transient anchor task in the audited project (the run has a repo to clone and
 * a home for its output). Findings are separate SECURITY tasks.
 */
import { and, desc, eq } from 'drizzle-orm';
import { ideAgents, projects, projectRepositories, securityAudits } from '../../infrastructure/database/schema';
import { dispatchCloudRunForTask } from '../../presentation/routes/runtimeRoutes';
import { buildRuntimeService } from '../../buildRuntimeService';
import { buildDatabase } from '../../infrastructure/database/connection';
import { TaskService } from '../task/TaskService';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { SecurityAuditService } from './SecurityAuditService';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** A distinct lane key so the audit run isn't confused with board lane-auto-run. */
const AUDIT_LANE_KEY = '__security_audit__';

/**
 * The tenant's Security agent id, or null when the tenant has none. An active
 * ide_agents row marked builtin_kind='security' — stable across a rename. Cheap
 * indexed lookup (idx_ide_agents_builtin_kind).
 */
export async function findTenantSecurityRef(db: Db, tenantId: number): Promise<string | null> {
  const [row] = await db
    .select({ id: ideAgents.id })
    .from(ideAgents)
    .where(and(
      eq(ideAgents.tenantId, tenantId),
      eq(ideAgents.status, 'active'),
      eq(ideAgents.builtinKind, 'security'),
    ))
    .limit(1);
  return row?.id ?? null;
}

/** True when the tenant already has an audit in flight — don't pile a second on. */
async function hasRunningAudit(db: Db, tenantId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: securityAudits.id })
    .from(securityAudits)
    .where(and(eq(securityAudits.tenantId, tenantId), eq(securityAudits.status, 'running')))
    .limit(1);
  return !!row;
}

/**
 * Pick the project to audit: the most recently updated project that has a linked
 * repository (the agent needs a repo to clone). Null when the tenant has none.
 */
async function pickAuditProject(db: Db, tenantId: number, projectId?: number): Promise<number | null> {
  if (projectId != null) {
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    return row?.id ?? null;
  }
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(projectRepositories, eq(projectRepositories.projectId, projects.id))
    .where(eq(projects.tenantId, tenantId))
    .orderBy(desc(projects.updatedAt))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Dispatch ONE SOC 2 audit for a tenant (optionally targeting a specific project).
 * Best-effort; returns the audit id or null (no Security agent, no auditable project,
 * a run already in flight, or dispatch failed). Reused by the sweep and the
 * "run audit now" endpoint.
 */
export async function dispatchSecurityAudit(
  env: Env,
  db: Db,
  params: { tenantId: number; projectId?: number; securityRef?: string | null; trigger?: 'cron' | 'manual'; submittedBy?: string },
): Promise<number | null> {
  const securityRef = params.securityRef ?? (await findTenantSecurityRef(db, params.tenantId));
  if (!securityRef) return null;
  if (params.trigger !== 'manual' && (await hasRunningAudit(db, params.tenantId))) return null;

  const projectId = await pickAuditProject(db, params.tenantId, params.projectId);
  if (projectId == null) return null;

  const audits = new SecurityAuditService(db);
  const auditId = await audits.startAudit(params.tenantId, {
    projectId,
    agentRef: securityRef,
    trigger: params.trigger ?? 'cron',
  });

  // Transient anchor task the cloud run hangs on, executed AS the Security agent.
  const taskService = new TaskService(new TaskRepository(db), new ProjectRepository(db));
  const anchor = await taskService.createTask({
    projectId,
    title: 'SOC 2 Security Audit',
    description: 'Audit this codebase against SOC 2 across all five Trust Service Criteria (Security, Availability, Processing Integrity, Confidentiality, Privacy). File each finding via the security.record_finding tool.',
    assignedAgentRef: securityRef,
  }, params.tenantId);
  const anchorTaskId = Number(anchor.id);
  await db.update(securityAudits).set({ anchorTaskId }).where(eq(securityAudits.id, auditId));

  const runtimeService = buildRuntimeService(env, db);
  const payload = JSON.stringify({ cloudAgentRef: securityRef, laneKey: AUDIT_LANE_KEY, securityAudit: true, auditId });
  const deferred: Promise<unknown>[] = [];
  try {
    await dispatchCloudRunForTask(env, db, runtimeService, (p) => { deferred.push(Promise.resolve(p)); }, {
      taskId: anchorTaskId,
      tenantId: params.tenantId,
      payload,
      submittedBy: params.submittedBy ?? `security:${securityRef}`,
    });
    await Promise.allSettled(deferred);
    return auditId;
  } catch {
    // Best-effort — a dispatch failure marks the run failed but never throws.
    await audits.finishAudit(params.tenantId, auditId, { status: 'failed', summary: 'Audit dispatch failed.' }).catch(() => {});
    return null;
  }
}

export interface SecuritySweepResult {
  tenantsWithSecurityAgent: number;
  dispatched: number;
}

/**
 * Weekly sweep: for every tenant that has a Security agent and no audit in flight,
 * dispatch one SOC 2 audit against its most-recently-active repo-linked project.
 * No-op for tenants without a Security agent or without an auditable project.
 */
export async function runSecurityAuditSweep(env: Env): Promise<SecuritySweepResult> {
  const db = buildDatabase(env);
  const out: SecuritySweepResult = { tenantsWithSecurityAgent: 0, dispatched: 0 };

  const agents = await db
    .select({ tenantId: ideAgents.tenantId, id: ideAgents.id })
    .from(ideAgents)
    .where(and(eq(ideAgents.status, 'active'), eq(ideAgents.builtinKind, 'security')));
  const refByTenant = new Map<number, string>();
  for (const a of agents) if (!refByTenant.has(a.tenantId)) refByTenant.set(a.tenantId, a.id);
  out.tenantsWithSecurityAgent = refByTenant.size;
  if (refByTenant.size === 0) return out;

  for (const [tenantId, securityRef] of refByTenant) {
    const auditId = await dispatchSecurityAudit(env, db, { tenantId, securityRef, trigger: 'cron' });
    if (auditId != null) out.dispatched += 1;
  }
  return out;
}
