/**
 * SecurityAuditService — the write + read path for the Security agent's SOC 2 audit.
 *
 * The Security agent (a built-in, assignable cloud agent, migration 0291) runs a
 * SOC 2 audit across all five Trust Service Criteria against a project's codebase and
 * reports each issue through this service. A run:
 *
 *   1. startAudit — opens a `security_audits` row (status 'running') the run attaches
 *      findings to (the surfaced "Security Audit result");
 *   2. recordFinding — for every finding, mints a first-class SECURITY task
 *      (taskType='security') carrying the severity, the Trust Service Criterion, a
 *      concrete recommendation, and the audit id — visible only to allowed audiences;
 *   3. finishAudit — rolls up counts (by severity, by criterion) + the summary and
 *      flips the run to 'complete'.
 *
 * DRY: reached through ONE built-in MCP tool (`security.record_finding`) so the agent
 * can report from any runtime (cloud loop, CLI, on-prem), mirroring ValidationService
 * (reviews.record → GAP tasks). Findings live only as DB rows — never in source
 * control.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { securityAudits, tasks as tasksTable, projects } from '../../infrastructure/database/schema';
import { TaskService } from '../task/TaskService';
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { ProjectRepository } from '../../infrastructure/repositories/ProjectRepository';
import { TaskType, TaskPriority } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
/** The five SOC 2 Trust Service Criteria a finding maps to. */
export type TrustCriterion =
  | 'security'
  | 'availability'
  | 'processing_integrity'
  | 'confidentiality'
  | 'privacy';

/** Map a finding severity to the minted SECURITY task's priority. */
const SEVERITY_PRIORITY: Record<FindingSeverity, TaskPriority> = {
  critical: TaskPriority.URGENT,
  high: TaskPriority.HIGH,
  medium: TaskPriority.MEDIUM,
  low: TaskPriority.LOW,
  info: TaskPriority.LOW,
};

export interface StartAuditInput {
  projectId: number;
  agentRef?: string | null;
  trigger?: 'cron' | 'manual';
  anchorTaskId?: number | null;
  /** 'codebase' (SOC 2 agent audit) | 'web' (external URL scan). Default 'codebase'. */
  scanKind?: 'codebase' | 'web';
  /** The scanned website URL — set on 'web' runs (migration 0357). */
  targetUrl?: string | null;
}

export interface RecordFindingInput {
  /** The audit run this finding belongs to; when omitted, attaches to the tenant's
   *  latest still-running audit. */
  auditId?: number | null;
  title: string;
  detail?: string | null;
  severity?: FindingSeverity;
  tsc?: TrustCriterion;
  /** Where in the codebase (file:line / component), for the ticket body. */
  location?: string | null;
  recommendation?: string | null;
}

export interface RecordFindingResult {
  taskId: number;
  auditId: number | null;
  severity: FindingSeverity;
  tsc: TrustCriterion;
}

export class SecurityAuditService {
  private readonly tasks: TaskService;

  constructor(private readonly db: Db) {
    this.tasks = new TaskService(new TaskRepository(db), new ProjectRepository(db));
  }

  /** The project id, tenant-scoped. Null on cross-tenant / missing. */
  private async ownedProject(tenantId: number, projectId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    return !!row;
  }

  /** Open a new audit run for a project. Returns the audit id. */
  async startAudit(tenantId: number, input: StartAuditInput): Promise<number> {
    if (!(await this.ownedProject(tenantId, input.projectId))) {
      throw new Error('Project not found in workspace');
    }
    const [row] = await this.db.insert(securityAudits).values({
      tenantId,
      projectId: input.projectId,
      anchorTaskId: input.anchorTaskId ?? undefined,
      agentRef: input.agentRef ?? undefined,
      status: 'running',
      triggerSource: input.trigger ?? 'cron',
      scanKind: input.scanKind ?? 'codebase',
      targetUrl: input.targetUrl ?? undefined,
    }).returning({ id: securityAudits.id });
    return row!.id;
  }

  /** The tenant's latest still-running audit, or null. */
  private async latestRunningAudit(tenantId: number): Promise<{ id: number; projectId: number | null } | null> {
    const [row] = await this.db
      .select({ id: securityAudits.id, projectId: securityAudits.projectId })
      .from(securityAudits)
      .where(and(eq(securityAudits.tenantId, tenantId), eq(securityAudits.status, 'running')))
      .orderBy(desc(securityAudits.startedAt))
      .limit(1);
    return row ?? null;
  }

  /**
   * Record one SOC 2 finding: mint a SECURITY task in the audit's project + bump the
   * run's findings counter. Tenant-scoped throughout.
   */
  async recordFinding(tenantId: number, input: RecordFindingInput): Promise<RecordFindingResult> {
    const title = String(input.title || '').trim();
    if (!title) throw new Error('finding title is required');

    // Resolve the target audit (explicit id, else the tenant's running audit).
    let auditId = input.auditId ?? null;
    let projectId: number | null = null;
    if (auditId != null) {
      const [row] = await this.db
        .select({ id: securityAudits.id, projectId: securityAudits.projectId })
        .from(securityAudits)
        .where(and(eq(securityAudits.id, auditId), eq(securityAudits.tenantId, tenantId)))
        .limit(1);
      if (!row) throw new Error('Audit run not found in workspace');
      projectId = row.projectId;
    } else {
      const running = await this.latestRunningAudit(tenantId);
      if (running) { auditId = running.id; projectId = running.projectId; }
    }
    if (projectId == null) throw new Error('No target project for the finding (start an audit first)');

    const severity: FindingSeverity = input.severity ?? 'medium';
    const tsc: TrustCriterion = input.tsc ?? 'security';

    // Mint the SECURITY task (reuse createTask exactly like ValidationService mints GAP tasks).
    const bodyParts = [input.detail ? String(input.detail) : ''];
    if (input.location) bodyParts.push(`\n\n**Location:** ${String(input.location)}`);
    if (input.recommendation) bodyParts.push(`\n\n**Recommendation:** ${String(input.recommendation)}`);
    const created = await this.tasks.createTask({
      projectId,
      title: title.slice(0, 500),
      description: bodyParts.join('').trim() || `SOC 2 finding (${tsc}, ${severity}).`,
      priority: SEVERITY_PRIORITY[severity],
      taskType: TaskType.SECURITY,
    }, tenantId);
    const taskId = Number(created.id);

    // Denormalise the finding metadata onto the task (columns from migration 0290).
    await this.db.update(tasksTable).set({
      securitySeverity: severity,
      securityTsc: tsc,
      securityAuditId: auditId ?? undefined,
      updatedAt: new Date(),
    }).where(eq(tasksTable.id, taskId));

    if (auditId != null) {
      await this.db.update(securityAudits).set({
        findingsCount: sql`${securityAudits.findingsCount} + 1`,
      }).where(eq(securityAudits.id, auditId));
    }

    return { taskId, auditId, severity, tsc };
  }

  /** Close an audit run: roll up counts from its findings + record the summary. */
  async finishAudit(
    tenantId: number,
    auditId: number,
    input: { summary?: string | null; status?: 'complete' | 'failed'; score?: number | null } = {},
  ): Promise<void> {
    const [audit] = await this.db
      .select({ id: securityAudits.id })
      .from(securityAudits)
      .where(and(eq(securityAudits.id, auditId), eq(securityAudits.tenantId, tenantId)))
      .limit(1);
    if (!audit) throw new Error('Audit run not found in workspace');

    // Roll up the finding tickets this run produced, by severity and by criterion.
    const findings = await this.db
      .select({ severity: tasksTable.securitySeverity, tsc: tasksTable.securityTsc })
      .from(tasksTable)
      .where(eq(tasksTable.securityAuditId, auditId));
    const bySeverity: Record<string, number> = {};
    const byTsc: Record<string, number> = {};
    for (const f of findings) {
      if (f.severity) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      if (f.tsc) byTsc[f.tsc] = (byTsc[f.tsc] ?? 0) + 1;
    }

    await this.db.update(securityAudits).set({
      status: input.status ?? 'complete',
      summary: input.summary ?? undefined,
      score: input.score ?? undefined,
      findingsCount: findings.length,
      countsBySeverity: bySeverity,
      countsByTsc: byTsc,
      finishedAt: new Date(),
    }).where(eq(securityAudits.id, auditId));
  }

  /**
   * Audit runs for a tenant, newest first (the audit panel). `scanKind` filters to
   * codebase (SOC 2) vs web (URL scan) runs; omit for all.
   */
  async listAudits(tenantId: number, opts: { limit?: number; scanKind?: 'codebase' | 'web' } = {}) {
    const where = opts.scanKind
      ? and(eq(securityAudits.tenantId, tenantId), eq(securityAudits.scanKind, opts.scanKind))
      : eq(securityAudits.tenantId, tenantId);
    return this.db
      .select()
      .from(securityAudits)
      .where(where)
      .orderBy(desc(securityAudits.startedAt))
      .limit(opts.limit ?? 20);
  }

  /**
   * The most recent COMPLETED web scan of the same target before a given run — the
   * baseline the current scan's score/findings are compared against (drift).
   */
  async previousWebScan(tenantId: number, targetUrl: string, beforeAuditId: number) {
    const [row] = await this.db
      .select({
        id: securityAudits.id,
        score: securityAudits.score,
        findingsCount: securityAudits.findingsCount,
        countsBySeverity: securityAudits.countsBySeverity,
        startedAt: securityAudits.startedAt,
      })
      .from(securityAudits)
      .where(and(
        eq(securityAudits.tenantId, tenantId),
        eq(securityAudits.scanKind, 'web'),
        eq(securityAudits.targetUrl, targetUrl),
        eq(securityAudits.status, 'complete'),
        sql`${securityAudits.id} < ${beforeAuditId}`,
      ))
      .orderBy(desc(securityAudits.id))
      .limit(1);
    return row ?? null;
  }

  /** One audit run + its finding tickets (the audit result detail view). */
  async getAudit(tenantId: number, auditId: number) {
    const [audit] = await this.db
      .select()
      .from(securityAudits)
      .where(and(eq(securityAudits.id, auditId), eq(securityAudits.tenantId, tenantId)))
      .limit(1);
    if (!audit) return null;
    const findings = await this.db
      .select({
        id: tasksTable.id,
        title: tasksTable.title,
        status: tasksTable.status,
        priority: tasksTable.priority,
        severity: tasksTable.securitySeverity,
        tsc: tasksTable.securityTsc,
      })
      .from(tasksTable)
      .where(eq(tasksTable.securityAuditId, auditId))
      .orderBy(desc(tasksTable.id));
    return { audit, findings };
  }
}
