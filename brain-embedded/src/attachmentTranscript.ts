/**
 * A user turn with attachments, as it is RECORDED and as it is SENT AGAIN.
 *
 * What the person sees and what the model read differ: the display names each attachment
 * by a link (in the editor a webview `blob:` preview, dead the moment the panel reloads),
 * while the model read the attachments' inlined text (`attachmentTurnContent`). Only the
 * display used to be persisted, so the next run's transcript, a retry, and an auto-reply
 * after a reload all sent the model a dead link in place of the text it had read — and
 * the changed prefix missed the prompt cache.
 *
 * So the model-visible text is kept in the turn's metadata ({@link MODEL_TEXT_META_KEY}),
 * and every re-send reads it back: the transcript seed ({@link userTurnTextOf}) and a
 * re-run of the turn itself ({@link userTurnContentOf}, with the inline pictures it was
 * sent with). A `blob:` URL is never recorded or re-sent as model content.
 */

import { attachmentTurnContent } from './attachmentContent';
import type { BrainPersistenceAdapter } from './config';
import type { ContentPart } from './streamChatCompletion';
import type { BrainMessage, ChatInputAttachment } from './types';

/** The metadata field holding a user turn's model-visible text. */
export const MODEL_TEXT_META_KEY = 'modelText';

const BLOB_LINK = /\[([^\]\n]*)\]\(blob:[^)\s]*\)/g;

/** `text` with every markdown link to a `blob:` URL reduced to its label. */
export function withoutBlobLinks(text: string): string {
  return text.replace(BLOB_LINK, '[$1]');
}

/** The text part(s) of model content, without `blob:` links — what a turn records. */
export function recordedModelText(content: string | ContentPart[]): string {
  const text = typeof content === 'string'
    ? content
    : content.filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text').map((p) => p.text).join('\n\n');
  return withoutBlobLinks(text);
}

/** A user turn about to be sent: the model content, and the metadata that records it. */
export interface AttachmentTurn {
  content: string | ContentPart[];
  /** Metadata fields for the persisted turn; undefined with no attachments. */
  meta: Record<string, unknown> | undefined;
}

/**
 * The model content of a turn and what its persisted row records: the attachments, and
 * the model-visible text whenever it is not the displayed text itself.
 */
export async function attachmentTurn(
  trimmed: string,
  displayContent: string,
  attachments: readonly ChatInputAttachment[],
  persistence: Pick<BrainPersistenceAdapter, 'uploadUrl' | 'inlineAttachments'>,
): Promise<AttachmentTurn> {
  if (attachments.length === 0) return { content: trimmed, meta: undefined };
  const content = await attachmentTurnContent(trimmed, attachments, persistence);
  const modelText = recordedModelText(content);
  return {
    content,
    meta: { attachments: [...attachments], ...(modelText !== displayContent ? { [MODEL_TEXT_META_KEY]: modelText } : {}) },
  };
}

function metaOf(m: Pick<BrainMessage, 'metadata'>): Record<string, unknown> | null {
  if (!m.metadata) return null;
  try {
    const parsed = JSON.parse(m.metadata) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The text the model reads for a persisted user turn: its recorded model text, else its
 *  content — never with a `blob:` link. */
export function userTurnTextOf(m: Pick<BrainMessage, 'content' | 'metadata'>): string {
  const recorded = metaOf(m)?.[MODEL_TEXT_META_KEY];
  return withoutBlobLinks(typeof recorded === 'string' ? recorded : m.content);
}

/**
 * The model content to run a persisted user turn again (a retry, an auto-reply after a
 * reload): its recorded text, plus the pictures it was sent with inline (`data:` URLs —
 * a signed URL has expired by then, and is left out).
 */
export function userTurnContentOf(m: Pick<BrainMessage, 'content' | 'metadata'>): string | ContentPart[] {
  const text = userTurnTextOf(m);
  const attachments = metaOf(m)?.attachments;
  const images = Array.isArray(attachments)
    ? attachments
      .map((a) => (a && typeof a === 'object' ? (a as { imageUrl?: unknown }).imageUrl : undefined))
      .filter((url): url is string => typeof url === 'string' && url.startsWith('data:'))
    : [];
  if (images.length === 0) return text;
  return [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))];
}
