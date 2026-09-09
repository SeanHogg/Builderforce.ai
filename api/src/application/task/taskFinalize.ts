/**
 * On task → Done, finalize the ticket: commit the accumulated changes, push the
 * branch, and open a PR. Best-effort + background — never blocks the caller.
 *
 * WHY IT IS IN THE APPLICATION LAYER. This lived in
 * `presentation/routes/taskRoutes` and the AI Manager imported it from there —
 * an inverted dependency arrow (see `check-application-layering`). It needs no
 * request: the board PATCH and the manager both already hand it `env`, `db`, the
 * tenant and the ticket. Both now import it from here.
 */
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { resolveDefaultRepoForTask } from '../repos/resolveDefaultRepo';
import { openTaskPullRequest } from '../repos/openTaskPullRequest';
import { recordCloudToolEvent } from '../runtime/cloudAgentEngine';
import type { Db } from '../../infrastructure/database/connection';
import type { HonoEnv } from '../../env';

/** Minimal shape of the agentHost relay Durable Object namespace binding. */
type RelayNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> };
};

/** The task fields the Done-transition finalize needs to pick host vs cloud path. */
type FinalizeTask = {
  assignedAgentHostId?: number | null;
  assignedAgentRef?: string | null;
  gitBranch?: string | null;
  githubPrUrl?: string | null;
  title?: string | null;
};

/**
 * On task → Done, finalize the ticket: commit the accumulated changes, push the
 * branch, and open a PR. Best-effort + background — never blocks the PATCH.
 *
 * Two finalize surfaces, picked by who the task is assigned to:
 *  - Self-hosted host (`assignedAgentHostId`): the host holds the on-disk ticket
 *    workspace, so we relay it a `task.finalize` message and IT commits/pushes/PRs.
 *  - Cloud agent (`assignedAgentRef`): there is no on-disk workspace — the agent
 *    committed each `write_file` straight onto the ticket branch via the provider
 *    API during the run, so the branch is already pushed. We just open the PR
 *    server-side from that branch. Guarded on `gitBranch` (nothing committed → no
 *    PR) and a missing `githubPrUrl` (the inline run-end finalize may have already
 *    opened it — never double-open).
 * A task with neither assignee is a no-op.
 */
export async function dispatchTaskFinalize(
  env: HonoEnv['Bindings'],
  db: Db,
  tenantId: number,
  taskId: number,
  task: FinalizeTask,
): Promise<void> {
  const title = task.title ?? '';

  if (task.assignedAgentHostId != null) {
    const relay = (env as unknown as { AGENT_HOST_RELAY?: RelayNamespace }).AGENT_HOST_RELAY;
    if (!relay) return;
    const repoRef = await resolveDefaultRepoForTask(db, tenantId, taskId).catch(() => null);
    try {
      const stub = relay.get(relay.idFromName(String(task.assignedAgentHostId)));
      await stub.fetch('https://relay.internal/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'task.finalize',
          taskId,
          title,
          repo: repoRef ? { repoId: repoRef.repoId, defaultBranch: repoRef.defaultBranch } : null,
        }),
      });
    } catch (error) { /* host offline / relay miss — branch can be finalized manually */ 
      reportCaughtError(error, { source: "application/task/taskFinalize.ts", operation: "dispatchTaskFinalize" });
    }
    return;
  }

  // Cloud agent: open the PR from the already-pushed ticket branch. Skip when the
  // agent never committed (no branch) or a PR already exists (inline finalize).
  // The duplicate-PR race (this human-drag vs. a concurrent inline run-end
  // finalize) is closed inside openTaskPullRequest by an atomic claim (0140); the
  // `!githubPrUrl` check below is just a cheap pre-filter, not the guard.
  if (task.assignedAgentRef && task.gitBranch && !task.githubPrUrl) {
    const e = env as unknown as { INTEGRATION_ENCRYPTION_SECRET?: string; JWT_SECRET?: string };
    const secret = integrationCredentialSecret(e);
    try {
      const res = await openTaskPullRequest(db, secret, tenantId, taskId, { branch: task.gitBranch, title }, env);
      // Uniform PR observability: emit a TASK-scoped `pr_opened` event (no live
      // execution on the Done-transition path) so a manually-completed cloud
      // ticket shows the same timeline event as an execution-finalized one. Keyed
      // to the agent ref so it surfaces in that agent's tool-audit timeline.
      if (res.ok) {
        await recordCloudToolEvent(db, {
          tenantId,
          cloudAgentRef: task.assignedAgentRef,
          executionId: null,
          sessionKey: `task:${taskId}`,
          toolName: 'pr_opened',
          category: 'tool',
          detail: { taskId, branch: task.gitBranch, source: 'done-finalize' },
          result: `opened PR #${res.number}${res.merged ? ' (auto-merged)' : ' — awaiting review'}`.slice(0, 300),
        });
      }
    } catch (error) { /* best-effort — PR can be opened manually from the pushed branch */ 
      reportCaughtError(error, { source: "application/task/taskFinalize.ts", operation: "dispatchTaskFinalize" });
    }
  }
}
