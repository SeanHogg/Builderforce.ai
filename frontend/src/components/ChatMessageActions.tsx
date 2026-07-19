'use client';

import { useTranslations } from 'next-intl';
import { ChatProjectActions } from './ChatProjectActions';
import { BrainMessageExport } from './brain/BrainMessageExport';

export interface ChatMessageActionsProps {
  onCopy: () => void;
  copied?: boolean;
  /** When provided, thumbs up/down are shown and call this. Omit to hide feedback buttons (e.g. IDE project chat). */
  feedback?: 'up' | 'down';
  onFeedback?: (value: 'up' | 'down') => void;
  /** When provided, show PRD / Add tasks actions. */
  projectId?: number;
  assistantContent: string;
  conversationMessages?: Array<{ role: string; content: string }>;
  onPrdSaved?: () => void;
  onTasksAdded?: () => void;
  /** The chat's capability — drives the "Download as …" action (which hides itself
   *  when the capability has no exportable format). */
  capability?: string | null;
  /** Chat title, used as the exported document's title + filename. */
  chatTitle?: string;
}

/**
 * Reusable action bar for assistant messages: Copy, thumbs up/down, export, and
 * project actions. Used by Brain Storm and IDE Brain chat.
 */
export function ChatMessageActions({
  onCopy,
  copied,
  feedback,
  onFeedback,
  projectId,
  assistantContent,
  conversationMessages,
  onPrdSaved,
  onTasksAdded,
  capability,
  chatTitle,
}: ChatMessageActionsProps) {
  const t = useTranslations('brain.messageActions');
  return (
    <>
      <button type="button" className="bs-action-btn" onClick={onCopy} title={t('copy')}>
        {copied ? `✓ ${t('copied')}` : t('copy')}
      </button>
      {onFeedback != null && (
        <>
          <button
            type="button"
            className={`bs-action-btn ${feedback === 'up' ? 'active' : ''}`}
            onClick={() => onFeedback('up')}
            title={t('goodResponse')}
            aria-label={t('thumbsUp')}
          >
            👍
          </button>
          <button
            type="button"
            className={`bs-action-btn ${feedback === 'down' ? 'active' : ''}`}
            onClick={() => onFeedback('down')}
            title={t('badResponse')}
            aria-label={t('thumbsDown')}
          >
            👎
          </button>
        </>
      )}
      <BrainMessageExport capability={capability} content={assistantContent} title={chatTitle} />
      {projectId != null && (
        <ChatProjectActions
          projectId={projectId}
          assistantContent={assistantContent}
          conversationMessages={conversationMessages}
          onPrdSaved={onPrdSaved}
          onTasksAdded={onTasksAdded}
        />
      )}
    </>
  );
}
