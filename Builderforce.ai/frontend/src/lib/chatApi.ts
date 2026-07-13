// Chat API Client for Builderforce
// Handles all chat-related operations: fetching lists, creating chats, sending messages,
// and managing chat titles (reading, updating, auto-generating).

import { format } from 'date-fns';

export interface Chat {
  id: string;
  tenantId: number;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
  messageCount: number;
}

export interface Message {
  id: string;
  chatId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface CreateChatRequest {
  userId: string;
  initialTitle?: string;
}

export interface CreateChatResponse {
  chat: Chat;
  isNewChat: boolean;
}

export interface SendMessageRequest {
  chatId: string;
  content: string;
}

export interface CreateMessageResponse {
  message: Message;
  chat: Chat;
}

export interface UpdateTitleRequest {
  chatId: string;
  title: string;
}

const API_BASE = '/api/chat';

// Chat API Client
export const chatApi = {
  /**
   * Fetch all chats for the current user
   */
  async getChats(): Promise<Chat[]> {
    const response = await fetch(`${API_BASE}?userId=${encodeURIComponent('placeholder-userid')}`);
    if (!response.ok) throw new Error('Failed to fetch chats');
    const data = await response.json();
    return data.chats || [];
  },

  /**
   * Create a new chat
   * @param userId
   * @param initialTitle Optional initial title (will use auto-generated if not provided)
   */
  async createChat(
    userId: string,
    initialTitle?: string
  ): Promise<{ chat: Chat; isNewChat: boolean }> {
    const payload: CreateChatRequest = { userId };
    if (initialTitle) {
      payload.initialTitle = initialTitle;
    }

    const response = await fetch(`${API_BASE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create chat');
    }

    const data = await response.json();
    return { chat: data.chat, isNewChat: data.isNewChat || false };
  },

  /**
   * Send a message in a chat
   */
  async sendMessage(payload: SendMessageRequest): Promise<{ message: Message; chat: Chat }> {
    const response = await fetch(`${API_BASE}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to send message');
    }

    const data = await response.json();
    return { message: data.message, chat: data.chat };
  },

  /**
   * Update a chat title
   */
  async updateChatTitle(payload: UpdateTitleRequest): Promise<Chat> {
    const response = await fetch(`${API_BASE}/title`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update title');
    }

    const data = await response.json();
    return data.chat;
  },

  /**
   * Fetch chat messages for a specific chat
   */
  async getMessages(chatId: string, userId: string): Promise<Message[]> {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(chatId)}?userId=${encodeURIComponent(userId)}`);
    if (!response.ok) throw new Error('Failed to fetch messages');
    const data = await response.json();
    return data.messages || [];
  },

  /**
   * Auto-generate a title from message content
   * Extracts a concise 3-10 word summary based on content keywords
   */
  async autoGenerateTitle(content: string): Promise<string> {
    if (!content || content.trim().length === 0) {
      return format(new Date(), 'yyyy-MM-dd');
    }

    const words = content.trim().split(/\s+/);
    if (words.length <= 2) {
      return content.trim().slice(0, 50);
    }

    // Simple keyword-based title generation
    // In production, integrate with an LLM for more sophisticated title generation
    const titleWords = words.slice(0, Math.min(10, words.length - 2));

    // Filter out common stop words and punctuation
    const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'from', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now']);

    const filteredWords = titleWords.filter(word => {
      const cleanWord = word.replace(/[.,!?;:()“"»«]/g, '').toLowerCase();
      return !stopWords.has(cleanWord);
    });

    const finalTitle = filteredWords.slice(0, 8).join(' ');
    return finalTitle.length > 0 ? finalTitle : content.trim().slice(0, 50);
  },
};