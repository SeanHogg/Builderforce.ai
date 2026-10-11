/**
 * A cloud run's delegated child, reporting back into the Brain chat that launched the run.
 *
 * The editor posts each finished child into its chat; the cloud did not, so a cloud run
 * that fanned four tickets out to four children read in the chat as silence until the
 * parent summarised them. This is the cloud's half of the same contract: one message per
 * child, the moment it is back, in the words `subagentReportMessage` uses everywhere.
 *
 * Posted through `postExecutionUpdate` — the same verified, agent-attributed write
 * `chats.post_to_brain` uses — so a report can only land in the run's own originating
 * chat. ONE helper for the durable surface and the image surfaces' `spawn` op.
 */

import { subagentReportMessage } from '@builderforce/agent-loop';
import type { SubagentRequest, SubagentResult } from '@builderforce/agent-tools';
import { BrainService } from '../brain/BrainService';
import type { Db } from '../../infrastructure/database/connection';
import type { SubagentDeps } from './cloudSubagent';

/**
 * The `report` port for `buildOrchestrationCapability`, spread into its deps — empty when
 * the run has no chat to report into (a board-started run) or no agent to attribute the
 * post to.
 */
export function subagentChatReport(
  db: Db,
  tenantId: number,
  originatingChatId: number | undefined,
  agentRef: string | null | undefined,
  agentName?: string,
): Pick<SubagentDeps, 'report'> {
  if (originatingChatId == null || !agentRef) return {};
  const report = async (input: SubagentRequest, result: SubagentResult): Promise<void> => {
    await new BrainService(db).postExecutionUpdate(originatingChatId, tenantId, {
      agentRef,
      ...(agentName ? { agentName } : {}),
      content: subagentReportMessage({ ...result, label: input.label, ...(input.ticket ? { ticket: input.ticket } : {}) }),
    });
  };
  return { report };
}
