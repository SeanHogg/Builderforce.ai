/**
 * Shared data shapes for the brain core. These define the contract the host
 * persistence adapter conforms to — they mirror the Builderforce `/api/brain`
 * payloads but are owned here so the package has no dependency on the app.
 */

/** A brain chat (conversation) record. */
export interface BrainChat {
  id: number;
  title: string;
  projectId: number | null;
  /** Where the chat was created (e.g. 'brainstorm' | 'ide' | 'project'). */
  origin?: string;
  createdAt: string;
  updatedAt: string;
}

/** A single message within a chat. */
export interface BrainMessage {
  id: number;
  role: string;
  content: string;
  metadata: string | null;
  seq: number;
  createdAt: string;
}

/** An uploaded attachment reference attached to an outgoing message. */
export interface ChatInputAttachment {
  key: string;
  name: string;
  type: string;
  /**
   * Model-visible image source for vision turns — a `data:` URL (inlined small
   * images) or a short-lived signed public URL (large images). Present only for
   * raster images; when set, the attachment becomes an `image_url` content part
   * the vision model can actually see, instead of a plain text link.
   */
  imageUrl?: string;
}

/**
 * Modality is a free-form string in the core (e.g. 'designer' | 'video' | 'llm').
 * The host maps it to a system prompt via `BrainConfig.resolveSystemPrompt`.
 */
export type BrainModality = string;
