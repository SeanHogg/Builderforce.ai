/**
 * Chat type definitions for the Builderforce.ai chat system.
 */

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  lastMessage?: ChatMessage;
  titleGenerated?: boolean;
  manualTitle?: boolean;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface ChatSummary {
  id: string;
  title: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ChatTitleOptions {
  maxLength?: number;
  minLength?: number;
  maxWords?: number;
  exponentiateSystemPrompt?: boolean;
  exponentiationCoef?: number;
}

export interface GenerateTitleRequest {
  chatId: string;
  messages: ChatMessage[];
  options?: ChatTitleOptions;
}