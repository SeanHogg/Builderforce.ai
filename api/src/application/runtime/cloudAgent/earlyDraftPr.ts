/**
 * earlyDraftPr — whether a run gets the early draft PR (`ci/draftPrForCi`), and the real ports it opens it with.
 *
 * Only a run whose branch CI is its ONLY build gets one: no sandbox (a sandbox builds for itself) and not a
 * delegated child (a child's branch work is absorbed by its owner, which owns the task's single PR). The
 * composition root calls this and hands the result to `cloudFinishPorts`, which stays free of infrastructure.
 */
import type { Db } from '../../../infrastructure/database/connection';
import type { TicketRepoContext } from '../../repos/commitFileAsPendingChange';
import { DRAFT_PR_TOOL, type DraftPrPorts } from '../../ci/draftPrForCi';
import { draftPrPorts } from '../../ci/draftPrPorts';
import { recordCloudToolEvent } from '../cloudToolEvents';
import type { CloudRunRefs } from '../cloudAdapterPorts';

export function earlyDraftPrFor(d: {
  db: Db; run: CloudRunRefs; repoCtx: TicketRepoContext | null; hasSandbox: boolean; delegated: boolean; taskTitle?: string;
}): { ports: DraftPrPorts } | undefined {
  const { db, run, repoCtx } = d;
  if (d.hasSandbox || d.delegated || !repoCtx) return undefined;
  return {
    ports: draftPrPorts({
      db, repoCtx, task: { id: run.taskId, title: d.taskTitle ?? `#${run.taskId}` }, agentLabel: run.agentLabel, tenantId: run.tenantId, executionId: run.executionId,
      record: (result, detail) => recordCloudToolEvent(db, {
        tenantId: run.tenantId, cloudAgentRef: run.cloudAgentRef, executionId: run.executionId,
        toolName: DRAFT_PR_TOOL, category: 'tool', detail: { ...detail, branch: repoCtx.branch }, result,
      }),
    }),
  };
}
