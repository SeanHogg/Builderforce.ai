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
}

export type BuildExecutionMessageResult =
  | { ok: true; frame: ExecutionMessageFrame }
  | { ok: false; error: 'text_required' };

export function buildExecutionMessageFrame(payload: unknown): BuildExecutionMessageResult {
  const p = (payload && typeof payload === 'object' ? payload : {}) as {
    executionId?: unknown;
    text?: unknown;
  };
  const text = typeof p.text === 'string' ? p.text.trim() : '';
  if (!text) return { ok: false, error: 'text_required' };
  const executionId =
    typeof p.executionId === 'number' && Number.isFinite(p.executionId) ? p.executionId : undefined;
  return { ok: true, frame: { type: 'execution.message', executionId, text } };
}
