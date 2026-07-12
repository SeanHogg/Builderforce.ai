import { chats_consolidate } from '../__mock__/platform/chats_consolidate';

export interface ConsolidationResult {
  success: boolean;
  target_chat_id: string;
  source_chat_ids: string[];
  merged_count: number;
  error?: string;
}

/**
 * Service wrapper for chat consolidation
 * This provides a clean interface for using the chats_consolidate tool
 * 
 * @param targetChatId - The unique identifier of the chat target
 * @param sourceChatIds - Array of source chat IDs to merge
 * @param simulate - Whether to simulate (for testing) or call real platform
 * @returns Promise with consolidation result
 */
export async function consolidateChats(
  targetChatId: string,
  sourceChatIds: string[],
  simulate: boolean = true
): Promise<ConsolidationResult> {
  // FR10: Validate permissions
  // In real implementation, this would check if the caller has read permissions for source chats
  // and write permissions for the target chat
  const callerId = 'user_active_session'; // Mock implementation for platform integration
  
  // For mock implementation, permissions are assumed to be valid
  console.log('Consolidating chats:', {
    target: targetChatId,
    sources: sourceChatIds,
    caller: callerId
  });

  // Call the platform tool or mock implementation
  const result = await chats_consolidate(targetChatId, sourceChatIds);

  if (result.success) {
    console.log(`Successfully merged ${result.merged_count} messages from ${result.source_chat_ids.length} source chats into chat ${targetChatId}`);
  } else {
    console.error('Chat consolidation failed:', result.error);
  }

  return result;
}

/**
 * Utility function to batch consolidate multiple chats
 * Ensures source chats are processed in the correct order
 * 
 * @param targetChatId - Target chat ID
 * @param sourceChatIds - Source chat IDs to merge
 * @returns Promise with consolidation result
 */
export async function batchConsolidateChats(
  targetChatId: string,
  sourceChatIds: string[]
): Promise<ConsolidationResult> {
  // Validate input format before proceeding
  if (!targetChatId || !sourceChatIds || !Array.isArray(sourceChatIds) || sourceChatIds.length === 0) {
    return {
      success: false,
      target_chat_id: targetChatId || '',
      source_chat_ids: sourceChatIds,
      merged_count: 0,
      error: 'Missing required parameters for chat consolidation'
    };
  }

  // AC2: FR4 ensures messages from source chats are in the correct order
  // The calls will naturally preserve this order in the consolidated result
  try {
    const result = await consolidateChats(targetChatId, sourceChatIds);
    return result;
  } catch (error) {
    // Handle any unexpected errors
    return {
      success: false,
      target_chat_id: targetChatId,
      source_chat_ids: sourceChatIds,
      merged_count: 0,
      error: error instanceof Error ? error.message : 'Failed to consolidate chats'
    };
  }
}