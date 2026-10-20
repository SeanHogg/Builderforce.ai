/**
 * ticketLookup — finding a ticket by its address (kind, ref) or by text, across every
 * tier a chat can link to. Tenant-scoped; the strategy tiers and ceremonies are also
 * segment-scoped.
 */
import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import {
  tasks,
  projects,
  objectives,
  initiatives,
  portfolios,
  roadmapItems,
  specs,
  pokerSessions,
  retrospectives,
} from '../../infrastructure/database/schema';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import { notSystemTask } from '../task/taskScope';
import type { Db } from '../../infrastructure/database/connection';
import { isTicketKind, type TicketSearchHit } from './chatTicketTypes';

/** Verify a (kind, ref) resolves to a work item in this tenant. Returns its
 *  display label + status, or null when it does not exist / is cross-tenant. */
export async function resolveTicket(db: Db, tenantId: number, kind: string, ref: string): Promise<{ label: string; status: string } | null> {
  if (!isTicketKind(kind)) return null;
  if (kind === 'task' || kind === 'epic' || kind === 'gap') {
    const id = Number(ref);
    if (!Number.isInteger(id) || id <= 0) return null;
    const [row] = await db
      .select({ title: tasks.title, status: tasks.status })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.id, id), eq(projects.tenantId, tenantId)))
      .limit(1);
    return row ? { label: row.title, status: row.status } : null;
  }
  // Roadmap items are a standalone product artifact (their own uuid-keyed table),
  // scoped by tenant — not part of the planning spine, so no segment filter.
  if (kind === 'roadmap') {
    const [row] = await db
      .select({ title: roadmapItems.title, status: roadmapItems.status })
      .from(roadmapItems)
      .where(and(eq(roadmapItems.id, ref), eq(roadmapItems.tenantId, tenantId)))
      .limit(1);
    return row ? { label: row.title, status: row.status } : null;
  }
  // Specs / PRDs — tenant-scoped product artifact (the goal is the label).
  if (kind === 'spec') {
    const [row] = await db
      .select({ goal: specs.goal, status: specs.status })
      .from(specs)
      .where(and(eq(specs.id, ref), eq(specs.tenantId, tenantId)))
      .limit(1);
    return row ? { label: row.goal, status: row.status } : null;
  }
  const seg = await resolveSegment(db, tenantId);
  // Team ceremonies — segment-scoped, tenant-wide (they are not project-owned).
  if (kind === 'retro') {
    const [row] = await db.select({ name: retrospectives.name, status: retrospectives.status }).from(retrospectives)
      .where(and(eq(retrospectives.id, ref), eq(retrospectives.tenantId, tenantId), eq(retrospectives.segmentId, seg))).limit(1);
    return row ? { label: row.name, status: row.status } : null;
  }
  if (kind === 'poker') {
    const [row] = await db.select({ name: pokerSessions.name, status: pokerSessions.status }).from(pokerSessions)
      .where(and(eq(pokerSessions.id, ref), eq(pokerSessions.tenantId, tenantId), eq(pokerSessions.segmentId, seg))).limit(1);
    return row ? { label: row.name, status: row.status } : null;
  }
  if (kind === 'objective') {
    const [row] = await db.select({ title: objectives.title, status: objectives.status }).from(objectives)
      .where(and(eq(objectives.id, ref), eq(objectives.tenantId, tenantId), eq(objectives.segmentId, seg))).limit(1);
    return row ? { label: row.title, status: row.status } : null;
  }
  if (kind === 'initiative') {
    const [row] = await db.select({ name: initiatives.name, status: initiatives.status }).from(initiatives)
      .where(and(eq(initiatives.id, ref), eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, seg))).limit(1);
    return row ? { label: row.name, status: row.status } : null;
  }
  // portfolio
  const [row] = await db.select({ name: portfolios.name, status: portfolios.status }).from(portfolios)
    .where(and(eq(portfolios.id, ref), eq(portfolios.tenantId, tenantId), eq(portfolios.segmentId, seg))).limit(1);
  return row ? { label: row.name, status: row.status } : null;
}

/**
 * Server-side typeahead over a SINGLE ticket tier. Returns up to `limit`
 * (kind, ref) hits whose title / name / goal / key matches `query` (a
 * case-insensitive substring), most-recently-updated first. An empty query
 * returns the newest items so the picker has an initial page.
 *
 * This replaces the client's old "fetch EVERY ticket then filter in the DOM"
 * (which was both heavy AND incomplete once a list endpoint's 200-row cap hit)
 * with a bounded, indexed search — fast and complete on a 20k+ ticket tenant.
 * task/epic/gap/roadmap/spec honour the current project scope; the strategy
 * tiers (objective/initiative/portfolio) are segment-scoped tenant-wide, exactly
 * as the picker loaded them before.
 */
export async function searchTickets(
  db: Db,
  tenantId: number,
  kind: string,
  query: string,
  projectId: number | null,
  limit = 40,
): Promise<TicketSearchHit[]> {
  if (!isTicketKind(kind)) return [];
  const lim = Math.min(Math.max(Math.trunc(limit) || 40, 1), 50);
  const q = query.trim();
  // Escape LIKE metacharacters so a user's literal "%" / "_" / "\" isn't a wildcard.
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;

  if (kind === 'task' || kind === 'epic' || kind === 'gap') {
    const conds: SQL[] = [eq(projects.tenantId, tenantId), eq(tasks.archived, false), eq(tasks.taskType, kind), notSystemTask];
    if (projectId != null) conds.push(eq(tasks.projectId, projectId));
    if (like) conds.push(or(ilike(tasks.title, like), ilike(tasks.key, like))!);
    const rows = await db
      .select({ id: tasks.id, key: tasks.key, title: tasks.title })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(...conds))
      .orderBy(desc(tasks.updatedAt))
      .limit(lim);
    return rows.map((r) => ({ ref: String(r.id), label: r.key ? `${r.key} — ${r.title}` : r.title }));
  }

  if (kind === 'roadmap') {
    const conds: SQL[] = [eq(roadmapItems.tenantId, tenantId)];
    if (projectId != null) conds.push(eq(roadmapItems.projectId, projectId));
    if (like) conds.push(ilike(roadmapItems.title, like));
    const rows = await db.select({ id: roadmapItems.id, title: roadmapItems.title })
      .from(roadmapItems).where(and(...conds)).orderBy(desc(roadmapItems.updatedAt)).limit(lim);
    return rows.map((r) => ({ ref: r.id, label: r.title }));
  }

  if (kind === 'spec') {
    const conds: SQL[] = [eq(specs.tenantId, tenantId)];
    if (projectId != null) conds.push(eq(specs.projectId, projectId));
    if (like) conds.push(ilike(specs.goal, like));
    const rows = await db.select({ id: specs.id, goal: specs.goal })
      .from(specs).where(and(...conds)).orderBy(desc(specs.updatedAt)).limit(lim);
    return rows.map((r) => ({ ref: r.id, label: r.goal }));
  }

  // Strategy tiers — segment-scoped, tenant-wide (no project filter, matching the picker).
  const seg = await resolveSegment(db, tenantId);
  // Team ceremonies. Not project-filtered: neither table carries a projectId — a
  // retro or an estimation session belongs to the TEAM, not to one project.
  if (kind === 'retro') {
    const conds: SQL[] = [eq(retrospectives.tenantId, tenantId), eq(retrospectives.segmentId, seg)];
    if (like) conds.push(ilike(retrospectives.name, like));
    const rows = await db.select({ id: retrospectives.id, name: retrospectives.name })
      .from(retrospectives).where(and(...conds)).orderBy(desc(retrospectives.updatedAt)).limit(lim);
    return rows.map((r) => ({ ref: r.id, label: r.name }));
  }
  if (kind === 'poker') {
    const conds: SQL[] = [eq(pokerSessions.tenantId, tenantId), eq(pokerSessions.segmentId, seg)];
    if (like) conds.push(ilike(pokerSessions.name, like));
    const rows = await db.select({ id: pokerSessions.id, name: pokerSessions.name })
      .from(pokerSessions).where(and(...conds)).orderBy(desc(pokerSessions.updatedAt)).limit(lim);
    return rows.map((r) => ({ ref: r.id, label: r.name }));
  }
  if (kind === 'objective') {
    const conds: SQL[] = [eq(objectives.tenantId, tenantId), eq(objectives.segmentId, seg)];
    if (like) conds.push(ilike(objectives.title, like));
    const rows = await db.select({ id: objectives.id, title: objectives.title })
      .from(objectives).where(and(...conds)).orderBy(desc(objectives.updatedAt)).limit(lim);
    return rows.map((r) => ({ ref: r.id, label: r.title }));
  }
  if (kind === 'initiative') {
    const conds: SQL[] = [eq(initiatives.tenantId, tenantId), eq(initiatives.segmentId, seg)];
    if (like) conds.push(ilike(initiatives.name, like));
    const rows = await db.select({ id: initiatives.id, name: initiatives.name })
      .from(initiatives).where(and(...conds)).orderBy(desc(initiatives.updatedAt)).limit(lim);
    return rows.map((r) => ({ ref: r.id, label: r.name }));
  }
  // portfolio
  const conds: SQL[] = [eq(portfolios.tenantId, tenantId), eq(portfolios.segmentId, seg)];
  if (like) conds.push(ilike(portfolios.name, like));
  const rows = await db.select({ id: portfolios.id, name: portfolios.name })
    .from(portfolios).where(and(...conds)).orderBy(desc(portfolios.updatedAt)).limit(lim);
  return rows.map((r) => ({ ref: r.id, label: r.name }));
}
