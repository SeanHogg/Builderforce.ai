/**
 * {@link ChallengePlan} → a real project: files in the canvas, handlers serving,
 * tickets on the board, and an honest list of what a human still has to do.
 *
 * This is the step that makes the pipeline a build rather than a document. It is
 * deliberately the SECOND act — planning produced something a customer could
 * argue with, and only an explicit build writes anything.
 *
 * ── IDEMPOTENT, AND WHY THAT MATTERS ────────────────────────────────────────
 * Building the same challenge twice must converge, not duplicate. A brief gets
 * re-read (the model is re-run, the plan is corrected, the customer clicks Build
 * again) and a pipeline that seeded a second copy of every ticket each time would
 * be unusable after two attempts. So: files are written by path (overwrite),
 * handlers by name (overwrite), and tickets are matched on title and skipped if
 * already present.
 *
 * ── FILES ARE WRITTEN THROUGH THE WORKSPACE STORE ───────────────────────────
 * Every write goes through {@link writeWorkspaceFile}, which enforces the same
 * path and content contract a human's edit gets. A generated file cannot escape
 * the project prefix or put JSON into a `.js` — a generator is exactly the kind
 * of caller that would otherwise do both.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { projects, tasks } from '../../infrastructure/database/schema';
import { buildProjectKey } from '../project/projectKey';
import { formatTaskKey, nextProjectKeySeqBase } from '../task/taskKeys';
import { writeWorkspaceFile } from '../ide/workspaceStore';
import { HANDLERS_DIR } from '../backend/handlerSpec';
import { ensureProjectBackend, ingressUrlFor, materializeBackend, onCanvasWrite } from '../backend';
import { listProjectSecrets } from '../secrets/projectSecrets';
import { BUILTIN_CONNECTORS } from '../connectors/defaults';
import { connectorConnections } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { maybeAutoRunOnLaneEntry } from '../swimlane/laneEntryTrigger';
import type { RuntimeService } from '../runtime/RuntimeService';
import { isBuildTask } from './blueprint';
import type { ChallengePlan } from './planChallenge';
import type { ChallengeSpec } from './parseBrief';
import type { SetupStep } from '../backend/hostingStrategy';

export interface MaterializeChallengeResult {
  projectId: number;
  projectKey: string;
  ingressUrl: string;
  filesWritten: string[];
  handlersWritten: string[];
  tasksCreated: number;
  tasksSkipped: number;
  /** Seeded build tickets autonomy actually started a run for. */
  tasksDispatched: number;
  /** Everything still standing between this and a working system. */
  readiness: SetupStep[];
  warnings: string[];
}

/** A project name derived from the challenge, kept inside the column width. */
function projectNameFor(spec: ChallengeSpec): string {
  return (spec.title || 'Challenge').slice(0, 120);
}

/**
 * Find or create the project. A key collision walks a numeric suffix rather than
 * failing: two challenges from the same sponsor produce the same slug, and
 * refusing the second is not an acceptable answer to "paste another brief".
 */
async function resolveProject(
  db: Db,
  tenantId: number,
  spec: ChallengeSpec,
  existingProjectId: number | null,
): Promise<{ id: number; key: string; name: string }> {
  if (existingProjectId) {
    const [row] = await db
      .select({ id: projects.id, key: projects.key, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, existingProjectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    if (row) return row;
  }

  const name = projectNameFor(spec);
  const baseKey = buildProjectKey(tenantId, name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = attempt === 0 ? baseKey : `${baseKey.slice(0, 46)}-${attempt + 1}`;
    const [existing] = await db
      .select({ id: projects.id, key: projects.key, name: projects.name })
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.key, key)))
      .limit(1);
    if (existing) continue;
    try {
      const [row] = await db
        .insert(projects)
        .values({
          tenantId,
          key,
          name,
          description: spec.goal.slice(0, 2000),
          // 'designer' so the project opens in the IDE with a runnable workspace;
          // the blueprint's own index.html replaces the stock scaffold below.
          modality: 'designer',
          origin: 'ide',
        })
        .returning({ id: projects.id, key: projects.key, name: projects.name });
      if (row) return row;
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/challenge/materializeChallenge.ts',
        operation: `resolveProject:${key}`,
      });
    }
  }
  throw new Error('Could not allocate a project key for this challenge');
}

/** Seed the plan's tickets, skipping any whose title is already on the board. */
async function seedTasks(
  db: Db,
  projectId: number,
  projectKey: string,
  plan: ChallengePlan,
): Promise<{ created: number; skipped: number; buildTaskIds: number[] }> {
  const existing = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));
  const seen = new Set(existing.map((t) => t.title.trim().toLowerCase()));

  let seq = await nextProjectKeySeqBase(db, projectId);
  let created = 0;
  let skipped = 0;
  const buildTaskIds: number[] = [];

  for (const task of [...plan.tasks].sort((a, b) => a.order - b.order)) {
    if (seen.has(task.title.trim().toLowerCase())) {
      skipped++;
      continue;
    }
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      try {
        const [row] = await db
          .insert(tasks)
          .values({
            projectId,
            key: formatTaskKey(projectKey, seq),
            title: task.title.slice(0, 500),
            description: task.description,
            status: 'backlog',
            priority: 'medium',
          })
          .returning({ id: tasks.id });
        inserted = true;
        created++;
        seen.add(task.title.trim().toLowerCase());
        // Only tickets seeded THIS run are offered to autonomy. A ticket that was
        // already on the board has its own history — it may be in review, or
        // deliberately parked — and re-dispatching it because the challenge was
        // rebuilt would be the pipeline reaching into work it does not own.
        if (row && isBuildTask(task)) buildTaskIds.push(row.id);
      } catch (error) {
        // Almost certainly a key collision with a concurrent create — walk on.
        reportCaughtError(error, {
          source: 'application/challenge/materializeChallenge.ts',
          operation: `seedTasks:${task.title.slice(0, 40)}`,
        });
      } finally {
        seq++;
      }
    }
  }
  return { created, skipped, buildTaskIds };
}

/** Most tickets one build may hand to autonomy. A plan caps tasks at 8 already;
 *  this is the backstop against a future planner that does not. */
const MAX_AUTO_DISPATCH = 8;

/**
 * Offer the freshly-seeded BUILD tickets to autonomy.
 *
 * Deliberately "offer", not "start": every candidate goes through
 * {@link maybeAutoRunOnLaneEntry}, the same gate a drag onto a lane uses, which
 * already decides whether a lane is staffed, whether the board is human-gated,
 * whether the workspace has budget and whether an agent is even eligible. A
 * project whose board has no staffed lane declines every candidate and nothing
 * happens — which is the correct outcome, not a failure.
 *
 * Reusing that gate rather than dispatching directly is the whole point: a second
 * dispatch path would be a second set of rules about when the platform is allowed
 * to spend a customer's run budget, and the two would drift.
 */
async function dispatchBuildTasks(
  env: Env,
  db: Db,
  runtimeService: RuntimeService,
  args: { tenantId: number; projectId: number; taskIds: readonly number[] },
): Promise<number> {
  let dispatched = 0;
  for (const taskId of args.taskIds.slice(0, MAX_AUTO_DISPATCH)) {
    try {
      const started = await maybeAutoRunOnLaneEntry(env, db, runtimeService, {
        tenantId: args.tenantId,
        projectId: args.projectId,
        taskId,
        status: 'backlog',
        submittedBy: 'system:challenge-build',
      });
      if (started) dispatched++;
    } catch (error) {
      // A declined or failed dispatch must not fail the BUILD — the system is
      // already materialised and working; this only decides who starts the work.
      reportCaughtError(error, {
        source: 'application/challenge/materializeChallenge.ts',
        operation: `dispatchBuildTasks:${taskId}`,
      });
    }
  }
  return dispatched;
}

/** Connectors from the plan that have no live connection yet. */
async function missingConnectorSteps(
  db: Db,
  tenantId: number,
  plan: ChallengePlan,
): Promise<SetupStep[]> {
  if (plan.requiredConnectors.length === 0) return [];
  const rows = await db
    .select({ connectorKey: connectorConnections.connectorKey })
    .from(connectorConnections)
    .where(and(eq(connectorConnections.tenantId, tenantId), eq(connectorConnections.enabled, true)));
  const connected = new Set(rows.map((r) => r.connectorKey));

  return plan.requiredConnectors
    .filter((c) => !connected.has(c.key))
    .map((c) => ({
      key: `connector:${c.key}`,
      label: `Connect ${c.label}`,
      detail: c.why,
      blocking: true,
    }));
}

/**
 * Build the challenge.
 *
 * The ORDER matters: handlers are written before the backend is materialised,
 * because the strategy reads the canvas to decide what it is deploying and to
 * generate the endpoint map. Writing them afterwards produced a README listing
 * zero endpoints on the very first build — technically self-healing on the next
 * one, and exactly the kind of thing that makes a first run feel broken.
 */
export async function materializeChallenge(args: {
  db: Db;
  env: Env;
  bucket: R2Bucket;
  tenantId: number;
  spec: ChallengeSpec;
  plan: ChallengePlan;
  /** Build into an existing project instead of creating one. */
  projectId?: number | null;
  /**
   * Present ⇒ the seeded BUILD tickets are offered to autonomy. Optional so a
   * caller without a runtime (a test, a dry run) still materialises the system;
   * the board simply waits for a human, as it did before.
   */
  runtimeService?: RuntimeService | null;
}): Promise<MaterializeChallengeResult> {
  const { db, env, bucket, tenantId, spec, plan } = args;
  const warnings: string[] = [...plan.handlerWarnings];

  const project = await resolveProject(db, tenantId, spec, args.projectId ?? null);
  const backend = await ensureProjectBackend(env, db, tenantId, project.id, plan.strategy);
  const ingressUrl = ingressUrlFor(env, backend.ingressToken);

  // ── Files ────────────────────────────────────────────────────────────────
  // `__INGRESS_URL__` is substituted rather than templated at request time: these
  // are static assets served from the project's own subdomain, with no server to
  // interpolate anything.
  const filesWritten: string[] = [];
  for (const [path, content] of Object.entries(plan.files)) {
    const resolved = content
      .split('window.__INGRESS_URL__ || \'\'')
      .join(`window.__INGRESS_URL__ || ${JSON.stringify(ingressUrl)}`);
    const write = await writeWorkspaceFile(bucket, project.id, path, resolved);
    if (write.ok) filesWritten.push(path);
    else warnings.push(`Could not write ${path}: ${write.reason}`);
  }

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handlersWritten: string[] = [];
  for (const [name, spec_] of Object.entries(plan.handlers)) {
    const path = `${HANDLERS_DIR}${name}.json`;
    const write = await writeWorkspaceFile(bucket, project.id, path, JSON.stringify(spec_, null, 2));
    if (write.ok) {
      handlersWritten.push(path);
      // The ingress serves handlers through a cache; a freshly materialized
      // challenge must answer on its own routes immediately, not after a TTL.
      await onCanvasWrite(env, project.id, path);
    } else {
      warnings.push(`Could not write ${path}: ${write.reason}`);
    }
  }

  // ── Board ────────────────────────────────────────────────────────────────
  const seeded = await seedTasks(db, project.id, project.key, plan);

  // ── Backend ──────────────────────────────────────────────────────────────
  const secretSummaries = await listProjectSecrets(db, tenantId, project.id);
  const connectors = plan.requiredConnectors
    .map((c) => BUILTIN_CONNECTORS.get(c.key))
    .filter((m): m is NonNullable<typeof m> => !!m);

  const materialized = await materializeBackend({
    db,
    env,
    bucket,
    tenantId,
    projectId: project.id,
    projectName: project.name,
    connectors,
    secretNames: secretSummaries.map((s) => s.name),
    requiredSecretNames: plan.requiredSecrets.map((s) => s.name),
    strategy: plan.strategy,
  });
  filesWritten.push(...materialized.written);
  for (const err of materialized.handlerErrors) warnings.push(`${err.path}: ${err.reason}`);

  const connectorSteps = await missingConnectorSteps(db, tenantId, plan);

  // ── Start the work ───────────────────────────────────────────────────────
  // Last, and only after the system is materialised: an agent dispatched before
  // the handlers were written would open a repo that does not yet contain them.
  const tasksDispatched = args.runtimeService
    ? await dispatchBuildTasks(env, db, args.runtimeService, {
        tenantId,
        projectId: project.id,
        taskIds: seeded.buildTaskIds,
      })
    : 0;

  return {
    projectId: project.id,
    projectKey: project.key,
    ingressUrl,
    filesWritten,
    handlersWritten,
    tasksCreated: seeded.created,
    tasksSkipped: seeded.skipped,
    tasksDispatched,
    // Connectors first: a missing connection is what stops the system doing
    // anything at all, while a missing webhook URL only stops it being reached.
    readiness: [...connectorSteps, ...materialized.setupSteps],
    warnings,
  };
}
