/**
 * Example usage of the automated chat title generation feature.
 * Demonstrates how to integrate the title generation system into a real chat application.
 */

import React, { useState } from 'react';
import type { Chat, ChatMessage } from '@/types/chat';
import { ChatList } from '@/components/chats/ChatList';


// Example chat data structure (would fetch from API in production)
const exampleChats: Chat[] = [
  {
    id: '1',
    title: 'Fix Login Bug',
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
    messages: [
      {
        id: 'msg1',
        chatId: '1',
        role: 'user',
        content: 'I keep getting an authentication error when I try to login',
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
      },
      {
        id: 'msg2',
        chatId: '1',
        role: 'assistant',
        content: 'I can help troubleshoot that. What browser are you using and what error message do you see?',
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
      },
    ],
    lastMessage: {
      id: 'msg2',
      chatId: '1',
      role: 'assistant',
      content: 'I can help troubleshoot that. What browser are you using and what error message do you see?',
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
    },
    titleGenerated: true,
  },
  {
    id: '2',
    title: 'Implement User Authentication',
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 7,
    updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 7,
    messages: [
      {
        id: 'msg1',
        chatId: '2',
        role: 'user',
        content: 'I need to add OAuth2 support to the application',
        createdAt: Date.now() - 1000 * 60 * 60 * 24 * 7,
      },
    ],
    lastMessage: {
      id: 'msg1',
      chatId: '2',
      role: 'user',
      content: 'I need to add OAuth2 support to the application',
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 7,
    },
    titleGenerated: true,
  },
];

/**
 * Example component integrating automated chat title generation.
 */
export function ChatWithTitleGenerationExample() {
  const [activeChatId, setActiveChatId] = useState<string>();
  const [chats, setChats] = useState<Chat[]>(exampleChats);

  const handleChatClick = (chatId: string) => {
    setActiveChatId(chatId);
  };

  const handleTitleChange = async (chatId: string, newTitle: string) => {
    console.log(`[Title Changed] Chat ${chatId}: ${newTitle}`);

    // Update local state - in production, this would sync with backend
    setChats((prevChats) =>
      prevChats.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              title: newTitle,
              manualTitle: true,
            }
          : chat
      )
    );
  };

  return (
    <div className="chat-app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Chat History</h2>
          <button className="new-chat-button">+ New Chat</button>
        </div>

        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onChatClick={handleChatClick}
          onTitleChanged={handleTitleChange}
          showEmptyState={true}
        />
      </div>

      <div className="chat-main">
        {activeChatId ? (
          <div className="active-chat-view">
            <h2>Chat View</h2>
            <div className="chat-messages">
              {/* Message display would go here */}
              <p>No messages loaded yet.</p>
            </div>
            <div className="chat-input">
              {/* Message input would go here */}
              <input type="text" placeholder="Type a message..." />
            </div>
          </div>
        ) : (
          <div className="no-chat-selected">
            <p>Select a chat to view messages</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Example CSS (for demonstration purposes)
/*
.chat-app-container {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 320px;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  background: #f9fafb;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.chat-list-empty {
  padding: 40px 16px;
  text-align: center;
  color: #6b7280;
}

.chat- main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat- messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.chat-input {
  padding: 16px;
  border-top: 1px solid #e5e7eb;
  background: white;
}
*/

export default ChatWithTitleGenerationExample;