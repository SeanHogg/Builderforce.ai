/**
 * Chat message content that is not only text: OpenAI-style content parts (`text` |
 * `image_url`), which the gateway accepts and forwards to a vision-capable model. A kept
 * module apart from `gateway.ts` so the text-only paths (an on-device model) have one
 * place that says "this message carries an image".
 */

import type { VisionContentPart } from "@builderforce/agent-tools/knowledge";
import type { ChatMessage } from "./gateway";

/** The ONE content-part type (agent-tools `pinpointMatch.ts`). */
export type ChatContentPart = VisionContentPart;

/** A message whose content is text only - what an on-device runtime takes. */
export type TextChatMessage = Omit<ChatMessage, "content"> & { content: string | null };

export const IMAGE_NEEDS_GATEWAY = "This needs a model that can read images, and the model on this machine takes text only.";

export function hasImageParts(messages: readonly ChatMessage[]): boolean {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((part) => part.type === "image_url"));
}

/** The messages as text: content parts are joined, an image is refused (never silently dropped). */
export function textOnly(messages: readonly ChatMessage[]): TextChatMessage[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m as TextChatMessage;
    if (m.content.some((part) => part.type === "image_url")) throw new Error(IMAGE_NEEDS_GATEWAY);
    return { ...m, content: m.content.map((part) => (part.type === "text" ? part.text : "")).join("\n") };
  });
}
