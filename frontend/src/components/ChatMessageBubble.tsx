'use client';

import { ChatMessageContent } from './ChatMessageContent';

export interface ChatMessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  onApplyCode?: (code: string) => void;
  onCreateFile?: (path: string, content: string) => void;
  /** Action bar below message (Copy, feedback, project actions). */
  actions?: React.ReactNode;
}

/**
 * Reusable chat message row: avatar (user vs AI) + bubble + optional actions.
 * Used by Brain Storm and IDE Brain chat for consistent dialogue UI.
 */
export function ChatMessageBubble({
  role,
  content,
  isStreaming,
  onApplyCode,
  onCreateFile,
  actions,
}: ChatMessageBubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={`bs-msg ${isUser ? 'bs-msg-user' : ''}`}>
      <div
        className="bs-avatar"
        style={{
          width: 32,
          height: 32,
          minWidth: 32,
          minHeight: 32,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: isUser ? 'var(--accent, var(--coral-bright))' : 'var(--bg-elevated)',
          color: isUser ? 'var(--text-on-accent, #fff)' : 'var(--text-primary)',
        }}
        aria-hidden
      >
        {isUser ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ) : (
          '🧠'
        )}
      </div>
      <div className={`bs-bubble ${isUser ? 'bs-bubble-user' : 'bs-bubble-ai'}`}>
        {content ? (
          <ChatMessageContent
            content={content}
            onApplyCode={!isUser ? onApplyCode : undefined}
            onCreateFile={!isUser ? onCreateFile : undefined}
          />
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Thinking…</span>
        )}
        {actions && <div className="bs-msg-actions">{actions}</div>}
      </div>
    </div>
  );
}
