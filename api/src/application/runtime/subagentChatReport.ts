/**
 * A cloud sub-agent, reporting back into the Brain chat its tree was launched from.
 *
 * The editor posts each finished child into its chat; this is the cloud's half of the
 * same contract: one message per child, the moment it ends, in the words
 * `subagentReportMessage` uses everywhere. Posted through `postExecutionUpdate` — the
 * same verified, agent-attributed write `chats.post_to_brain` uses — so a report can only
 * land in the run's own originating chat.
 */

import { subagentReportMessage, type SubagentReportLike } from '@builderforce/agent-loop';
import { BrainService } from '../brain/BrainService';
import type { Db } from '../../infrastructure/database/connection';

/** Post one child's report. A no-op when the run has no chat (a board-started run) or no agent to attribute it to. */
export async function postSubagentChatReport(
  db: Db,
  tenantId: number,
  originatingChatId: number | undefined,
  agentRef: string | null | undefined,
  report: SubagentReportLike,
): Promise<void> {
  if (originatingChatId == null || !agentRef) return;
  await new BrainService(db).postExecutionUpdate(originatingChatId, tenantId, {
    agentRef,
    content: subagentReportMessage(report),
  });
}
