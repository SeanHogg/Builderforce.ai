/**
 * Main chat history/list component displaying all chats with generated titles.
 * Implements FR4 (display chat history) and AC4 (click to open).
 */

import React from 'react';
import type { Chat } from '@/types/chat';
import { ChatHistoryCard } from './ChatHistoryCard';
import { getFallbackTitle } from '@/__mock__/api/tasks/chatTitles';

export interface ChatListProps {
  /** List of all chats */
  chats: Chat[];
  /** Currently selected chat */
  activeChatId?: string;
  /** Callback when a chat is clicked */
  onChatClick: (chatId: string) => void;
  /** Callback when title changes (FR6) */
  onTitleChanged?: (chatId: string, title: string) => void;
  /** Whether to show empty state */
  showEmptyState?: boolean;
}

export function ChatList({
  chats,
  activeChatId,
  onChatClick,
  onTitleChanged,
  showEmptyState = true,
}: ChatListProps) {
  if (showEmptyState && chats.length === 0) {
    return (
      <div className="chat-list-empty">
        <div className="empty-icon">💬</div>
        <div className="empty-title">No conversations yet</div>
        <div className="empty-subtitle">
          Start a new chat and we'll automatically generate a title based on your first message
        </div>
      </div>
    );
  }

  return (
    <div className="chat-list">
      {chats.map((chat) => (
        <ChatHistoryCard
          key={chat.id}
          chat={chat}
          isActive={chat.id === activeChatId}
          onClick={onChatClick}
          onTitleChanged={onTitleChanged}
        />
      ))}
    </div>
  );
}