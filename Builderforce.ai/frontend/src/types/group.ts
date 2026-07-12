/**
 * Custom topic group type for user-managed groupings
 */

import type { Chat } from './chat';

/**
 * Custom topic group created or modified by users
 */
export interface CustomTopicGroup extends DetectedChatGroup {
  id: string;
  name: string;
  description?: string;
  chatIds: string[];
  owner: string; // userId
  createdAt: number;
  lastModifiedAt: number;
  isCustom: true;
}

/**
 * Detected/auto-generated group based on topic analysis
 */
export interface DetectedChatGroup {
  id: string;
  category: string;
  name: string;
  description?: string;
  chatIds: string[];
  emoji?: string;
  color?: string;
  isCustom: false;
}

/**
 * Grouping helper to merge detected and custom groups
 */
export type UnifiedChatGroup =
  | (CustomTopicGroup & { isCustom: true })
  | (DetectedChatGroup & { isCustom: false });

/**
 * User state for custom grouping
 */
export interface CustomGroupingState {
  groups: CustomTopicGroup[];
  chatAssignments: Map<string, string[][]>; // chatId -> [groupId1, groupId2]
}

/**
 * Merge result when combining custom and detected groups
 */
export interface MergeGroupsResult {
  unifiedGroups: UnifiedChatGroup[];
  detectedGroups: DetectedChatGroup[];
  customGroups: CustomTopicGroup[];
}