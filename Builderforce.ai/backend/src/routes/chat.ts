// Chat API Routes
// Handles chat creation, messaging, and title management

import type { NextRequest } from 'next/server';
import {
  getChatById,
  getChatsByUser,
  createChatRecord,
  sendMessageToChat,
  updateChatTitleRecord,
  getMessagesByChatId,
  autoGenerateTitleFromMessages
} from '@/lib/db/chat';

export interface ChatResponse {
  chats?: any[];
  chat?: any;
  messages?: any[];
  message?: any;
}

/**
 * GET /api/chat
 * Fetch all chats for a user
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return Response.json({ error: 'User ID is required' }, { status: 400 });
    }

    const chats = await getChatsByUser(userId);
    
    return Response.json({ chats });
  } catch (error) {
    console.error('Error fetching chats:', error);
    return Response.json({ error: 'Failed to fetch chats' }, { status: 500 });
  }
}

/**
 * POST /api/chat
 * Create a new chat
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, initialTitle } = body;

    if (!userId) {
      return Response.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Generate initial title if not provided
    let title = initialTitle;
    if (!title || !title.trim()) {
      // Use date-based title if no initial title provided
      const { format } = await import('date-fns');
      title = format(new Date(), 'yyyy-MM-dd');
    }

    const chat = await createChatRecord(userId, title, 1); // tenantId defaults to 1
    
    return Response.json({ chat });
  } catch (error) {
    console.error('Error creating chat:', error);
    return Response.json({ error: 'Failed to create chat' }, { status: 500 });
  }
}

/**
 * GET /api/chat/[chatId]
 * Fetch messages for a specific chat
 */
export async function GET_CHAT_ID(request: NextRequest) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const userId = searchParams.get('userId');
    const chatId = request.nextUrl.pathname.split('/').pop();

    if (!chatId || !userId) {
      return Response.json({ error: 'Chat ID and User ID are required' }, { status: 400 });
    }

    const messages = await getMessagesByChatId(chatId);
    const chat = await getChatById(chatId);

    // Check if this is a new chat without a title - auto-generate if so
    if (chat && (!chat.title || chat.title.trim().length === 0)) {
      const autoTitle = await autoGenerateTitleFromMessages(messages, userId);
      if (autoTitle) {
        const updatedChat = await updateChatTitleRecord(chatId, autoTitle);
        return Response.json({ messages, chat: updatedChat });
      }
    }

    return Response.json({ messages, chat });
  } catch (error) {
    console.error('Error fetching messages:', error);
    return Response.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

/**
 * POST /api/chat/send
 * Send a message in a chat
 */
export async function POST_SEND(request: NextRequest) {
  try {
    const body = await request.json();
    const { chatId, role, content, userId } = body;

    if (!chatId || !content) {
      return Response.json({ error: 'Chat ID and content are required' }, { status: 400 });
    }

    const result = await sendMessageToChat(chatId, userId || 'current-user', role || 'user', content);

    // Check if this is the first user message - if so, need to generate title
    // In a real app, we'd query the messages backend, but for now,
    // we return a flag indicating title generation may be needed
    const isNewChat = role === 'user';

    // Return both message, updated chat, and flag for potential title generation
    return Response.json({
      message: result.message,
      chat: result.chat,
      isNewChat: isNewChat
    });
  } catch (error: any) {
    console.error('Error sending message:', error);
    return Response.json({ error: error.message || 'Failed to send message' }, { status: 500 });
  }
}

/**
 * PATCH /api/chat/title
 * Update a chat title
 */
export async function PATCH_TITLE(request: NextRequest) {
  try {
    const body = await request.json();
    const { chatId, title, userId } = body;

    if (!chatId || !title || title.trim().length === 0) {
      return Response.json({ error: 'Chat ID and non-empty title are required' }, { status: 400 });
    }

    // Validate title length (per PRD FR2.4)
    if (title.length > 100) {
      return Response.json({ error: 'Title must not exceed 100 characters' }, { status: 400 });
    }

    const chat = await updateChatTitleRecord(chatId, title.trim());
    
    return Response.json({ chat });
  } catch (error) {
    console.error('Error updating title:', error);
    return Response.json({ error: 'Failed to update title' }, { status: 500 });
  }
}