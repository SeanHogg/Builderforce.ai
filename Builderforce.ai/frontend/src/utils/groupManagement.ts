/**
 * Group management utilities for chat grouping feature
 *
 * Handles user-initiated operations on topic groups:
 * - Renaming groups
 * - Merging groups
 * - Moving chats between groups
 * - Ungrouping chats
 */

import type {
  Chat,
  CustomTopicGroup,
  DetectedChatGroup,
  UnifiedChatGroup,
  CustomGroupingState,
} from '../types/group';

/**
 * Create a custom topic group
 */
export function createCustomGroup(
  name: string,
  ownerId: string,
  chatIds: string[] = []
): CustomTopicGroup {
  return {
    id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    description: '',
    chatIds,
    owner: ownerId,
    createdAt: Date.now(),
    lastModifiedAt: Date.now(),
    isCustom: true,
  };
}

/**
 * Rename a custom topic group
 */
export function renameGroup(
  groups: CustomTopicGroup[],
  groupId: string,
  newName: string
): CustomTopicGroup[] {
  return groups.map((group) =>
    group.id === groupId ? { ...group, name: newName, lastModifiedAt: Date.now() } : group
  );
}

/**
 * Merge multiple groups into a new group
 */
export function mergeGroups(
  groups: (CustomTopicGroup | DetectedChatGroup)[],
  sourceIds: string[],
  mergeInto: string,
  newGroupName: string,
  currentState: CustomGroupingState
): {
  newGroups: CustomTopicGroup[];
  updatedState: CustomGroupingState;
} {
  // Validate mergeInto target exists
  const targetGroup = groups.find((g) => g.id === mergeInto);
  if (!targetGroup) {
    throw new Error(`Target group ${mergeInto} not found`);
  }

  // Initialize as CustomTopicGroup for user-created merge
  const resultGroup: CustomTopicGroup = {
    ...createCustomGroup(newGroupName, mergeInto, []),
    description: `Merged from ${sourceIds.length} groups`,
  };

  // Combine chatIds from all source groups
  const combinedChatIds = new Set<string>();
  for (const sourceId of sourceIds) {
    const sourceGroup = groups.find((g) => g.id === sourceId);
    if (sourceGroup) {
      sourceGroup.chatIds.forEach((chatId) => combinedChatIds.add(chatId));
    }
  }

  // Create copy of groups excluding sources
  const otherGroups = groups.filter((g) => !sourceIds.includes(g.id));

  // If mergeInto is not CustomTopicGroup, convert it
  let finalTarget: CustomTopicGroup | DetectedChatGroup = targetGroup;
  if (!targetGroup.isCustom) {
    if (!currentState.groups.find((g) => g.id === mergeInto)) {
      finalTarget = createCustomGroup(
        targetGroup.name,
        'system',
        targetGroup.chatIds
      );
    } else {
      // Already a custom group, so it should be in otherGroups now (if we had detached it)
    }
  }

  // Build new state
  const newGroups = [
    ...otherGroups.filter((g) => g.id !== mergeInto),
    finalTarget,
    resultGroup,
  ] as (CustomTopicGroup | DetectedChatGroup)[];

  const newChatAssignments = new Map<string, string[][]>();
  for (const [chatId, groupIds] of currentState.chatAssignments.entries()) {
    if (!sourceIds.includes(chatId)) {
      newChatAssignments.set(chatId, groupIds);
    }
  }

  // Add moved chats to both mergeInto and result group
  combinedChatIds.forEach((chatId) => {
    if (!newChatAssignments.has(chatId)) {
      newChatAssignments.set(chatId, []);
    }
    newChatAssignments.get(chatId)!.push(resultGroup.id);
    newChatAssignments.get(chatId)!.push(finalTarget.id);
  });

  // Remove duplicates and sort
  for (const chatId of newChatAssignments.keys()) {
    const uniqueGroups = Array.from(
      new Set(newChatAssignments.get(chatId)!)
    ).sort();
    newChatAssignments.set(chatId, uniqueGroups);
  }

  return {
    newGroups: newGroups as CustomTopicGroup[],
    updatedState: {
      ...currentState,
      groups: newGroups as CustomTopicGroup[],
      chatAssignments: newChatAssignments,
    },
  };
}

/**
 * Move a chat from one group to another
 */
export function moveChat(
  groups: UnifiedChatGroup[],
  chatId: string,
  targetGroupId: string
): {
  updatedGroups: UnifiedChatGroup[];
} {
  // Find the chat's groups
  const chatGroupIds = groups
    .flatMap((group) => group.chatIds)
    .filter((id) => id === chatId);

  // If target doesn't exist or isn't a group containing the chat, create it
  let targetGroup = groups.find((g) => g.id === targetGroupId);
  let groupIdsToMove = chatGroupIds;

  if (!targetGroup) {
    // Create as custom group
    targetGroup = {
      ...createCustomGroup(
        `New Category ${groups.length + 1}`,
        'system',
        [],
        false
      ),
      id: targetGroupId,
    } as any; // Type override for dynamic creation

    // If we're just creating, don't move anything from same chat
    if (chatGroupIds.length === 0) {
      targetGroup.chatIds.push(chatId);
      return { updatedGroups: [...groups, targetGroup] };
    }
  }

  // Remove chat from all old groups
  const updatedGroups = groups.map((group) => {
    if (group.chatIds.includes(chatId)) {
      return {
        ...group,
        chatIds: group.chatIds.filter((id) => id !== chatId),
      } as UnifiedChatGroup;
    }
    return group;
  });

  // Add chat to target group
  return {
    updatedGroups: updatedGroups.map((group) =>
      group.id === targetGroupId
        ? (group.chatIds.includes(chatId)
            ? group
            : {
                ...group,
                chatIds: [...group.chatIds, chatId],
              }) as UnifiedChatGroup
        : group
    ),
  };
}

/**
 * Ungroup a chat (retire it to "Ungrouped" or top level)
 */
export function ungroupChat(
  groups: UnifiedChatGroup[],
  chatId: string
): {
  updatedGroups: UnifiedChatGroup[];
  ungroupedChatIds: string[];
} {
  let ungroupedCount = 0;
  const ungroupedChatIds: string[] = [chatId];
  const otherUngrouped: string[] = [];

  const updatedGroups = groups.map((group) => {
    const previouslyInGroup = group.chatIds.includes(chatId);
    const updated = {
      ...group,
      chatIds: group.chatIds.filter((id) => id !== chatId),
    } as UnifiedChatGroup;

    if (partiallyUngrouped(group.chatIds).length > 0) {
      otherUngrouped.push(chatId);
    }

    if (previouslyInGroup) {
      ungroupedCount++;
    }

    return updated;
  });

  const uniqueUngrouped = Array.from(new Set(ungroupedChatIds)).concat(
    otherUngrouped
  );

  return {
    updatedGroups,
    ungroupedChatIds: uniqueUngrouped,
  };
}

/**
 * Top-level helper to partially ungroup a group (if it meant ungrouping a subset)
 */
function partiallyUngroup(groupIds: string[]): string[] {
  if (groupIds.length === 0) return [];
  // If all chats are being ungrouped and group only had one content item, list that chat
  return groupIds;
}

/**
 * Get all unique chat IDs from groups
 */
export function getAllChatIds(groups: UnifiedChatGroup[]): string[] {
  return Array.from(new Set(groups.flatMap((group) => group.chatIds)));
}

/**
 * Get chat details for a specific chat ID across all groups
 */
export function getChatGroups(
  groups: UnifiedChatGroup[],
  chatId: string
): UnifiedChatGroup[] {
  return groups.filter((group) => group.chatIds.includes(chatId));
}

/**
 * Sort groups by chat count (descending)
 */
export function sortGroupsByCount(groups: UnifiedChatGroup[]): UnifiedChatGroup[] {
  return [...groups].sort((a, b) => b.chatIds.length - a.chatIds.length);
}

/**
 * Get the top 10 most frequent groups
 */
export function getTopGroups(groups: UnifiedChatGroup[], limit: number = 10): {
  groups: UnifiedChatGroup[];
  totalChatIds: number;
} {
  const top = sortGroupsByCount(groups).slice(0, limit);
  const totalChatIds = getAllChatIds(groups).length;
  return { groups: top, totalChatIds };
}

/**
 * Validate group name is unique
 */
export function isGroupNameUnique(
  groups: UnifiedChatGroup[],
  name: string,
  excludeId?: string
): boolean {
  return !groups.some((group) => group.name.toLowerCase() === name.toLowerCase() && group.id !== excludeId);
}