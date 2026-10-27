/**
 * Attachments on the way IN to a turn — the two steps `useBrainConversation` used to do
 * inline, kept here so that hook does not grow:
 *
 *   • {@link prepareAttachment}: a picked / dropped / pasted file becomes a pending
 *     attachment. A picture is prepared FIRST (`imagePrep.ts`) so the re-encoded copy —
 *     not the full-size original — is what gets uploaded; a picture too large to inline
 *     is handed over by a signed URL. A host that cannot give it one says so with an
 *     {@link AttachmentRefusedError}, which reaches the person instead of a dead link.
 *   • {@link attachmentTurnContent}: the model-visible content of a turn. Pictures become
 *     `image_url` vision parts; attachments the host can READ (`inlineAttachments` — the
 *     editor's text files and "Add context") become fenced text under the mention budget;
 *     anything else stays a link. With neither, it is exactly the display text.
 */

import type { BrainPersistenceAdapter } from './config';
import { prepareImageDataUrl, type ImagePrepOptions, type PreparedImage } from './imagePrep';
import type { ContentPart } from './streamChatCompletion';
import type { ChatInputAttachment } from './types';

/** A text file larger than this is never read to be inlined (it would be cut to the
 *  mention budget anyway): a host uploads it, or leaves it to a tool. */
export const MAX_INLINE_TEXT_BYTES = 2_000_000;

/**
 * A host's refusal to make an attachment model-readable, worded for the person (e.g. a
 * large picture while signed out). Thrown by an adapter; {@link prepareAttachment} lets
 * it through where any other failure falls back to the text link.
 */
export class AttachmentRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentRefusedError';
  }
}

/** The link a turn names a not-inlined attachment by. */
export function attachmentLink(a: Pick<ChatInputAttachment, 'key' | 'name'>, uploadUrl: (key: string) => string): string {
  return `[Attached: ${a.name}](${uploadUrl(a.key)})`;
}

/** Upload one file (the prepared picture in place of the original) as a pending attachment. */
export async function prepareAttachment(
  file: File,
  persistence: Pick<BrainPersistenceAdapter, 'upload' | 'signedUploadUrl' | 'keepLocal'>,
  imagePrep?: ImagePrepOptions,
): Promise<ChatInputAttachment> {
  let prepared: PreparedImage | null = null;
  try {
    prepared = await prepareImageDataUrl(file, imagePrep);
  } catch {
    // Non-fatal: an undecodable picture is attached as it is, behind a link.
    prepared = null;
  }
  const kept = prepared?.file ?? file;
  // A picture that rides inline needs no platform copy: a host that can keep it local
  // does (the editor — nothing leaves the machine for a picture the model sees inline).
  const result = prepared?.dataUrl && persistence.keepLocal ? await persistence.keepLocal(kept) : await persistence.upload(kept);
  // The person attached `file`: a re-encode keeps its name on screen.
  const attachment: ChatInputAttachment = { key: result.key, name: prepared?.file ? file.name : result.name, type: result.type };
  if (prepared?.dataUrl) {
    attachment.imageUrl = prepared.dataUrl;
  } else if (prepared?.tooLarge && persistence.signedUploadUrl) {
    try {
      attachment.imageUrl = await persistence.signedUploadUrl(result.key);
    } catch (e) {
      if (e instanceof AttachmentRefusedError) throw e;
      /* otherwise non-fatal: fall back to the text-link path */
    }
  }
  return attachment;
}

/**
 * The model-visible content of a user turn: `trimmed` plus its attachments. Without a
 * picture or an inlined attachment it is the same string the display shows.
 */
export async function attachmentTurnContent(
  trimmed: string,
  attachments: readonly ChatInputAttachment[],
  persistence: Pick<BrainPersistenceAdapter, 'uploadUrl' | 'inlineAttachments'>,
): Promise<string | ContentPart[]> {
  const images = attachments.filter((a) => a.imageUrl);
  const readable = attachments.filter((a) => !a.imageUrl);
  let inlined: { text: string; keys: ReadonlySet<string> } = { text: '', keys: new Set() };
  if (readable.length > 0 && persistence.inlineAttachments) {
    try {
      const r = await persistence.inlineAttachments(readable);
      if (r && r.text) inlined = { text: r.text, keys: new Set(r.keys) };
    } catch {
      // The host could not read them: they stay links.
      inlined = { text: '', keys: new Set() };
    }
  }
  const links = readable.filter((a) => !inlined.keys.has(a.key)).map((a) => attachmentLink(a, persistence.uploadUrl)).join('\n');
  if (images.length === 0) {
    if (attachments.length === 0) return trimmed;
    if (!inlined.text) return `${trimmed}\n\n${links}`;
    return [trimmed, links, inlined.text].filter(Boolean).join('\n\n');
  }
  return [
    { type: 'text', text: [trimmed, links, inlined.text].filter(Boolean).join('\n\n') },
    ...images.map((a) => ({ type: 'image_url' as const, image_url: { url: a.imageUrl! } })),
  ];
}
