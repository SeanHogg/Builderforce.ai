/**
 * Pure builder for the `execution.message` frame the relay DO forwards to a
 * connected agent host when a user steers a running execution from the portal.
 *
 * Kept separate from the Durable Object so the validation/shape is unit-testable
 * without WebSocket plumbing.
 */

export interface ExecutionMessageFrame {
  type: 'execution.message';
  executionId?: number;
  text: string;
  /** The steer's `execution_messages` row id. A host that cannot deliver the steer (the
   *  run already took its last turn) reports it back by this id, which is what makes the
   *  resulting follow-up run idempotent against a retried report. */
  messageId?: number;
}

export type BuildExecutionMessageResult =
  | { ok: true; frame: ExecutionMessageFrame }
  | { ok: false; error: 'text_required' };

export function buildExecutionMessageFrame(payload: unknown): BuildExecutionMessageResult {
  const p = (payload && typeof payload === 'object' ? payload : {}) as {
    executionId?: unknown;
    text?: unknown;
    messageId?: unknown;
  };
  const text = typeof p.text === 'string' ? p.text.trim() : '';
  if (!text) return { ok: false, error: 'text_required' };
  const executionId =
    typeof p.executionId === 'number' && Number.isFinite(p.executionId) ? p.executionId : undefined;
  const messageId =
    typeof p.messageId === 'number' && Number.isSafeInteger(p.messageId) && p.messageId > 0 ? p.messageId : undefined;
  return { ok: true, frame: { type: 'execution.message', executionId, text, ...(messageId != null ? { messageId } : {}) } };
}

/**
 * Pure builder for the `execution.cancel` frame the relay DO forwards to a
 * connected agent host when a user cancels a running execution. The host aborts
 * the live agent session (and, for V2, the in-flight SDK run) so cancel actually
 * halts work + token spend instead of only flipping the DB status.
 */
export interface ExecutionCancelFrame {
  type: 'execution.cancel';
  executionId?: number;
}

export function buildExecutionCancelFrame(payload: unknown): ExecutionCancelFrame {
  const p = (payload && typeof payload === 'object' ? payload : {}) as { executionId?: unknown };
  const executionId =
    typeof p.executionId === 'number' && Number.isFinite(p.executionId) ? p.executionId : undefined;
  return { type: 'execution.cancel', executionId };
}
