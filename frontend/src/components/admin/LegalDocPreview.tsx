'use client';

import { useTranslations } from 'next-intl';
import { DocumentMarkdown } from '@/components/DocumentMarkdown';
import { unwrapMarkdownFence } from '@/lib/utils';

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
 *
 * Renders at *document* scale via {@link DocumentMarkdown} (not the chat
 * renderer), so a multi-page Terms/Privacy doc reads like a document.
 */
export function LegalDocPreview({ content, emptyText }: LegalDocPreviewProps) {
  const t = useTranslations('admin');
  const fallback = emptyText ?? t('legal.preview.nothingToPreview');
  const clean = content?.trim() ? unwrapMarkdownFence(content) : fallback;
  return <DocumentMarkdown content={clean} />;
}
