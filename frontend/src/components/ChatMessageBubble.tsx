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
  /**
   * Name shown above the message content (e.g. the agent that is talking, or
   * "You"). Omit to hide — Brain chat relies on the avatar alone.
   */
  label?: string;
  /**
   * Override the avatar glyph. Defaults to a person icon (user) / 🧠 (assistant).
   * Execution Output passes the agent's initial so it's clear WHICH agent speaks.
   */
  avatar?: React.ReactNode;
}

/**
 * Reusable chat message row: avatar (user vs AI) + bubble + optional actions.
 * Used by Brain Storm, IDE Brain chat, and the execution Output tab for a
 * consistent dialogue UI (labeled turns interleaving agent output + user steers).
 */
export function ChatMessageBubble({
  role,
  content,
  isStreaming,
  onApplyCode,
  onCreateFile,
  actions,
  label,
  avatar,
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
        {avatar ?? (isUser ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        ) : (
          '🧠'
        ))}
      </div>
      <div className={`bs-bubble ${isUser ? 'bs-bubble-user' : 'bs-bubble-ai'}`}>
        {label && (
          <div
            className="bs-msg-label"
            style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, opacity: 0.65, marginBottom: 4 }}
          >
            {label}
          </div>
        )}
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
