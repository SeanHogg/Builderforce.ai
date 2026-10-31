/**
 * The Brain's transcript rows in the agent's shape (the inverse of `toStreamMessage`, `modelTransport.ts`). A row's
 * `content` stays its TEXT; a picture on a row rides `RunMessage.parts` once that lands for this port.
 */

import type { RunMessage } from '@builderforce/agent-run';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { contentText } from '../localSuccess/turnFeatures';

export function toRunMessage(row: ChatCompletionMessage): RunMessage {
  const r = row as ChatCompletionMessage & { tool_call_id?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
  const content = contentText(r.content);
  if (r.role === 'tool') return { role: 'tool', content, ...(r.tool_call_id ? { toolCallId: r.tool_call_id } : {}) };
  if (r.role === 'assistant' && r.tool_calls?.length) {
    return { role: 'assistant', content, toolCalls: r.tool_calls.map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })) };
  }
  return { role: r.role as RunMessage['role'], content };
}
