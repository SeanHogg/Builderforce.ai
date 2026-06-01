'use client';

import { ChatMessageContent } from '@/components/ChatMessageContent';

export interface LegalDocPreviewProps {
  /** Document body (Markdown). */
  content: string | null | undefined;
  /** Rendered (as Markdown) when there is no content yet. */
  emptyText?: string;
}

/**
 * Shared Markdown preview control for legal documents (Terms + Privacy).
 *
 * Both doc types use the same Markdown syntax, so every place that previews a
 * legal doc — the admin "current doc" cards, the editor drawer preview toggle,
 * and the public footer modal — renders through this single control to stay in
 * lockstep. The container/layout (scroll height, borders) is the caller's
 * concern; the rendered output is always identical.
 */
export function LegalDocPreview({ content, emptyText = '_Nothing to preview yet._' }: LegalDocPreviewProps) {
  return <ChatMessageContent content={content?.trim() ? content : emptyText} />;
}
