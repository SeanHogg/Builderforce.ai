// Chat API Routes
// Handles chat creation, messaging, and title management

import type { NextRequest } from 'next/server';
import { Chat, Message, createChat, sendMessage, updateTitle, getMessages as getMessagesFromDB } from '@/lib/db/chat';

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

    // In production, filter by actual userId from JWT
    const chats = await getChatsFromDB(userId);

    return Response.json({ chats });
  } catch (error) {
    console.error('Error fetching chats:', error);
    return Response.json({ error: 'Failed to fetch chats' }, { status: 500 });
  }
}

/**
 * POST /api/chat
 * Create a new chat (optionally with initial title)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, initialTitle } = body;

    if (!userId) {
      return Response.json({ error: 'User ID is required' }, { status: 400 });
    }

    const chat = await createChat(userId, initialTitle);

    return Response.json({ chat });
  } catch (error) {
    console.error('Error creating chat:', error);
    return Response.json({ error: 'Failed to create chat' }, { status: 500 });
  }
}

/**
 * GET /api/chat/:chatId
 * Fetch messages for a specific chat
 */
export async function GET_CHAT_ID(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const chatId = request.nextUrl.pathname.split('/').pop();

    if (!chatId || !userId) {
      return Response.json({ error: 'Chat ID and User ID are required' }, { status: 400 });
    }

    const messages = await getMessagesFromDB(chatId, userId);

    return Response.json({ messages });
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
    const { chatId, content } = body;

    if (!chatId || !content) {
      return Response.json({ error: 'Chat ID and content are required' }, { status: 400 });
    }

    const result = await sendMessage(chatId, content);

    return Response.json(result);
  } catch (error: any) {
    console.error('Error sending message:', error);
    return Response.json({ error: error.message || 'Failed to send message' }, { status: 500 });
  }
}

/**
 * PATCH /api/chat/title
 * Update a chat title
 */
export async function PATCH_TITlE(request: NextRequest) {
  try {
    const body = await request.json();
    const { chatId, title } = body;

    if (!chatId || !title || title.trim().length === 0) {
      return Response.json({ error: 'Chat ID and non-empty title are required' }, { status: 400 });
    }

    if (title.length > 100) {
      return Response.json({ error: 'Title must not exceed 100 characters' }, { status: 400 });
    }

    const chat = await updateTitle(chatId, title.trim());

    return Response.json({ chat });
  } catch (error) {
    console.error('Error updating title:', error);
    return Response.json({ error: 'Failed to update title' }, { status: 500 });
  }
}

// Database functions
async function getChatsFromDB(userId: string): Promise<Chat[]> {
  // TODO: Replace with actual database query
  // This should fetch all chats for the given user, ordered by lastMessageAt DESC
  const mockChats: Chat[] = [
    {
      id: '1',
      tenantId: 1,
      userId,
      title: 'Auto-generated title example',
      createdAt: Date.now() - 86400000 * 2,
      updatedAt: Date.now() - 86400000 * 2,
      lastMessageAt: Date.now(),
      messageCount: 5,
    },
  ];
  return mockChats;
}

// Import these functions from a hypothetical @/lib/db/chat module
// or implement them directly in this module
async function createChat(userId: string, initialTitle?: string): Promise<Chat> {
  // TODO: Replace with actual database insert
  // Generate initial title if not provided
  let title = initialTitle || await generateLabelFromContent(initialTitle || '');
  
  // If no title can be generated, use date-based title
  if (!title || title.trim() === '') {
    title = format(new Date(), 'yyyy-MM-dd');
  }

  const chat: Chat = {
    id: `chat-${Date.now()}`,
    tenantId: 1, // TODO: Get from JWT
    userId,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastMessageAt: Date.now(),
    messageCount: 0,
  };

  // TODO: Insert into database
  console.log('Creating chat:', chat);

  return chat;
}

async function sendMessage(chatId: string, content: string): Promise<{ message: Message; chat: Chat }> {
  // TODO: Replace with actual database insert for message and update for chat
  const message: Message = {
    id: `msg-${Date.now()}`,
    chatId,
    userId: 'current-user', // TODO: Get from JWT
    role: 'user',
    content,
    createdAt: Date.now(),
  };

  console.log('Sending message to chat:', chatId, message);

  // TODO: Fetch current chat and update lastMessageAt, messageCount
  // Also trigger title regeneration if needed (future enhancement)

  return { message, chat: {} as Chat };
}

async function updateTitle(chatId: string, title: string): Promise<Chat> {
  // TODO: Replace with actual database update
  // Update the chat in the database with the new title

  console.log('Updating title for chat:', chatId, title);

  // TODO: Fetch the current chat and return updated version
  return {
    id: chatId,
    tenantId: 1,
    userId: 'current-user',
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastMessageAt: Date.now(),
    messageCount: 0,
  };
}

async function getMessagesFromDB(chatId: string, userId: string): Promise<Message[]> {
  // TODO: Replace with actual database query
  const mockMessages: Message[] = [];
  return mockMessages;
}

async function generateLabelFromContent(content: string): Promise<string> {
  // Simple label generation from content
  if (!content) return '';

  const words = content.trim().split(/\s+/);
  if (words.length === 0) return '';

  // Take first two words as title (or first non-empty word)
  const firstWords = words.filter(w => w.length > 0).slice(0, 2);
  
  // Clean up trailing punctuation
  const cleaned = firstWords.join(' ').replace(/[.,!?;:]$/, '');
  
  return cleaned.length > 0 ? cleaned : '';
}