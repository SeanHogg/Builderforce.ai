'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from 'next-intl';
import { ChatProjectActions } from './ChatProjectActions';
import { BrainMessageExport } from './brain/BrainMessageExport';
import { downloadText } from '@/lib/download';
import { exportFilenameStem } from '@/lib/brain/messageExport';

export interface ChatMessageActionsProps {
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
 * The web app's EXTRA assistant-message actions: download, export, and project
 * actions.
 *
 * Copy, "send again" and the THUMBS are NOT here — they are built into the shared
 * <BrainTimeline>, so every surface that mounts the transcript gets them (the Canvas
 * dock and the VS Code webview had none of them while this bar was the only place
 * they existed, which is why neither surface could contribute a single model
 * rating). This bar composes after them.
 */
export function ChatMessageActions({
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
