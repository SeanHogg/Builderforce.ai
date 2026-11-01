/**
 * The Brain's transcript rows in the agent's shape (the inverse of `toStreamMessage`, `modelTransport.ts`). A row's
 * `content` stays its TEXT; a picture on a row rides `RunMessage.parts` (`imagePartsOf` / `withImages`, the one pair that
 * moves pictures between the two shapes).
 */

import type { RunMessage, RunPart } from '@builderforce/agent-run';
import type { ChatCompletionMessage, ContentPart } from '../streamChatCompletion';
import { contentText } from '../localSuccess/turnFeatures';

const imagePart = (part: Extract<ContentPart, { type: 'image_url' }>): RunPart => ({ type: 'image', url: part.image_url.url, ...(part.image_url.detail ? { detail: part.image_url.detail } : {}) });
const imageContent = (part: Extract<RunPart, { type: 'image' }>): ContentPart => ({ type: 'image_url', image_url: { url: part.url, ...(part.detail ? { detail: part.detail } : {}) } });

/** The pictures a Brain row (or steer) carries, as the agent's parts. */
export function imagePartsOf(content: string | readonly ContentPart[]): RunPart[] {
  return typeof content === 'string' ? [] : content.flatMap((part): RunPart[] => (part.type === 'image_url' ? [imagePart(part)] : []));
}

/**
 * The Brain's content for text plus the pictures that rode beside it: the plain string when there are none. A row whose parts
 * carry text too (a vision turn the turn-context block was appended to: `[text, image, block]`) is rebuilt part by part, in order.
 */
export function withImages(text: string, parts: readonly RunPart[] | undefined): string | ContentPart[] {
  const all = parts ?? [];
  if (all.some((part) => part.type === 'text')) {
    return all.flatMap((part): ContentPart[] => (part.type === 'text' ? [{ type: 'text', text: part.text }] : part.type === 'image' ? [imageContent(part)] : []));
  }
  const images = all.flatMap((part): ContentPart[] => (part.type === 'image' ? [imageContent(part)] : []));
  return images.length > 0 ? [{ type: 'text', text }, ...images] : text;
}

export function toRunMessage(row: ChatCompletionMessage): RunMessage {
  const r = row as ChatCompletionMessage & { tool_call_id?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
  const content = contentText(r.content);
  if (r.role === 'tool') return { role: 'tool', content, ...(r.tool_call_id ? { toolCallId: r.tool_call_id } : {}) };
  if (r.role === 'assistant' && r.tool_calls?.length) {
    return { role: 'assistant', content, toolCalls: r.tool_calls.map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })) };
  }
  // A vision row keeps its parts in order, text included, so it reaches the wire as the shape the host built (`withImages`).
  const parts: RunPart[] = typeof r.content === 'string' || !r.content.some((p) => p.type === 'image_url')
    ? []
    : r.content.map((p): RunPart => (p.type === 'image_url' ? imagePart(p) : { type: 'text', text: p.text }));
  return { role: r.role as RunMessage['role'], content, ...(parts.length > 0 ? { parts } : {}) };
}
