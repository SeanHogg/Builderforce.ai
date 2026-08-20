/**
 * incidentLearning — feed a resolved incident's lesson into the project's Evermind
 * model so the agent workforce LEARNS from incidents and stops repeating the actions
 * that cause them.
 *
 * On post-mortem, we distil the incident (root cause / what-went-wrong / resolution)
 * into a compact lesson and contribute it to the project's Evermind via the unified
 * text-learn producer (`dispatchProjectEvermindLearnText`). The `prompt` is phrased as
 * a task query about the affected system, because that is what Evermind recall matches
 * against at run time — so a future coding/incident run touching the same system
 * retrieves "we caused an incident doing X; avoid it".
 *
 * ── THE TENANT-WIDE INCIDENT ────────────────────────────────────────────────
 * There is no tenant-level Evermind corpus — the model's grain is a project — so
 * an incident opened WITHOUT a project used to contribute no lesson at all. That
 * is precisely the wrong direction: an incident nobody could attribute to a
 * project is usually an infrastructure or platform-wide one, which is the kind a
 * workforce most needs to not repeat.
 *
 * So a project-less incident falls back to the workspace's ANCHOR project — the
 * oldest active, non-IDE-storage project, which for the overwhelming majority of
 * workspaces is the Default project auto-provisioned at signup. The lesson says
 * so in its own text, because a lesson recalled inside a project it did not
 * happen in must not read as if it did.
 *
 * Best-effort: no-op when there is no env, no anchor project, or the project's
 * Evermind is unseeded/frozen (the dispatcher + coordinator DO gate that). Never
 * throws — a learning failure must not fail the post-mortem.
 */
import { and, asc, eq } from 'drizzle-orm';
import { dispatchProjectEvermindLearnText } from '../llm/projectEvermind';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { projects } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** Map incident severity to a learn weight — a worse incident teaches harder. */
function severityWeight(severity: string): number {
  switch (severity) {
    case 'sev1': return 3;
    case 'sev2': return 2;
    default: return 1;
  }
}

/**
 * The workspace's anchor project — where a lesson with no project of its own goes.
 *
 * Oldest ACTIVE, non-IDE-storage project: `is_ide_storage` rows are hidden
 * per-build containers rather than places a person works, and an anchor nobody
 * opens is a corpus nobody reads. Cached, because it changes about never and
 * this runs on a post-mortem.
 *
 * Exported so a second tenant-wide learner does not have to re-derive "which
 * project stands in for the workspace" and get a different answer.
 */
export async function resolveAnchorProjectId(env: Env, db: Db, tenantId: number): Promise<number | null> {
  const found = await getOrSetCached(
    env,
    `incident:anchor-project:${tenantId}`,
    async () => {
      const [row] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(
          eq(projects.tenantId, tenantId),
          eq(projects.status, 'active'),
          eq(projects.isIdeStorage, false),
        ))
        .orderBy(asc(projects.id))
        .limit(1);
      // `0` is the "no anchor" sentinel — getOrSetCached cannot cache `undefined`.
      return row?.id ?? 0;
    },
    { kvTtlSeconds: 300 },
  );
  return found > 0 ? found : null;
}

export interface IncidentLearningInput {
  projectId: number | null;
  title: string;
  severity: string;
  affectedSystem: string | null;
  rootCause: string | null;
  whatWentWrong?: string | null;
  resolution?: string | null;
}

/**
 * Record one incident lesson into the project's Evermind. Returns true when a learn
 * was dispatched (project + env present), false when skipped. Never throws.
 */
export async function recordIncidentLearning(
  env: Env | undefined,
  tenantId: number,
  input: IncidentLearningInput,
  /** Needed only for the tenant-wide fallback; omit and a project-less incident
   *  stays a no-op exactly as before. */
  db?: Db,
): Promise<boolean> {
  if (!env) return false;
  const projectId = input.projectId ?? (db ? await resolveAnchorProjectId(env, db, tenantId).catch(() => null) : null);
  if (projectId == null) return false;
  const tenantWide = input.projectId == null;
  const system = input.affectedSystem ?? 'this system';
  const lesson = [
    // Said out loud when it is true: a lesson recalled inside a project it did
    // not happen in must not read as if it did.
    tenantWide ? 'Workspace-wide incident (not attributed to any one project).' : '',
    `Incident: ${input.title} (${input.severity}${input.affectedSystem ? `, ${input.affectedSystem}` : ''}).`,
    input.rootCause ? `Root cause / action that caused it: ${input.rootCause}.` : '',
    input.whatWentWrong ? `What went wrong: ${input.whatWentWrong}.` : '',
    input.resolution ? `Resolution: ${input.resolution}.` : '',
    `Lesson: avoid repeating the cause above when working on ${system}.`,
  ].filter(Boolean).join(' ');
  const prompt = `Working on ${system}: what past incident should I avoid repeating?`;
  try {
    await dispatchProjectEvermindLearnText(env, tenantId, projectId, lesson, severityWeight(input.severity), prompt);
    return true;
  } catch {
    return false;
  }
}
