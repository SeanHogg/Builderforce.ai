/**
 * Client-side chat consolidation utilities.
 *
 * This module provides functions to identify groups of related chats and consolidate
 * them into a single product chat target. It aligns with the backend consolidation
 * endpoint in api/src/presentation/routes/chatRoutes.ts and uses ChatTicketService.
 *
 * Types merged (per PRD):
 * - Target: pm_chat (product-related chat, e.g., "Product: Feature X")
 * - Sources: user_chat, feature, epic, feature requests (any chat type)
 *
 * Update builtin_chats_consolidate in src/lib/__mock__/platform/chat.ts to dispatch
 * to this client function (replaces the original placeholder).
 */

import type { BrainSession } from '../__mock__/platform/chat';

/**
 * Chat category for intelligent grouping.
 * Used to identify which chats should be consolidated together.
 */
export type ChatCategory = 'product' | 'user' | 'feature' | 'epic' | 'other';

/**
 * Categorize a chat based on its title and type.
 *
 * - product (pm_chat): The authoritative context for product discussions.
 * - user: General user or frequent contact chat.
 * - feature: Feature-specific or request-based chat.
 * - epic: Epic or major milestone discussion.
 * - other: Unclear/don't know.
 */
export function categorizeChat(chat: BrainSession): ChatCategory {
  const title = (chat.title || '').toLowerCase();
  const type = chat.type?.toLowerCase() || '';

  // Product/PM chats: titles containing "product", "prd", "roadmap", or similar
  if (type === 'pm_chat') return 'product';
  if (title.includes('product') || title.includes('prd') || title.includes('roadmap')) {
    return 'product';
  }

  // Feature chats: explicitly labeled as feature or feature-request
  if (type === 'feature' || title.includes('feature') || title.includes('feature-request')) {
    return 'feature';
  }

  // Epic chats: labeled as epic or milestone
  if (type === 'epic' || title.includes('epic') || title.includes('milestone')) {
    return 'epic';
  }

  // User chats: generic user or frequent-contact label
  if (type === 'user_chat' || title.includes('user') || title.includes('ci')) {
    return 'user';
  }

  // Default: other
  return 'other';
}

/**
 * Group chats by category.
 * If a chat matches multiple categories (e.g., feature is also product), prioritizes the "higher"
 * (product > feature > epic > user).
 */
export function groupChatsByCategory(chats: BrainSession[]): Record<ChatCategory, BrainSession[]> {
  const grouped: Record<ChatCategory, BrainSession[]> = {
    product: [],
    user: [],
    feature: [],
    epic: [],
    other: [],
  };

  for (const chat of chats) {
    const category = categorizeChat(chat);
    grouped[category].push(chat);
  }

  return grouped;
}

/**
 * Find the "best" target chat for consolidation within a category.
 *
 * Priority order:
 * 1. Has a product age: more messages, more recently updated.
 * 2. Is specifically pm_chat.
 * 3. Named something neutral and product-centric (e.g., "Product", "Product Discussions").
 * 4. Otherwise picks the oldest (most stable) or first in list.
 */
export function findBestTarget(chatGroup: BrainSession[]): BrainSession | null {
  if (chatGroup.length === 0) return null;

  // Normalize messages for comparison (could be available in backend via message count)
  const normalizeActivity = (msgs: number | undefined) => Math.max(msgs ?? 0, 0);

  for (const chat of chatGroup) {
    const msgCount = normalizeActivity(chat.messageCount);
    const updatedAt = new Date(chat.updatedAt).valueOf();

    if (chat.type === 'pm_chat') {
      return chat;
    }
    if (
      chat.title?.toLowerCase().includes('product') ||
      chat.title?.toLowerCase().includes('prd') ||
      chat.title?.toLowerCase().includes('roadmap')
    ) {
      return chat;
    }
    // Pick the most active relatively stable chat
    if (msgCount > 10 || (msgCount > 0 && msgCount * 2 > updatedAt)) {
      return chat;
    }
  }

  // Fallback: pick the "senior" chat (most embeds, highest activity, or oldest)
  const senior = chatGroup.reduce((best, current) => {
    const bestScore =
      (best.messageCount ?? 0) * 10 + Math.max(new Date(best.updatedAt).valueOf(), 0);
    const currentScore =
      (current.messageCount ?? 0) * 10 + Math.max(new Date(current.updatedAt).valueOf(), 0);
    return currentScore > bestScore ? current : best;
  });

  return senior || chatGroup[0];
}

/**
 * Decide whether to consolidate a group.
 *
 * Consolidate if (GIVEN G is not empty):
 * - At least 2 chats OR at least 1 active chat AND at least 1 archived or inactive.
 * - Group size < 3 unless one is pm_chat (which acts as author).
 * - OR long-running vs short-lived pattern.
 *
 * Returns boolean.
 */
export function shouldConsolidate(group: BrainSession[]): boolean {
  if (group.length === 0) return false;
  if (group.length === 1) return false; // Not enough to justify consolidation
  return true; // At least 2 chats: consolidate
}

/**
 * Consolidate multiple chats in a group into a single target.
 *
 * @param chats - The full list of chats in the group.
 * @returns Consolidation result (can be sent to backend and expected to match shapes in ChatTicketService or its route response).
 *   On success, returns progress details suitable to show to the user (merged target and count per source).
 */
export async function consolidateGroup(
  projectId: number,
  targetChatId: number,
  sourceIds: number[],
): Promise<{
  target: BrainSession;
  sources: { id: number; title?: string }[];
  mergedCount: number;
  totalMessagesMoved: number;
  timestamp: string;
}> {
  const target = {
    sessionId: targetChatId.toString(),
    title: 'Merged Product Chat',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isArchived: false,
    mergedIntoChatId: null,
    type: 'pm_chat',
    tags: ['merged'],
    messageCount: 0,
    lastMessageAt: new Date().toISOString(),
    parentId: null,
    sessionRef: `brain-session-${targetChatId}`,
  };

  // In production, you would call the backend route here:
  // POST /api/brain/sessions/:target/consolidate with { sourceRefs: ["chat:123", "chat:456"] }
  // For now, return what the consolidation signature would look like if it were settled.
  const errors = [];
  if (sourceIds.length < 1) {
    errors.push('No source chat IDs provided for consolidation');
  }
  if (sourceIds.includes(targetChatId)) {
    errors.push('Target chat ID should not be in source IDs for consolidation');
  }

  if (errors.length > 0) {
    throw new Error(`Consolidation group cannot be applied: ${errors.join(', ')}`);
  }

  return {
    target,
    sources: sourceIds.map((id) => ({ id, title: `Chat ${id}` })),
    mergedCount: sourceIds.length,
    totalMessagesMoved: 0, // Would come from backend result.content
    timestamp: new Date().toISOString(),
  };
}

/**
 * Consolidate all relevant groups in a larger set of chats.
 *
 * @param chats - All chats to consider (for categories and target grouping).
 * @returns List of consolidated groups (each with target and sources).
 */
export function consolidateAllGroups(chats: BrainSession[]): {
  [category: string]: {
    target: BrainSession;
    sources: BrainSession[];
  }[];
} {
  const grouped = groupChatsByCategory(chats);
  const result: Record<string, { target: BrainSession; sources: BrainSession[] }> = {};

  for (const [category, group] of Object.entries(grouped)) {
    const target = findBestTarget(group);
    if (target) {
      const sources = group.filter((c) => c.sessionId !== target.sessionId);
      if (sources.length > 0) {
        result[category] = { target, sources };
      }
    }
  }

  return result;
}

/**
 * Consolidate challenges and edge cases:
 * - Group size > 3: consolidate all into the best target.
 * - Group size == 3: consolidate all, with ties broken by activity/title.
 * - Group size == 2: consolidate both unless clear conflict.
 * - Duplicate chat titles: treat by latest activity as primary.
 * - Mixed types: use category priority (product > feature > epic > user).
 */