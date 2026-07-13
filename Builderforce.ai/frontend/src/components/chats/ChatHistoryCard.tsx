/**
 * Chat history card component displaying generated titles.
 * Implements FR4 (display in chat history/sidebar list) and AC3 (concise titles).
 */

import React, { useState } from 'react';
import type { Chat, ChatMessage } from '@/types/chat';
import { useChatTitleGeneration } from '@/hooks/useChatTitleGeneration';
import { formatTimestamp } from '@/utils/date';

export interface ChatHistoryCardProps {
  chat: Chat;
  isActive?: boolean;
  onClick: (chatId: string) => void;
  onTitleChanged?: (chatId: string, title: string) => void;
}

export function ChatHistoryCard({
  chat,
  isActive = false,
  onClick,
  onTitleChanged,
}: ChatHistoryCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(chat.title);

  const {
    title: currentTitle,
    hasGenerated,
    mightTriggerGeneration,
  } = useChatTitleGeneration({
    chat,
    onTitleGenerated: async (chatId, newTitle) => {
      if (onTitleChanged) {
        onTitleChanged(chatId, newTitle);
      }
    },
  });

  // Update local title if we have a generated one
  React.useEffect(() => {
    if (hasGenerated && currentTitle) {
      setEditTitle(currentTitle);
    }
  }, [hasGenerated, currentTitle]);

  // Auto-generate title if we haven't yet and are eligible (AC3: not much latency).
  React.useEffect(() => {
    // Only react on mount for initial (not subsequent) open.
    if (!hasGenerated && chat.messages.length > 0 && !chat.manualTitle && isEditing) {
      mightTriggerGeneration();
    }
  }, [hasGenerated, chat.messages.length, chat.manualTitle, isEditing, mightTriggerGeneration]);

  const handleTitleClick = () => {
    setIsEditing(true);
  };

  const handleTitleBlur = async () => {
    const trimmedTitle = editTitle.trim();
    if (trimmedTitle !== chat.title) {
      setIsEditing(false);
      // Persist manually edited title (FR6)
      await newTitlePersistence(chat.id, trimmedTitle);
    } else {
      setIsEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.target.blur();
    } else if (e.key === 'Escape') {
      setEditTitle(chat.title);
      setIsEditing(false);
    }
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditTitle(e.target.value);
  };

  let renderedTitle: string;
  if (isEditing) {
    renderedTitle = editTitle;
  } else if (currentTitle) {
    renderedTitle = currentTitle;
  } else {
    renderedTitle = chat.title;
  }

  return (
    <div
      className={`chat-history-card ${isActive ? 'active' : ''} ${
        hasGenerated && !isEditing ? 'title-generated' : 'title-ungenerated'
      }`}
      onClick={() => onClick(chat.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick(chat.id);
        }
      }}
      aria-label={`${chat.title} (${chat.messages.length} messages) - Click to open`}
    >
      <div className="chat-history-card-header">
        <div className="chat-history-title">
          {isEditing ? (
            <input
              type="text"
              value={editTitle}
              onChange={handleTitleChange}
              onBlur={handleTitleBlur}
              onKeyDown={handleKeyDown}
              className="chat-title-editor"
              autoFocus
              aria-label="Edit chat title"
            />
          ) : (
            <span className="chat-title-text">{renderedTitle}</span>
          )}
          {hasGenerated && !isEditing && (
            <span className="chat-title-badge">auto</span>
          )}
        </div>
        <div className="chat-history-meta">
          {formatTimestamp(chat.createdAt)}
        </div>
      </div>
      {chat.lastMessage && !isEditing && (
        <div className="chat-history-preview">
          {chat.lastMessage.content.slice(0, 60)}
          {chat.lastMessage.content.length > 60 && '...'}
        </div>
      )}
    </div>
  );
}

/**
 * Persist manually edited title (FR6).
 * In production, this would call an API endpoint.
 */
async function newTitlePersistence(chatId: string, title: string): Promise<void> {
  // In the integrated app, this would call a backend API to persist the change.
  console.log(`[Chat History] Persisted new title for chat ${chatId}: "${title}"`);
}