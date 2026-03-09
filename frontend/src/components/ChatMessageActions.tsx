'use client';

import { ChatProjectActions } from './ChatProjectActions';

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
}

/**
 * Reusable action bar for assistant messages: Copy, thumbs up/down, and project actions.
 * Used by Brain Storm and IDE Brain chat.
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
}: ChatMessageActionsProps) {
  return (
    <>
      <button type="button" className="bs-action-btn" onClick={onCopy} title="Copy">
        {copied ? '✓ Copied!' : 'Copy'}
      </button>
      {onFeedback != null && (
        <>
          <button
            type="button"
            className={`bs-action-btn ${feedback === 'up' ? 'active' : ''}`}
            onClick={() => onFeedback('up')}
            title="Good response"
            aria-label="Thumbs up"
          >
            👍
          </button>
          <button
            type="button"
            className={`bs-action-btn ${feedback === 'down' ? 'active' : ''}`}
            onClick={() => onFeedback('down')}
            title="Bad response"
            aria-label="Thumbs down"
          >
            👎
          </button>
        </>
      )}
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
