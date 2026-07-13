'use client';

import { useState, useEffect } from 'react';
import { chatApi } from '@/lib/chatApi';
import type { Chat } from '@/lib/chatApi';
import { ChatList } from '@/components/chat/ChatList';
import { ChatDetail } from '@/components/chat/ChatDetail';
import { loadTitle } from '@/lib/storage';

interface User {
  id: string;
  name: string;
  email: string;
}

// Mock user ID for development - in production, get from auth context
const MOCK_USER_ID = 'user-123';

export default function ChatPage() {
  const [userId] = useState(MOCK_USER_ID);
  const [currentChatId, setCurrentChatId] = useState<string | undefined>(undefined);
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastModified, setLastModified] = useState<Date>(new Date());

  // Load chats when component mounts
  useEffect(() => {
    loadChats();
  }, [lastModified]);

  const loadChats = async () => {
    try {
      setLoading(true);
      const data = await chatApi.getChats();
      setChats(data);

      // Set current chat to the newest one if none is selected
      if (!currentChatId && data.length > 0) {
        setCurrentChatId(data[0].id);
      }
    } catch (error: any) {
      console.error('Failed to load chats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectChat = (chatId: string) => {
    setCurrentChatId(chatId);
  };

  const handleTitleChange = async (newTitle: string) => {
    // Update local state immediately for responsive UI (FR3.3)
    setChats(prev => prev.map(chat =>
      chat.id === currentChatId ? { ...chat, title: newTitle } : chat
    ));
  };

  const handleChatsUpdated = () => {
    setLastModified(new Date());
  };

  const getCurrentChat = () => {
    return chats.find(chat => chat.id === currentChatId);
  };

  if (loading) {
    return (
      <div className="chat-page-loading">
        <p>Loading chat...</p>
      </div>
    );
  }

  if (!currentChatId) {
    return (
      <div className="chat-page">
        <ChatList
          onSelectChat={handleSelectChat}
          currentChatId={currentChatId}
          userId={userId}
          onChatsUpdated={handleChatsUpdated}
        />

        <main className="chat-page-main">
          {chats.length === 0 ? (
            <div className="chat-page-empty">
              <div className="chat-empty-content">
                <div className="chat-empty-icon">💬</div>
                <h2>Select a chat to start messaging</h2>
                <p>
                  No chats yet. Click "New Chat" to start your first conversation!
                </p>
              </div>
            </div>
          ) : (
            <div className="chat-page-empty">
              <div className="chat-empty-content">
                <h2>Select a chat to start messaging</h2>
                <p>
                  Select a chat from the list to continue
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <ChatList
        onSelectChat={handleSelectChat}
        currentChatId={currentChatId}
        userId={userId}
        onChatsUpdated={handleChatsUpdated}
      />

      <main className="chat-page-main">
        <ChatDetail
          chatId={currentChatId}
          userId={userId}
          chat={getCurrentChat()}
          onTitleChange={handleTitleChange}
        />
      </main>
    </div>
  );
}

// CSS Styles
const chatPageStyles = `
.chat-page-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: var(--text-muted);
}

.chat-page {
  display: flex;
  height: 100vh;
  width: 100%;
}

.chat-page-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-page-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--bg-surface);
}

.chat-empty-content {
  text-align: center;
  padding: 60px 40px;
  max-width: 500px;
}

.chat-empty-icon {
  font-size: 64px;
  margin-bottom: 24px;
  opacity: 0.6;
}

.chat-empty-content h2 {
  margin: 0 0 16px 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
}

.chat-empty-content p {
  margin: 0;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-secondary);
}

/* Additions for Layout/Navigation context (e.g., builderforce IDE header) */
.chat-page-left-panel {
  border-right: 1px solid var(--border-subtle);
  width: 320px;
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  flex-shrink: 0;
}
`;

// Inject styles
export const ChatPageStyles = chatPageStyles;

// Check if we're in a builderforce IDE context
const isBuilderforceIDE = typeof window !== 'undefined' && 
  (window.location.pathname.includes('/ide') || window.location.pathname.includes('/workspace') ||
   window.location.pathname.includes('/chat') || document.querySelector('[class*="ide"]'));

if (isBuilderforceIDE) {
  // We're in the Builderforce IDE - use full-page layout
  if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = chatPageStyles;
    document.head.appendChild(style);
  }
} else {
  // We're navigating directly to /chat - show full page layout
  if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = chatPageStyles;
    document.head.appendChild(style);
  }
}