/**
 * WORK ATTRIBUTION for gateway and on-prem spend.
 *
 * `llm_usage_log` has carried `task_id` (0104) and `project_id` (0103) since the
 * cost rollups were built, and every rollup that matters reads them — cost per
 * ticket, cost per project, the PMO portfolio and planning-spine rollups, ROI. But
 * only ONE writer ever populated them: the cloud agent loop, which knows its own
 * execution's ticket. Every gateway chat call, every image generation, and every
 * on-prem host run wrote `attribution: { agentHostId }` and nothing else — so those
 * rows land with NULL ticket and NULL project and vanish from every per-work rollup.
 * The effect is not a gap in a chart; it is that "what did this ticket cost" silently
 * excludes the surface most of the spend actually goes through.
 *
 * A caller cannot simply be trusted with the ids. `task_id` and `project_id` are real
 * foreign keys, and an unvalidated hint lets any API key attribute its spend to
 * ANOTHER tenant's ticket — which would corrupt that tenant's cost rollup with
 * numbers it cannot see the source of. So every hint is checked against the
 * authenticated tenant before it is written, and a hint that does not belong is
 * DROPPED rather than rejected: attribution is a bookkeeping nicety, and failing a
 * paid completion over a stale ticket id in a header would be the worse trade.
 *
 * The checks are read-through cached, because they are the same two or three ids
 * over and over for a given client session and the alternative is two queries on
 * every gateway request.
 */

import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { projectInTenant } from '../project/projectOwnership';
import { taskInTenant } from '../../infrastructure/database/tenantScope';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** Ownership answers change only when a ticket/project is deleted or moved, which is
 *  rare and self-correcting (a stale `true` writes an id that is about to be
 *  `ON DELETE SET NULL`'d anyway). Five minutes is generous and still bounded. */
const OWNERSHIP_TTL_SECONDS = 300;

/** The ids a caller may hint, before validation. */
export interface UsageWorkHintInput {
  /** `x-builderforce-task-id` header, or `metadata.taskId` on the request body. */
  taskId?: unknown;
  /** `x-builderforce-project-id` header, or `metadata.projectId`. */
  projectId?: unknown;
}

/** Validated, tenant-owned ids ready to be written onto a usage row. */
export interface UsageWorkHints {
  taskId?: number;
  projectId?: number;
}

/** Accept an integer id from a header string or a JSON number; reject everything
 *  else (including 0 and negatives, which are never real ids). */
function parseId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Read work-attribution hints off a request, in precedence order: an explicit
 * header beats a `metadata` field, because a header is the deliberate integration
 * signal while `metadata` is a caller-controlled passthrough blob that may carry
 * anything. Neither is trusted yet — {@link resolveUsageWorkHints} does that.
 */
export function readUsageWorkHints(
  header: (name: string) => string | undefined,
  metadata: unknown,
): UsageWorkHintInput {
  const md = (typeof metadata === 'object' && metadata !== null ? metadata : {}) as Record<string, unknown>;
  return {
    taskId: header('x-builderforce-task-id') ?? md.taskId,
    projectId: header('x-builderforce-project-id') ?? md.projectId,
  };
}

/**
 * Validate hints against the authenticated tenant and return only what it owns.
 *
 * Returns `{}` — never throws — for absent, malformed, or foreign ids. A hint that
 * names another tenant's ticket is silently dropped, which is the point: the row
 * still records the spend, it simply does not claim a ticket it cannot prove.
 */
export async function resolveUsageWorkHints(
  env: Env,
  tenantId: number,
  input: UsageWorkHintInput,
): Promise<UsageWorkHints> {
  const taskId = parseId(input.taskId);
  const projectId = parseId(input.projectId);
  if (taskId === null && projectId === null) return {};

  const db = buildDatabase(env);
  const owns = async (kind: 'task' | 'project', id: number): Promise<boolean> => {
    try {
      return await getOrSetCached(
        env,
        `usagehint:${kind}:${tenantId}:${id}`,
        () => (kind === 'task' ? taskInTenant(db, id, tenantId) : projectInTenant(db, tenantId, id)),
        { kvTtlSeconds: OWNERSHIP_TTL_SECONDS },
      );
    } catch (error) {
      // Fail CLOSED on the attribution, open on the request: an unverifiable hint is
      // dropped (the row loses a nicety) rather than written (which could corrupt
      // another tenant's rollup) or thrown (which would fail a paid completion).
      reportCaughtError(error, { source: 'application/llm/usageWorkHints.ts', operation: 'resolveUsageWorkHints' });
      return false;
    }
  };

  const [taskOk, projectOk] = await Promise.all([
    taskId !== null ? owns('task', taskId) : Promise.resolve(false),
    projectId !== null ? owns('project', projectId) : Promise.resolve(false),
  ]);

  return {
    ...(taskId !== null && taskOk ? { taskId } : {}),
    ...(projectId !== null && projectOk ? { projectId } : {}),
  };
}
