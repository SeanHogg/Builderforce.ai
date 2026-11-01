/**
 * The Brain's transcript rows in the agent's shape (the inverse of `toStreamMessage`, `modelTransport.ts`). A row's
 * `content` stays its TEXT; a picture on a row rides `RunMessage.parts` (`imagePartsOf` / `withImages`, the one pair that
 * moves pictures between the two shapes).
 */

import type { RunMessage, RunPart } from '@builderforce/agent-run';
import type { ChatCompletionMessage, ContentPart } from '../streamChatCompletion';
import { contentText } from '../localSuccess/turnFeatures';

/** The pictures a Brain row (or steer) carries, as the agent's parts. */
export function imagePartsOf(content: string | readonly ContentPart[]): RunPart[] {
  return typeof content === 'string' ? [] : content.flatMap((part): RunPart[] => (part.type === 'image_url' ? [{ type: 'image', url: part.image_url.url }] : []));
}

/** The Brain's content for text plus the pictures that rode beside it: the plain string when there are none. */
export function withImages(text: string, parts: readonly RunPart[] | undefined): string | ContentPart[] {
  const images = (parts ?? []).flatMap((part): ContentPart[] => (part.type === 'image' ? [{ type: 'image_url', image_url: { url: part.url } }] : []));
  return images.length > 0 ? [{ type: 'text', text }, ...images] : text;
}

export function toRunMessage(row: ChatCompletionMessage): RunMessage {
  const r = row as ChatCompletionMessage & { tool_call_id?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
  const content = contentText(r.content);
  if (r.role === 'tool') return { role: 'tool', content, ...(r.tool_call_id ? { toolCallId: r.tool_call_id } : {}) };
  if (r.role === 'assistant' && r.tool_calls?.length) {
    return { role: 'assistant', content, toolCalls: r.tool_calls.map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })) };
  }
  const parts = imagePartsOf(r.content);
  return { role: r.role as RunMessage['role'], content, ...(parts.length > 0 ? { parts } : {}) };
}
