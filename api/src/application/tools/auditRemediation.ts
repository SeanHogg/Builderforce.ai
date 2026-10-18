import { and, eq, isNull, lt, or, ne, like } from 'drizzle-orm';
import { TaskPriority, TaskStatus } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import { systemAuditRemediations, tasks } from '../../infrastructure/database/schema';
import type { TaskService } from '../task/TaskService';
import type { AuditFinding } from './auditDeepPass';

/** Independent of severity, wording of the fix, run, and source line numbers. */
export async function findingFingerprint(auditId: string, finding: AuditFinding): Promise<string> {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const identity = [auditId, normalize(finding.location ?? '').replace(/:\d+(?::\d+)?$/, ''), normalize(finding.title)];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(identity)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A leased identity serializes concurrent reports; the marker repairs a crash after task creation. */
export async function ensureRemediationTickets(
  db: Db, taskService: TaskService,
  args: { tenantId: number; projectId: number; auditId: string; auditName: string; runId: string; findings: readonly AuditFinding[] },
): Promise<number[]> {
  const ids: number[] = [];
  for (const finding of args.findings.filter((f) => f.severity !== 'info')) {
    const fingerprint = await findingFingerprint(args.auditId, finding);
    const scope = and(eq(systemAuditRemediations.tenantId, args.tenantId), eq(systemAuditRemediations.projectId, args.projectId), eq(systemAuditRemediations.fingerprint, fingerprint));
    await db.insert(systemAuditRemediations).values({ tenantId: args.tenantId, projectId: args.projectId, fingerprint }).onConflictDoNothing();
    const [existing] = await db.select().from(systemAuditRemediations).where(scope).limit(1);
    if (existing?.taskId) {
      const [ticket] = await db.select({ id: tasks.id, status: tasks.status, archived: tasks.archived }).from(tasks)
        .where(and(eq(tasks.tenantId, args.tenantId), eq(tasks.projectId, args.projectId), eq(tasks.id, existing.taskId))).limit(1);
      if (ticket && ticket.status !== TaskStatus.DONE && !ticket.archived) { ids.push(existing.taskId); continue; }
      // A recurring finding needs active remediation; preserve the previously closed ticket's history.
      await db.update(systemAuditRemediations).set({ taskId: null }).where(and(scope, eq(systemAuditRemediations.taskId, existing.taskId)));
    }
    const now = new Date();
    const [claim] = await db.update(systemAuditRemediations).set({ leaseUntil: new Date(now.getTime() + 120_000) })
      .where(and(scope, isNull(systemAuditRemediations.taskId), or(isNull(systemAuditRemediations.leaseUntil), lt(systemAuditRemediations.leaseUntil, now)))).returning();
    if (!claim) throw new Error('Remediation is being saved by another report; retry shortly.');
    const marker = `[audit-finding:${fingerprint}]`;
    try {
      const candidates = await db.select({ id: tasks.id, description: tasks.description }).from(tasks)
        .where(and(eq(tasks.tenantId, args.tenantId), eq(tasks.projectId, args.projectId),
          ne(tasks.status, TaskStatus.DONE), eq(tasks.archived, false), like(tasks.description, `%${marker}%`))).limit(1);
      let taskId = candidates.find((t) => t.description?.includes(marker))?.id;
      if (!taskId) {
        const task = await taskService.createTask({
          projectId: args.projectId,
          title: `${args.auditName}: ${finding.title}`.slice(0, 500),
          description: `${marker}\nAudit run: ${args.runId}\nSeverity: ${finding.severity ?? 'medium'}\nLocation: ${finding.location ?? ''}\n\n${finding.detail ?? ''}\n\n${finding.recommendation ?? 'Investigate and correct the reported issue.'}\n\nAcceptance: reproduce the finding, implement the correction, and rerun the affected checks and audit.`,
          priority: finding.severity === 'critical' || finding.severity === 'high' ? TaskPriority.HIGH : TaskPriority.MEDIUM,
          createdVia: 'security_audit',
        }, args.tenantId);
        taskId = Number(task.id);
      }
      await db.update(systemAuditRemediations).set({ taskId, leaseUntil: null }).where(scope);
      ids.push(taskId);
    } catch (error) {
      await db.update(systemAuditRemediations).set({ leaseUntil: null }).where(scope);
      throw error;
    }
  }
  return [...new Set(ids)];
}
