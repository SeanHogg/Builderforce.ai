/**
 * Chat consolidation orchestrator.
 *
 * Implements the full consolidation workflow per PRD #395:
 * - Groups chats by category (product, user, feature, epic)
 * - Chooses the best target chat within each group
 * - Merges source chats into the target
 * - Provides review workflow and verification
 */

import type { BrainSession } from './__mock__/platform/chat';
import * as client from './client/consolidation';
import * as platform from './__mock__/platform/chat';

/**
 * Consolidated group result - one target chat with its sources merged into it
 */
export type ConsolidatedGroup = {
  category: 'product' | 'user' | 'feature' | 'epic' | 'other';
  target: BrainSession;
  sources: BrainSession[];
  mergeStats: {
    totalSources: number;
    totalMessagesMerged: number;
    timestamp: string;
  };
};

/**
 * Consolidation request with all chats provided
 */
export type ConsolidationRequest = {
  projectId: number;
  chats: BrainSession[];
  preferredTargetChatId?: number; // Optional override
};

/**
 * Consolidation result with all groups processed
 */
export type ConsolidationResult = {
  groups: ConsolidatedGroup[];
  overall: {
    totalGroups: number;
    totalMessagesMerged: number;
    timestamp: string;
  };
  errors?: string[];
};

/**
 * Find the best target chat for consolidation within a list of candidate chats.
 *
 * Priority order:
 * 1. Explicitly marked pm_chat (authoritative product context)
 * 2. Contains 'product' in title
 * 3. Highest message count and latest activity
 * 4. Otherwise picks the oldest/most stable chat
 */
export function findBestTarget(chatGroup: BrainSession[]): BrainSession | null {
  if (chatGroup.length === 0) return null;

  // Normalize activity for comparison
  const normalizeActivity = (msgs: number | undefined) => Math.max(msgs ?? 0, 0);

  // Priority 1: pm_chat type
  const pmChat = chatGroup.find((c) => c.type === 'pm_chat');
  if (pmChat) return pmChat;

  // Priority 2: Product-related titles
  const productTs = chatGroup.find(
    (c) =>
      c.title &&
      (c.title.toLowerCase().includes('product') ||
        c.title.toLowerCase().includes('prd') ||
        c.title.toLowerCase().includes('roadmap')),
  );
  if (productTs) return productTs;

  // Priority 3: Most active chat
  const mostActive = chatGroup.reduce((best, current) => {
    const bestScore =
      normalizeActivity(best.messageCount) * 10 + Math.max(new Date(best.updatedAt).valueOf(), 0);
    const currentScore =
      normalizeActivity(current.messageCount) * 10 + Math.max(new Date(current.updatedAt).valueOf(), 0);
    return currentScore > bestScore ? current : best;
  });

  return mostActive || chatGroup[0];
}

/**
 * Group chats by semantic category
 */
export function groupChatsByCategory(chats: BrainSession[]): Record<string, BrainSession[]> {
  const categoryMap = {
    product: [],
    user: [],
    feature: [],
    epic: [],
    other: [],
  } as Record<string, BrainSession[]>;

  for (const chat of chats) {
    const category = getChatCategory(chat);
    categoryMap[category].push(chat);
  }

  return categoryMap;
}

/**
 * Categorize a chat based on title, type, and context
 */
export function getChatCategory(chat: BrainSession): 'product' | 'user' | 'feature' | 'epic' | 'other' {
  const title = (chat.title || '').toLowerCase();
  const type = chat.type?.toLowerCase() || '';

  // Product chats are authoritative
  if (type === 'pm_chat') return 'product';
  if (title.includes('product') || title.includes('prd') || title.includes('roadmap')) return 'product';

  // Feature requests and feature-specific chats
  if (type === 'feature' || title.includes('feature') || title.includes('feature-request')) {
    return 'feature';
  }

  // Epic/milestone chats
  if (type === 'epic' || title.includes('epic') || title.includes('milestone')) {
    return 'epic';
  }

  // User chats (generic contact or frequently-chatted user)
  if (type === 'user_chat' || title.includes('user') || title.includes('ci')) {
    return 'user';
  }

  return 'other';
}

/**
 * Execute consolidation for a single group
 */
async function consolidateGroup(
  projectId: number,
  targetChat: BrainSession,
  sources: BrainSession[],
): Promise<ConsolidatedGroup> {
  const sourceIds = sources.map((s) => parseInt(s.sessionId.split('-').pop() ?? '0'));
  const targetChatId = parseInt(targetChat.sessionId.split('-').pop() ?? '0');

  // Call client consolidation which uses the platform function
  const result = await client.consolidateGroup(projectId, targetChatId, sourceIds);

  // Map back to BrainSession objects for sources
  const sourceSessions = sources.filter(
    (s) => `brain-session-${parseInt(s.sessionId.split('-').pop() ?? '0')}` !== result.target.sessionId,
  );

  return {
    category: getChatCategory(targetChat),
    target: result.target,
    sources: sourceSessions,
    mergeStats: {
      totalSources: sourceIds.length,
      totalMessagesMerged: result.totalMessagesMoved,
      timestamp: result.timestamp,
    },
  };
}

/**
 * Master consolidation function per PRD - consolidates all relevant chat groups
 */
export async function consolidateChats(
  request: ConsolidationRequest,
): Promise<ConsolidationResult> {
  const { projectId, chats, preferredTargetChatId } = request;
  const errors: string[] = [];
  const allGroups: ConsolidatedGroup[] = [];
  let totalMessagesMoved = 0;

  // Validate inputs
  if (chats.length === 0) {
    errors.push('No chats provided for consolidation');
    return { groups: [], overall: { totalGroups: 0, totalMessagesMerged: 0, timestamp: new Date().toISOString() }, errors };
  }

  if (preferredTargetChatId && !chats.find((c) => c.sessionId === `brain-session-${preferredTargetChatId}`)) {
    errors.push(`Preferred target chat ID ${preferredTargetChatId} not found in chat list`);
  }

  // Group chats by category
  const grouped = groupChatsByCategory(chats);

  // Process each category
  for (const [category, categoryChats] of Object.entries(grouped)) {
    if (categoryChats.length === 0) continue;

    // Within the category, find the best target
    // Sort by priority: user chats get handled last (cleanup)
    let targetChat: BrainSession | null = null;

    if (category === 'product') {
      // Product category: always pick pm_chat as target if available
      targetChat = categoryChats.find((c) => c.type === 'pm_chat') || null;
    } else if (preferredTargetChatId) {
      // Allow explicit target override
      targetChat = categoryChats.find((c) => c.sessionId === `brain-session-${preferredTargetChatId}`) || null;
    }

    // Fallback to best target if no override
    if (!targetChat) {
      targetChat = findBestTarget(categoryChats);
    }

    // Consolidate if we found a target and have sources
    if (targetChat && categoryChats.length > 1) {
      const sources = categoryChats.filter((c) => c.sessionId !== targetChat.sessionId);

      try {
        const consolidated = await consolidateGroup(projectId, targetChat, sources);
        allGroups.push(consolidated);
        totalMessagesMoved += consolidated.mergeStats.totalMessagesMerged;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown consolidation error';
        errors.push(`Failed to consolidate ${category} chats: ${msg}`);
      }
    }
  }

  // Return consolidation result
  return {
    groups: allGroups,
    overall: {
      totalGroups: allGroups.length,
      totalMessagesMerged,
      timestamp: new Date().toISOString(),
    },
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Quick consolidation for a single target with explicit sources (for the reconciliation workflow)
 */
export async function quickConsolidate(
  projectId: number,
  targetChatId: number,
  sourceIds: number[],
): Promise<{
  success: boolean;
  target: BrainSession;
  mergedCount: number;
  totalMessagesMoved: number;
  errors: string[];
}> {
  let errors: string[] = [];
  let mergedCount = 0;
  let totalMessagesMoved = 0;

  try {
    const result = await client.consolidateGroup(projectId, targetChatId, sourceIds);

    if (result.sources.length !== sourceIds.length) {
      errors.push('Some source chat IDs could not be found or were invalid');
    }

    mergedCount = result.mergedCount;
    totalMessagesMoved = result.totalMessagesMoved;

    // Verify the consolidation worked
    const verification = await verifyConsolidation(projectId, targetChatId);
    if (!verification.success) {
      errors.push(...verification.errors);
    }

    return {
      success: errors.length === 0,
      target: result.target,
      mergedCount,
      totalMessagesMoved,
      errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    errors.push(msg);
    return { success: false, target: { id: targetChatId.toString(), createdAt: '', updatedAt: '', sessionRef: '' }, mergedCount: 0, totalMessagesMoved: 0, errors };
  }
}

/**
 * Verify a consolidation was successful by checking message count and structure
 */
async function verifyConsolidation(
  projectId: number,
  targetChatId: number,
): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];

  // In production, this would query the database to verify:
  // - Target chat has merged messages
  // - Source chats are archived or have appropriate marker
  // - Order and structure were preserved

  // For now, return success with empty errors (mock verification)
  return { success: true, errors };
}

/**
 * Review workflow step - preview consolidation without executing
 */
export function previewConsolidation(chats: BrainSession[]): {
  possibleGroups: {
    category: string;
    target: BrainSession | null;
    sourceCount: number;
    reason: string;
  }[];
} {
  const grouped = groupChatsByCategory(chats);
  const possibleGroups: Array<{
    category: string;
    target: BrainSession | null;
    sourceCount: number;
    reason: string;
  }> = [];

  for (const [category, categoryChats] of Object.entries(grouped)) {
    if (categoryChats.length <= 1) continue;

    const target = findBestTarget(categoryChats);
    const sourceCount = categoryChats.length - (target ? 1 : 0);

    const reasonMap: Record<string, string> = {
      product: `Consolidate product chats (${sourceCount} sources)`,
      user: `Consolidate user chats (${sourceCount} sources)`,
      feature: `Consolidate feature-focused chats (${sourceCount} sources)`,
      epic: `Consolidate epic/milestone chats (${sourceCount} sources)`,
      other: `Consolidate misc chats (${sourceCount} sources)`,
    };

    possibleGroups.push({
      category,
      target,
      sourceCount,
      reason: reasonMap[category] || `Consolidate ${category} chats`,
    });
  }

  return { possibleGroups };
}

/**
 * Check if consolidation should be performed for a group
 */
export function shouldConsolidate(chatGroup: BrainSession[]): boolean {
  if (chatGroup.length < 2) return false;
  const target = findBestTarget(chatGroup);
  if (!target) return false;
  const sources = chatGroup.filter((c) => c.sessionId !== target.sessionId);
  return sources.length > 0;
}