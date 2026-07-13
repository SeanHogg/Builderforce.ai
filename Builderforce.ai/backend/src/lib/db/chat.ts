// Database models and helper functions for chat operations
// Supports SQLite for development and can be swapped for PostgreSQL/Neon

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

// Database connection configuration
const DB_PATH = process.env.DB_PATH || '/tmp/builderforce.db';
const USE_SQLITE = process.env.DB_TYPE === 'sqlite';

// Initialize database schema if using SQLite
async function initDatabase(): Promise<void> {
  if (!USE_SQLITE) return;

  console.log(`Initializing SQLite database at ${DB_PATH}`);

  const sqlite3 = require('better-sqlite3');

  const db = new sqlite3(DB_PATH);

  // Create tables if they don't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_message_at INTEGER NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id)
    );

    CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
    CREATE INDEX IF NOT EXISTS idx_chats_last_message ON chats(last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
  `);

  // Seed a default tenant if it doesn't exist
  const tenantStmt = db.prepare('SELECT id FROM tenants WHERE name = ?');
  const existingTenant = tenantStmt.get('Default Tenant') as { id: number } | undefined;

  if (!existingTenant) {
    const insertTenant = db.prepare('INSERT INTO tenants (name, created_at) VALUES (?, ?)');
    insertTenant.run('Default Tenant', Date.now());
  }

  db.close();
}

// Initialize database
initDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
});

// Export SQLite DB instance for use in routes
let dbInstance: any = null;

if (USE_SQLITE) {
  const sqlite3 = require('better-sqlite3');
  dbInstance = new sqlite3(DB_PATH);
}

// Helper functions using SQLite
async function getChatById(chatId: string): Promise<Chat | null> {
  if (!dbInstance) {
    console.warn('Database not available, returning mock data');
    return null;
  }

  const stmt = dbInstance.prepare('SELECT * FROM chats WHERE id = ?');
  const row = stmt.get(chatId) as Chat | undefined;
  return row || null;
}

async function getChatsByUser(userId: string): Promise<Chat[]> {
  if (!dbInstance) {
    console.warn('Database not available, returning mock data');
    return [];
  }

  const stmt = dbInstance.prepare(
    'SELECT * FROM chats WHERE user_id = ? ORDER BY last_message_at DESC'
  );
  return stmt.all(userId) as Chat[];
}

async function createChatRecord(userId: string, title: string, tenantId: number): Promise<Chat> {
  if (!dbInstance) {
    console.warn('Database not available, returning mock data');
    return {
      id: `chat-${Date.now()}`,
      tenantId,
      userId,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastMessageAt: Date.now(),
      messageCount: 0,
    };
  }

  const now = Date.now();
  const id = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const stmt = dbInstance.prepare(
    'INSERT INTO chats (id, tenant_id, user_id, title, created_at, updated_at, last_message_at, message_count) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
  );

  stmt.run(id, tenantId, userId, title, now, now, now);

  return {
    id,
    tenantId,
    userId,
    title,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    messageCount: 0,
  };
}

async function handleMessageSent(chatId: string, userId: string, role: 'user' | 'assistant', content: string): Promise<void> {
  if (!dbInstance) return;

  const now = Date.now();

  // Insert message
  const msgStmt = dbInstance.prepare(
    'INSERT INTO messages (id, chat_id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const msgId = `msg-${now}-${Math.random().toString(36).substr(2, 9)}`;
  msgStmt.run(msgId, chatId, userId, role, content, now);

  // Update chat
  const updateStmt = dbInstance.prepare(
    'UPDATE chats SET last_message_at = ?, message_count = message_count + 1 WHERE id = ?'
  );
  updateStmt.run(now, chatId);
}

async function updateChatTitleRecord(chatId: string, title: string): Promise<Chat> {
  if (!dbInstance) {
    console.warn('Database not available, returning mock data');
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

  const stmt = dbInstance.prepare(
    'UPDATE chats SET title = ?, updated_at = ? WHERE id = ? RETURNING *'
  );

  const chat = stmt.get(chatId, Date.now(), chatId) as Chat | undefined;
  
  if (!chat) {
    throw new Error('Chat not found');
  }

  return chat;
}

async function getMessagesByChatId(chatId: string): Promise<Message[]> {
  if (!dbInstance) {
    console.warn('Database not available, returning mock data');
    return [];
  }

  const stmt = dbInstance.prepare(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC'
  );
  return stmt.all(chatId) as Message[];
}

// Chat API operations
export async function getChats(userId: string): Promise<Chat[]> {
  return getChatsByUser(userId);
}

export async function createChat(userId: string, tenantId: number, initialTitle?: string): Promise<Chat> {
  let title = initialTitle || '';

  if (!title.trim()) {
    // No initial title provided, could generate title from nothing
    title = format(new Date(), 'yyyy-MM-dd');
  }

  const chat = await createChatRecord(userId, title, tenantId);
  return chat;
}

export async function sendMessageToChat(chatId: string, userId: string, role: 'user' | 'assistant', content: string) {
  // Create message
  const now = Date.now();
  const msgId = `msg-${now}-${Math.random().toString(36).substr(2, 9)}`;
  
  if (dbInstance) {
    const msgStmt = dbInstance.prepare(
      'INSERT INTO messages (id, chat_id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    msgStmt.run(msgId, chatId, userId, role, content, now);
  }

  // Update chat last message time and count
  if (dbInstance) {
    const updateStmt = dbInstance.prepare(
      'UPDATE chats SET last_message_at = ?, message_count = message_count + 1 WHERE id = ?'
    );
    updateStmt.run(now, chatId);
  }

  // Return created message
  const message: Message = {
    id: msgId,
    chatId,
    userId,
    role,
    content,
    createdAt: now,
  };

  // Return updated chat
  const chat = await getChatById(chatId) || ({} as Chat);

  return { message, chat };
}

export async function updateChatTitle(chatId: string, title: string): Promise<Chat> {
  return updateChatTitleRecord(chatId, title);
}

export async function getChatMessages(chatId: string): Promise<Message[]> {
  return getMessagesByChatId(chatId);
}

export { Chat, Message };