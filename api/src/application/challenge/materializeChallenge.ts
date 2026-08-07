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
import { ensureProjectBackend, ingressUrlFor, materializeBackend } from '../backend';
import { listProjectSecrets } from '../secrets/projectSecrets';
import { BUILTIN_CONNECTORS } from '../connectors/defaults';
import { connectorConnections } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
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
): Promise<{ created: number; skipped: number }> {
  const existing = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));
  const seen = new Set(existing.map((t) => t.title.trim().toLowerCase()));

  let seq = await nextProjectKeySeqBase(db, projectId);
  let created = 0;
  let skipped = 0;

  for (const task of [...plan.tasks].sort((a, b) => a.order - b.order)) {
    if (seen.has(task.title.trim().toLowerCase())) {
      skipped++;
      continue;
    }
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      try {
        await db.insert(tasks).values({
          projectId,
          key: formatTaskKey(projectKey, seq),
          title: task.title.slice(0, 500),
          description: task.description,
          status: 'backlog',
          priority: 'medium',
        });
        inserted = true;
        created++;
        seen.add(task.title.trim().toLowerCase());
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
  return { created, skipped };
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
    if (write.ok) handlersWritten.push(path);
    else warnings.push(`Could not write ${path}: ${write.reason}`);
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

  return {
    projectId: project.id,
    projectKey: project.key,
    ingressUrl,
    filesWritten,
    handlersWritten,
    tasksCreated: seeded.created,
    tasksSkipped: seeded.skipped,
    // Connectors first: a missing connection is what stops the system doing
    // anything at all, while a missing webhook URL only stops it being reached.
    readiness: [...connectorSteps, ...materialized.setupSteps],
    warnings,
  };
}
