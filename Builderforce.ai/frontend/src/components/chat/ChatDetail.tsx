'use client';

import { useState, useEffect, useRef } from 'react';
import { chatApi, type Message } from '@/lib/chatApi';
import { saveTitleEntry } from '@/lib/storage';

interface ChatDetailProps {
  chatId: string;
  userId: string;
  chat?: {
    id: string;
    title: string;
    lastMessageAt: number;
    messageCount: number;
  };
  onTitleChange?: (title: string) => void;
}

export function ChatDetail({
  chatId,
  userId,
  chat,
  onTitleChange,
}: ChatDetailProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitleText, setEditTitleText] = useState('');
  const [updatedChat, setUpdatedChat] = useState(chat);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Update local chat state when we get a new title from the backend
  useEffect(() => {
    if (chat) {
      setUpdatedChat(chat);
    }
  }, [chat]);

  // Load messages on mount and when chatId changes
  useEffect(() => {
    loadMessages();
  }, [chatId, userId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = async () => {
    try {
      setLoading(true);
      const data = await chatApi.getMessages(chatId, userId);
      setMessages(data);
      setError(null);

      // Trigger title update if this is first message (FR1.1)
      if (data.length === 1) {
        const autoTitle = await chatApi.autoGenerateTitle(data[0].content);
        if (autoTitle !== chat?.title) {
          await chatApi.updateChatTitle({ chatId, title: autoTitle });
          saveTitleEntry(chatId, autoTitle);
          onTitleChange?.(autoTitle);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!input.trim()) return;

    try {
      const result = await chatApi.sendMessage({
        chatId,
        content: input,
      });

      setMessages(prev => [...prev, result.message]);
      setInput('');

      // Wait a moment then refetch to get chat metadata updates including auto-generated title
      setTimeout(async () => {
        await loadMessages();
      }, 100);
    } catch (err: any) {
      alert(err.message || 'Failed to send message');
    }
  };

  const handleStartEditTitle = () => {
    setEditingTitle(true);
    setEditTitleText(updatedChat.title);
  };

  const handleSaveTitle = async () => {
    if (!editTitleText.trim()) {
      alert('Title cannot be empty');
      return;
    }

    try {
      const updated = await chatApi.updateChatTitle({ chatId, title: editTitleText.trim() });
      setUpdatedChat(updated);
      setEditingTitle(false);
      onTitleChange?.(editTitleText.trim());
      // Persist to LocalStorage (FR4.1)
      saveTitleEntry(chatId, editTitleText.trim());
    } catch (err: any) {
      alert(err.message || 'Failed to save title');
      setEditTitleText(updatedChat.title);
    }
  };

  const handleCancelEditTitle = () => {
    setEditTitleText(updatedChat.title);
    setEditingTitle(false);
  };

  const formatMessageTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="chat-detail">
      <div className="chat-detail-header">
        {chat ? (
          <>
            {editingTitle ? (
              <>
                <input
                  type="text"
                  value={editTitleText}
                  onChange={(e) => setEditTitleText(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle();
                    if (e.key === 'Escape') handleCancelEditTitle();
                  }}
                  autoFocus
                  maxLength={100}
                  className="chat-title-input"
                  style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    maxWidth: '100%'
                  }}
                />
              </>
            ) : (
              <>
                <h2 className="chat-detail-title">{updatedChat.title}</h2>
                <span className="chat-detail-count">{updatedChat.messageCount} messages</span>
                <button
                  type="button"
                  onClick={handleStartEditTitle}
                  className="chat-edit-title-btn"
                  aria-label="Edit title"
                  title="Edit title"
                >
                  ✎
                </button>
              </>
            )}
          </>
        ) : (
          <h2 className="chat-detail-title">Chat details loading...</h2>
        )}
      </div>

      <div className="chat-detail-messages">
        {loading ? (
          <div className="chat-messages-loading">
            <p>Loading messages...</p>
          </div>
        ) : error ? (
          <div className="chat-messages-error">
            <p>{error}</p>
            <button type="button" onClick={loadMessages}>
              Retry
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-messages-empty">
            <p>No messages yet. Start the conversation by sending a message!</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`chat-message ${message.role}`}
            >
              <div className="chat-message-header">
                <span className="chat-message-role-label">
                  {message.role === 'user' ? 'You' : 'AI Assistant'}
                </span>
                <span className="chat-message-time">
                  {formatMessageTime(message.createdAt)}
                </span>
              </div>
              <div className="chat-message-content">
                {message.content}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-detail-input" onSubmit={handleSendMessage}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            loading ? 'Loading...' : 
            error ? 'Error loading chat.'
              : 'Type a message...'
          }
          disabled={loading || !!error}
          rows={1}
          style={{
            minHeight: '44px',
            maxHeight: '200px',
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || loading || !!error}
        >
          Send
        </button>
      </form>
    </div>
  );
}

// CSS Styles
const chatDetailStyles = `
.chat-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-subtle);
}

.chat-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}

.chat-detail-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.chat-detail-count {
  font-size: 12px;
  color: var(--text-secondary);
}

.chat-detail-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: var(--bg-surface);
}

.chat-messages-loading,
.chat-messages-error,
.chat-messages-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 40px;
  color: var(--text-muted);
  text-align: center;
  height: 100%;
}

.chat-messages-error button {
  margin-top: 12px;
  padding: 8px 16px;
}

.chat-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 80%;
}

.chat-message.user {
  align-self: flex-end;
}

.chat-message.assistant {
  align-self: flex-start;
}

.chat-message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.chat-message-role-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.chat-message-time {
  font-size: 11px;
  color: var(--text-muted);
}

.chat-message-content {
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
  word-wrap: break-word;
}

.chat-message.user .chat-message-content {
  background: var(--coral-bright);
  color: #fff;
  border-bottom-right-radius: 2px;
}

.chat-message.assistant .chat-message-content {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-bottom-left-radius: 2px;
}

.chat-detail-input {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}

.chat-detail-input textarea {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  outline: none;
  background: var(--bg-surface);
  color: var(--text-primary);
}

.chat-detail-input textarea:focus {
  border-color: var(--coral-bright);
}

.chat-detail-input button {
  padding: 10px 20px;
  background: var(--coral-bright);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
  white-space: nowrap;
}

.chat-detail-input button:hover:not(:disabled) {
  opacity: 0.9;
}

.chat-detail-input button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-title-input {
  border-bottom: 1px solid transparent;
  transition: border-color 0.15s ease;
}

.chat-title-input:focus {
  border-bottom: 1px solid var(--coral-bright);
}

.chat-edit-title-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
}

.chat-detail-header:hover .chat-edit-title-btn,
.chat-edit-title-btn:hover {
  opacity: 0.7;
  color: var(--coral-bright);
}

/* Dark theme overrides */
:global(html.dark) {
  .chat-detail-header {
    background: #2a2a2a;
  }

  .chat-detail-input textarea {
    background: #1a1a1a;
  }
}
`;

// Inject styles
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = chatDetailStyles;
  document.head.appendChild(style);
}