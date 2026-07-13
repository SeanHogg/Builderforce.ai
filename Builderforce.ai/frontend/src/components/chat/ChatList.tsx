'use client';

import { useState, useEffect } from 'react';
import { chatApi, type Chat } from '@/lib/chatApi';

interface ChatListProps {
  onSelectChat: (chatId: string) => void;
  currentChatId?: string;
  userId: string;
  onChatsUpdated?: () => void;
}

export function ChatList({ onSelectChat, currentChatId, userId, onChatsUpdated }: ChatListProps) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  // Load chats on mount
  useEffect(() => {
    loadChats();
  }, [userId]);

  const loadChats = async () => {
    try {
      setLoading(true);
      const data = await chatApi.getChats();
      setChats(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load chats');
    } finally {
      setLoading(false);
    }
  };

  const handleEditStart = (chat: Chat) => {
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
  };

  const handleEditSave = async (chatId: string) => {
    try {
      await chatApi.updateChatTitle({ chatId, title: editTitle });
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, title: editTitle } : c));
      setEditingChatId(null);
    } catch (err: any) {
      alert(err.message || 'Failed to save title');
      setEditTitle(chats.find(c => c.id === chatId)?.title || '');
    }
  };

  const handleEditCancel = () => {
    const originalTitle = chats.find(c => c.id === editingChatId)?.title || '';
    setEditTitle(originalTitle);
    setEditingChatId(null);
  };

  const handleNewChat = async () => {
    try {
      const { chat, isNewChat } = await chatApi.createChat(userId);
      if (isNewChat) {
        setChatTitleAsInitial(chat);
        onSelectChat(chat.id);
      } else {
        setChats(prev => [chat, ...prev]);
        onSelectChat(chat.id);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to create new chat');
    }
  };

  const setChatTitleAsInitial = async (chat: Chat) => {
    const messages = await chatApi.getMessages(chat.id, userId);
    if (messages.length > 0) {
      const content = messages[0].content;
      const autoTitle = await chatApi.autoGenerateTitle(content);
      if (autoTitle !== createDateLabel()) {
        await chatApi.updateChatTitle({ chatId: chat.id, title: autoTitle });
        setChats(prev => prev.map(c => c.id === chat.id ? { ...c, title: autoTitle } : c));
      }
    }
  };

  const createDateLabel = () => {
    const now = new Date();
    return `New Chat – ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return `Today, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (date.toDateString() === new Date(now.getTime() - 86400000).toDateString()) {
      return `Yesterday, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  if (loading) {
    return (
      <div className="chat-list-loading">
        <p>Loading chats...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="chat-list-error">
        <p>{error}</p>
        <button type="button" onClick={loadChats}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="chat-list">
      <button type="button" className="chat-list-new-chat-btn" onClick={handleNewChat}>
        + New Chat
      </button>

      <div className="chat-list-items">
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`chat-list-item ${currentChatId === chat.id ? 'active' : ''}`}
            onClick={() => onSelectChat(chat.id)}
            title={chat.title}
          >
            <div className="chat-list-title">
              {editingChatId === chat.id ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => handleEditSave(chat.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEditSave(chat.id);
                    if (e.key === 'Escape') handleEditCancel();
                  }}
                  autoFocus
                  maxLength={100}
                  style={{ width: '100%', outline: 'none' }}
                />
              ) : (
                <>
                  <span className="chat-title-text">{chat.title}</span>
                  <button
                    type="button"
                    className="chat-list-edit-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditStart(chat);
                    }}
                    aria-label="Edit title"
                  >
                    ✎
                  </button>
                </>
              )}
            </div>
            <div className="chat-list-meta">
              <span className="chat-list-date">{formatDate(chat.lastMessageAt)}</span>
              <span className="chat-list-message-count">{chat.messageCount} messages</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// CSS Styles
const chatListStyles = `
.chat-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
}

.chat-list-loading,
.chat-list-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--text-muted);
  text-align: center;
}

.chat-list-error button {
  margin-top: 12px;
  padding: 8px 16px;
}

.chat-list-new-chat-btn {
  width: 100%;
  padding: 14px 16px;
  margin: 8px 8px 0 8px;
  background: var(--coral-bright);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.chat-list-new-chat-btn:hover {
  opacity: 0.9;
}

.chat-list-items {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.chat-list-item {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
  margin-bottom: 2px;
  border: 1px solid transparent;
}

.chat-list-item:hover {
  background: var(--bg-hover);
}

.chat-list-item.active {
  background: var(--bg-elevated);
  border-color: var(--border-subtle);
}

.chat-list-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.chat-title-text {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-list-edit-btn {
  display: none;
  padding: 2px 6px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}

.chat-list-item:hover .chat-list-edit-btn {
  display: block;
}

.chat-list-item.active .chat-list-edit-btn {
  display: block;
}

.chat-list-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--text-secondary);
}

.chat-list-date {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.chat-list-message-count {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Dark theme overrides */
:global(html.dark) {
  .chat-list-new-chat-btn {
    background: var(--coral-bright);
  }
}
`;

// Inject styles
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = chatListStyles;
  document.head.appendChild(style);
}