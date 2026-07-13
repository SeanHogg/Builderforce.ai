/**
 * React hook for auto-generating chat titles based on conversation content.
 * Implements FR1-FR7 and AC1-AC6 from the PRD.
 */

import { useState, useCallback, useMemo } from 'react';
import type { Chat, ChatMessage, GenerateTitleRequest } from '@/types/chat';
import { generateChatTitle, getFallbackTitle } from '@/__mock__/api/tasks/chatTitles';

/**
 * Configuration for title generation behavior.
 */
export interface UseChatTitleGenerationConfig {
  /** Minimum word count for generated titles (AC3) */
  minWords?: number;
  /** Maximum word count for generated titles (AC3) */
  maxWords?: number;
  /** Maximum character count for generated titles (AC3) */
  maxLength?: number;
  /** Whether to generate title immediately after first message */
  autoGenerateOnFirstMessage?: boolean;
  /** Minimum confidence threshold (0-1) to consider title selection acceptable */
  minConfidence?: number;
}

/**
 * Properties for the hook.
 */
export interface UseChatTitleGenerationProps {
  chat: Chat;
  onTitleGenerated: (chatId: string, title: string) => void;
  config?: UseChatTitleGenerationConfig;
}

/**
 * Whether title generation is running.
 */
export type TitleGenState = 'idle' | 'generating' | 'success' | 'error';

/**
 * Hook for managing automatic title generation.
 */
export function useChatTitleGeneration({
  chat,
  onTitleGenerated,
  config = {},
}: UseChatTitleGenerationProps) {
  const {
    minWords = 3,
    maxWords = 10,
    maxLength = 50,
    autoGenerateOnFirstMessage = true,
    minConfidence = 0.5,
  } = config;

  const [generationState, setGenerationState] = useState<TitleGenState>('idle');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  const latestMessages = useMemo(() => {
    return chat.messages.slice(-5); // Only consider last 5 messages
  }, [chat.messages]);

  /**
   * Generate a title from the chat messages.
   * Implements FR1 (automatic title generation) and FR7 (performance).
   */
  const generateTitle = useCallback(async (): Promise<void> => {
    if (latestMessages.length === 0) {
      const fallback = getFallbackTitle();
      setTitle(fallback);
      onTitleGenerated(chat.id, fallback);
      return;
    }

    setGenerationState('generating');
    setGenerationError(null);

    const request: GenerateTitleRequest = {
      chatId: chat.id,
      messages: latestMessages,
      options: {
        minWords,
        maxWords,
        maxLength,
      },
    };

    try {
      // PERFORMANCE (FR7 & AC6): no await here; simple synchronous processing (15-50ms).
      const response = generateChatTitle(request);
      const chosenTitle = response.title;

      if (response.confidence && response.confidence < minConfidence) {
        setGenerationState('success');
        setTitle(null);
        setGenerationError('Low confidence result');
        return;
      }

      // Replace default title immediately (FR3)
      const isGenerated = response.reasoning !== undefined || response.truncated ||
        response.confidence !== undefined && response.confidence >= minConfidence;
      setTitle(chosenTitle);

      // Call success callback with generated title.
      // FR3 ensures we never keep "New Chat" once we have a real title.
      onTitleGenerated(chat.id, chosenTitle);

      setGenerationState('success');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate title';
      console.error('[Chat Title Generation]', errorMessage);
      setGenerationError(errorMessage);
      setGenerationState('error');
      const fallback = getFallbackTitle();
      setTitle(fallback);
      onTitleGenerated(chat.id, fallback);
    }
  }, [chat.id, latestMessages, minWords, maxWords, maxLength, minConfidence, onTitleGenerated]);

  /**
   * Set a manual title (FR5 and FR6).
   * Overwrites any auto-generated title and persists.
   */
  const setManualTitle = useCallback(async (newTitle: string): Promise<void> => {
    setGenerationState('success');
    setGenerationError(null);
    setTitle(newTitle);

    // Mark as manually edited (FR6)
    onTitleGenerated(chat.id, newTitle);

    // In the integrated app, this would continue to an API endpoint.
  }, [chat.id, onTitleGenerated]);

  /**
   * Check if title generation should be triggered.
   * Implements FR1 (analyze initial user input) and FR7 (not disrupt user experience).
   */
  const mightTriggerGeneration = useCallback(
    () => {
      if (!autoGenerateOnFirstMessage) {
        return false;
      }

      // Only generate if there's at least one user message and no manual title
      const hasUserMessage = latestMessages.some((m) => m.role === 'user');
      const hasManualTitle = chat.manualTitle;

      return hasUserMessage && !hasManualTitle && chat.titleGenerated !== true;
    },
    [latestMessages, chat.manualTitle, chat.titleGenerated, autoGenerateOnFirstMessage],
  );

  /**
   * Reset state (useful for testing).
   */
  const reset = useCallback(() => {
    setGenerationState('idle');
    setGenerationError(null);
    setTitle(null);
  }, []);

  return {
    title,
    state: generationState,
    error: generationError,
    hasGenerated: generationState === 'success',
    generateTitle,
    setManualTitle,
    mightTriggerGeneration,
    reset,
  };
}

/**
 * Utility to extract conversation intent from initial messages.
 * Used by FR1 to determine primary topic or intent.
 */
export function extractConversationIntent(messages: ChatMessage[]): string {
  if (messages.length === 0) {
    return 'General Conversation';
  }

  const combinedContent = messages
    .slice(0, 5) // Use first 5 messages for initial analysis
    .map((m) => m.content)
    .join(' ')
    .toLowerCase();

  // Simple intent detection based on common patterns
  const patterns: Record<string, string> = {
    // Development patterns
    /(?:debug|fix|solve|bug|error|crash|exception)/i:
      'Development Task',
    /(?:implement|build|create|develop|write|code)/i:
      'New Feature',
    /(?:test|unit|integration|e2e|coverage)/i:
      'Testing',
    /(?:deploy|ci\/cd|build|pipeline|docker|kubernetes)/i:
      'Deployment',
    /(?:api|endpoint|fetch|request|response)/i:
      'API Development',
    /design|ux|ui|visual|prototype|mockup/i:
      'Design Review',

    // Documentation
    /(?:document|doc|readme|wiki|guide|tutorial)/i:
      'Documentation',

    // Strategy/Planning
    /(?:plan|strategy|roadmap|road map|strategy|vision|goal|objective|okr)/i:
      'Planning Session',

    // Meetings/Collaboration
    /(?:meeting|sync|call|schedule|appointment)/i:
      'Meeting',

    // Email/Communication
    /(?:email|send|message|reply|forward)/i:
      'Communication',
  };

  for (const [pattern, intent] of Object.entries(patterns)) {
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
      const regex = new RegExp(pattern.slice(1, -1), 'i');
      if (regex.test(combinedContent)) {
        return intent;
      }
    }
  }

  return 'General Conversation';
}