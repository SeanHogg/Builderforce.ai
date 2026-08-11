'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from 'next-intl';
import { ChatProjectActions } from './ChatProjectActions';
import { BrainMessageExport } from './brain/BrainMessageExport';
import { downloadText } from '@/lib/download';
import { exportFilenameStem } from '@/lib/brain/messageExport';

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
  const [downloaded, setDownloaded] = useState(false);
  const downloadMarkdown = () => {
    const stem = exportFilenameStem(chatTitle?.trim() || 'brain-response', 'brain-response');
    downloadText(assistantContent, `${stem}.md`, 'text/markdown');
    setDownloaded(true);
  };
  return (
    <>
      <button
        type="button"
        className="bs-action-btn bs-action-btn--icon"
        onClick={downloadMarkdown}
        title={downloaded ? t('downloaded') : t('downloadMarkdown')}
        aria-label={downloaded ? t('downloaded') : t('downloadMarkdown')}
        data-state={downloaded ? 'complete' : 'idle'}
      >
        <Icon name={downloaded ? 'document' : 'download'} size={15} />
      </button>
      <button
        type="button"
        className="bs-action-btn bs-action-btn--icon"
        onClick={onCopy}
        title={copied ? t('copied') : t('copy')}
        aria-label={copied ? t('copied') : t('copy')}
        data-state={copied ? 'complete' : 'idle'}
      >
        <Icon name={copied ? 'check' : 'copy'} size={15} />
      </button>
      {onFeedback != null && (
        <>
          <button
            type="button"
            className={`bs-action-btn ${feedback === 'up' ? 'active' : ''}`}
            onClick={() => onFeedback('up')}
            title={t('goodResponse')}
            aria-label={t('thumbsUp')}
            aria-pressed={feedback === 'up'}
            data-state={feedback === 'up' ? 'complete' : 'idle'}
          >
            
            <Icon source="👍" size="1em" />
          </button>
          <button
            type="button"
            className={`bs-action-btn ${feedback === 'down' ? 'active' : ''}`}
            onClick={() => onFeedback('down')}
            title={t('badResponse')}
            aria-label={t('thumbsDown')}
            aria-pressed={feedback === 'down'}
            data-state={feedback === 'down' ? 'complete' : 'idle'}
          >
            
            <Icon source="👎" size="1em" />
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
