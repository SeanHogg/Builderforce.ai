/**
 * Pure validator for the frame `POST /dispatch` forwards to a connected agent host,
 * the sibling of `executionMessage.ts` for the steer / cancel frames. A rejected frame
 * is answered 400 by the relay and written to the run's timeline by the dispatcher
 * (`dispatchToAgentHost`'s `onRejected`), never dropped silently.
 *
 * `/dispatch` is the relay's generic "forward this frame upstream" door and carries many
 * frame kinds (approvals, repo operations, broadcasts), so only the frame that STARTS
 * work is shape-checked here: a `task.assign` the host cannot act on (no task, a
 * non-numeric execution id) used to be delivered anyway and fail on the host with no
 * trace on the server. Every other frame type passes through unchanged.
 */

export type DispatchFrameError =
  | 'task_required'
  | 'task_title_required'
  | 'execution_id_invalid'
  | 'task_id_invalid'
  | 'payload_invalid';

export type ValidateDispatchFrameResult =
  | { ok: true; frame: unknown }
  | { ok: false; error: DispatchFrameError };

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function validateDispatchFrame(frame: unknown): ValidateDispatchFrameResult {
  const f = frame && typeof frame === 'object' ? (frame as Record<string, unknown>) : null;
  if (!f || f.type !== 'task.assign') return { ok: true, frame };

  const task = f.task && typeof f.task === 'object' ? (f.task as Record<string, unknown>) : null;
  if (!task) return { ok: false, error: 'task_required' };
  if (typeof task.title !== 'string' || task.title.trim() === '') return { ok: false, error: 'task_title_required' };
  if (f.executionId !== undefined && !isPositiveInt(f.executionId)) return { ok: false, error: 'execution_id_invalid' };
  if (f.taskId !== undefined && !isPositiveInt(f.taskId)) return { ok: false, error: 'task_id_invalid' };
  if (f.payload !== undefined && f.payload !== null && typeof f.payload !== 'string') return { ok: false, error: 'payload_invalid' };
  return { ok: true, frame };
}
