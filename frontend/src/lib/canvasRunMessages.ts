import type { ChatCompletionMessage } from '@seanhogg/builderforce-brain-embedded';
import type { RunMessage } from '@builderforce/agent-run';
import { toOpenAiToolCall } from '@builderforce/agent-loop';

/**
 * The two shapes a canvas transcript takes: the gateway's chat rows (what the stream
 * client sends) and the one agent's rows (what `runAgent` keeps in its saved state).
 * The conversion is the whole of this module — a row means the same in both.
 */

/** A chat row's text. A canvas row is a string; a multimodal part list keeps only its text parts. */
function textOf(content: ChatCompletionMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

/** The chat rows a turn opens with, as the one agent's transcript. */
export function toRunMessages(messages: readonly ChatCompletionMessage[]): RunMessage[] {
  return messages.map((message): RunMessage => {
    if (message.role === 'tool') {
      return { role: 'tool', content: textOf(message.content), ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}) };
    }
    const toolCalls = message.tool_calls?.map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments }));
    return { role: message.role, content: textOf(message.content), ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}) };
  });
}

/** The one agent's transcript, as the chat rows the stream client sends. */
export function toChatMessages(messages: readonly RunMessage[]): ChatCompletionMessage[] {
  return messages.map((message): ChatCompletionMessage => {
    if (message.role === 'tool') {
      return { role: 'tool', content: message.content, ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}) };
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return { role: 'assistant', content: message.content, tool_calls: message.toolCalls.map(toOpenAiToolCall) };
    }
    return { role: message.role, content: message.content };
  });
}
