/**
 * openDispatchPullRequest — open a PR for a coding dispatch and record it.
 *
 * Shared by BOTH executors so the close-the-loop behaviour is identical:
 *  - the browser worker calls it via the tenant-JWT /api/agent-runtime route, and
 *  - a headless agentHost calls it via the host-authed /api/agent-hosts route.
 *
 * It resolves the dispatch's default repo, opens the PR server-side with the
 * decrypted credential (the token never leaves the server), records the PR, and
 * writes it back onto the task so the kanban card surfaces it.
 */
import { and, eq } from 'drizzle-orm';
import { agentDispatches } from '../../infrastructure/database/schema';
import { openTaskPullRequest, type OpenTaskPrInput, type OpenTaskPrResult } from './openTaskPullRequest';
import type { Db } from '../../infrastructure/database/connection';

export type OpenDispatchPrInput = OpenTaskPrInput;
export type OpenDispatchPrResult = OpenTaskPrResult;

export async function openDispatchPullRequest(
  db: Db,
  secret: string,
  tenantId: number,
  dispatchId: string,
  input: OpenDispatchPrInput,
): Promise<OpenDispatchPrResult> {
  if (!input.branch || typeof input.branch !== 'string') {
    return { ok: false, status: 400, error: 'branch is required' };
  }

  const [dispatch] = await db
    .select({ id: agentDispatches.id, taskId: agentDispatches.taskId, role: agentDispatches.role })
    .from(agentDispatches)
    .where(and(eq(agentDispatches.id, dispatchId), eq(agentDispatches.tenantId, tenantId)))
    .limit(1);
  if (!dispatch) return { ok: false, status: 404, error: 'Dispatch not found' };
  if (dispatch.taskId == null) return { ok: false, status: 409, error: 'No repo bound to this dispatch task' };

  return openTaskPullRequest(db, secret, tenantId, dispatch.taskId, {
    ...input,
    title: (input.title ?? '').trim() || `Agent changes for ${dispatch.role} (#${dispatch.taskId})`,
  });
}
