/**
 * runManagerSweep — the always-on driver that runs the AI Manager pass for every
 * managed project, every tick. This is what "keeps the agents and team members
 * moving": the mechanical autonomous sweep only dispatches already-owned work in
 * arrival order, whereas this sweep grooms value, ranks by priority, assigns
 * unowned work, and merges/closes PRs — the manager judgement a human PM would do.
 *
 * Scope: a project qualifies when it has a board AND either an explicit manager
 * config row or at least one non-terminal ticket (so idle/empty projects are
 * skipped). The per-project {@link runManagerForProject} still resolves the
 * effective policy (a disabled project no-ops), so this is a cheap superset filter.
 *
 * Token gate: a tenant with no budget is skipped (the AI scoring + dispatch would
 * fail the gateway anyway) — the same gate the autonomous executor + gateway use.
 * Best-effort + isolated: one bad tenant/project can't abort the sweep.
 */
import { and, eq, exists, inArray, sql } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { buildRuntimeService } from '../../buildRuntimeService';
import { tasks, projects, boards, projectManagerConfigs } from '../../infrastructure/database/schema';
import { TaskStatus } from '../../domain/shared/types';
import { getTenantTokenAvailability } from '../llm/tenantTokenAvailability';
import { runManagerForProject } from './ManagerService';
import type { Env } from '../../env';

const NON_TERMINAL: string[] = [
  TaskStatus.BACKLOG, TaskStatus.TODO, TaskStatus.READY,
  TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.BLOCKED,
];

/** Bound one tick's work; a large fleet of projects paces across ticks. */
export const MAX_PROJECTS_PER_TICK = 200;

export interface ManagerSweepResult {
  projects: number;
  managed: number;
  scored: number;
  ranked: number;
  assigned: number;
  prsConducted: number;
  prsMerged: number;
  dispatched: number;
  tokenBlockedTenants: number;
}

interface ManagedProject { projectId: number; tenantId: number; }

/** Projects with a board that carry live work or an explicit manager config. */
export async function loadManagedProjects(db: Db, limit: number): Promise<ManagedProject[]> {
  const hasWork = exists(
    db.select({ one: sql`1` }).from(tasks)
      .where(and(eq(tasks.projectId, projects.id), eq(tasks.archived, false), inArray(tasks.status, NON_TERMINAL))),
  );
  const hasConfig = exists(
    db.select({ one: sql`1` }).from(projectManagerConfigs)
      .where(eq(projectManagerConfigs.projectId, projects.id)),
  );
  const hasBoard = exists(
    db.select({ one: sql`1` }).from(boards).where(eq(boards.projectId, projects.id)),
  );

  const rows = await db
    .select({ projectId: projects.id, tenantId: projects.tenantId })
    .from(projects)
    .where(and(hasBoard, sql`(${hasWork} OR ${hasConfig})`))
    .limit(limit);
  return rows;
}

export async function runManagerSweep(env: Env): Promise<ManagerSweepResult> {
  const db = buildDatabase(env);
  const runtimeService = buildRuntimeService(env, db);

  const managed = await loadManagedProjects(db, MAX_PROJECTS_PER_TICK);

  const result: ManagerSweepResult = {
    projects: managed.length, managed: 0, scored: 0, ranked: 0, assigned: 0,
    prsConducted: 0, prsMerged: 0, dispatched: 0, tokenBlockedTenants: 0,
  };

  // Cache the per-tenant token verdict so N projects under one tenant cost one scan.
  const tokenOk = new Map<number, boolean>();

  for (const p of managed) {
    try {
      let ok = tokenOk.get(p.tenantId);
      if (ok === undefined) {
        let availability;
        try { availability = await getTenantTokenAvailability(db, p.tenantId, undefined, env); } catch { availability = null; }
        ok = !availability || availability.hasTokens; // fail OPEN on an unknown
        tokenOk.set(p.tenantId, ok);
        if (!ok) result.tokenBlockedTenants += 1;
      }
      if (!ok) continue;

      const s = await runManagerForProject(env, db, runtimeService, {
        tenantId: p.tenantId, projectId: p.projectId, submittedBy: 'system:manager-cron',
      });
      if (s.skipped) continue;
      result.managed += 1;
      result.scored += s.scored;
      result.ranked += s.ranked;
      result.assigned += s.assigned;
      result.prsConducted += s.prsConducted;
      result.prsMerged += s.prsMerged;
      result.dispatched += s.dispatched;
    } catch (err) {
      console.error(`[cron:manager] project=${p.projectId} tenant=${p.tenantId} failed`, err);
    }
  }

  return result;
}
