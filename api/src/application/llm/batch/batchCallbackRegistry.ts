/**
 * THE callback registry — each `BatchCallbackKind` → the handler that does what its
 * synchronous caller did. Data, not a switch: a new deferred call site is a kind in
 * `batchTypes.ts`, a policy row in `batchTarget.ts` and an entry here; the `Record` type
 * makes a missing handler a compile error.
 */
import { agentHostSessionBatchHandler, projectMemoryBatchHandler } from '../../brain/brainMemory';
import { taskActionTypeBatchHandler } from '../classifyTask';
import { evermindTeacherBatchHandler } from '../evermindDistillation';
import type { BatchCallbackHandler } from './batchCallbacks';
import type { BatchCallbackKind } from './batchTypes';

export const BATCH_CALLBACKS: Readonly<Record<BatchCallbackKind, BatchCallbackHandler>> = {
  task_action_type: taskActionTypeBatchHandler,
  project_memory: projectMemoryBatchHandler,
  agent_host_session_summary: agentHostSessionBatchHandler,
  evermind_teacher: evermindTeacherBatchHandler,
};
