/**
 * managerDirectives — standing human guidance the AI Manager honors, i.e. the
 * persisted output of a "coaching session".
 *
 * A human coaches the manager (via the Manager-tab box or the `manager.coach` chat
 * tool); each piece of guidance is stored as an `active` directive and folded into
 * the manager's scoring/prioritization persona on EVERY subsequent pass (see
 * ManagerService), so coaching actually steers behavior instead of being a one-off
 * chat. A directive scoped to a project applies to that project; a tenant-wide
 * (project_id NULL) directive applies to every project the manager runs — matching a
 * manager that manages the whole tenant. Retiring a directive (done/dismissed) keeps
 * it for the audit trail but stops it applying.
 */
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { managerDirectives } from '../../infrastructure/database/schema';

export type ManagerDirectiveStatus = 'active' | 'done' | 'dismissed';
export type ManagerDirectiveSource = 'coach' | 'chat';

export interface ManagerDirectiveRow {
  id: string;
  projectId: number | null;
  directive: string;
  status: string;
  createdBy: string | null;
  source: string;
  createdAt: Date;
  expiresAt: Date | null;
}

/** Max directives folded into one pass — a storm guard on the composed prompt size. */
const MAX_ACTIVE_FOR_PASS = 20;
/** Cap the stored guidance text so one coaching turn can't bloat the row / prompt. */
const MAX_DIRECTIVE_CHARS = 2000;

/**
 * The active directives that apply to a project's pass: its OWN project-scoped rows
 * PLUS the tenant-wide (project_id NULL) rows, freshest first, un-expired only. This
 * is the exact set ManagerService folds into the manager persona.
 */
export async function listActiveManagerDirectives(
  db: Db, tenantId: number, projectId: number,
): Promise<ManagerDirectiveRow[]> {
  return db
    .select({
      id: managerDirectives.id, projectId: managerDirectives.projectId, directive: managerDirectives.directive,
      status: managerDirectives.status, createdBy: managerDirectives.createdBy, source: managerDirectives.source,
      createdAt: managerDirectives.createdAt, expiresAt: managerDirectives.expiresAt,
    })
    .from(managerDirectives)
    .where(and(
      eq(managerDirectives.tenantId, tenantId),
      eq(managerDirectives.status, 'active'),
      or(eq(managerDirectives.projectId, projectId), isNull(managerDirectives.projectId)),
      or(isNull(managerDirectives.expiresAt), sql`${managerDirectives.expiresAt} > now()`),
    ))
    .orderBy(desc(managerDirectives.createdAt))
    .limit(MAX_ACTIVE_FOR_PASS);
}

/** All directives for the Manager surface (any status), newest first. Includes the
 *  tenant-wide rows so a project view shows the guidance that also affects it. */
export async function listManagerDirectives(
  db: Db, tenantId: number, projectId: number, limit = 50,
): Promise<ManagerDirectiveRow[]> {
  return db
    .select({
      id: managerDirectives.id, projectId: managerDirectives.projectId, directive: managerDirectives.directive,
      status: managerDirectives.status, createdBy: managerDirectives.createdBy, source: managerDirectives.source,
      createdAt: managerDirectives.createdAt, expiresAt: managerDirectives.expiresAt,
    })
    .from(managerDirectives)
    .where(and(
      eq(managerDirectives.tenantId, tenantId),
      or(eq(managerDirectives.projectId, projectId), isNull(managerDirectives.projectId)),
    ))
    .orderBy(desc(managerDirectives.createdAt))
    .limit(Math.min(200, Math.max(1, limit)));
}

/** Record a coaching directive. `projectId = null` makes it tenant-wide. Returns the id. */
export async function addManagerDirective(
  db: Db,
  args: {
    tenantId: number; projectId: number | null; directive: string;
    createdBy?: string | null; source?: ManagerDirectiveSource; expiresAt?: Date | null;
  },
): Promise<string | null> {
  const text = args.directive.trim().slice(0, MAX_DIRECTIVE_CHARS);
  if (text.length < 3) return null;
  const [row] = await db
    .insert(managerDirectives)
    .values({
      tenantId: args.tenantId,
      projectId: args.projectId ?? null,
      directive: text,
      status: 'active',
      createdBy: args.createdBy ?? null,
      source: args.source ?? 'coach',
      expiresAt: args.expiresAt ?? null,
    })
    .returning({ id: managerDirectives.id });
  return row?.id ?? null;
}

/** Retire a directive (dismissed / done). Tenant-scoped so a caller can't touch
 *  another tenant's guidance. Returns true when a row changed. */
export async function setManagerDirectiveStatus(
  db: Db, tenantId: number, directiveId: string, status: ManagerDirectiveStatus,
): Promise<boolean> {
  const rows = await db
    .update(managerDirectives)
    .set({ status })
    .where(and(eq(managerDirectives.tenantId, tenantId), eq(managerDirectives.id, directiveId)))
    .returning({ id: managerDirectives.id });
  return rows.length > 0;
}
