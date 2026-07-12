/* eslint-disable max-len */
import type { MemoryCategory } from '../../memory-lancedb/config.js';

export const RELATIONSHIP_TYPES = ['similar_to' as const, 'subset_of' as const, 'contains_subset' as const] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

/*                                                                    */
export const RELATIONSHIP_STATUS = ['pending' as const, 'computing' as const, 'ready' as const, 'expired' as const, 'rejected' as const] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUS)[number];

/*                                                                    */
export const SCORE_CATEGORIES = ['overlap_score' as const, 'semantic_similarity' as const, 'subset_coverage' as const] as const;
export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];

/*                                                                    */
export type chat_entry_id = string;

export type ChatEntry = {
  id: chat_entry_id;
  content: string;
  user_id: string;
  created_at: number;
  updated_at?: number;
  metadata?: Record<string, unknown>;
};

export type relationship_entry_id = string;

export type RelationshipEntry = {
  id: relationship_entry_id;
  type: RelationshipType;
  from_id: string;
  to_id: string;
  status: RelationshipStatus;
  scores: {
    [SC in ScoreCategory]?: number; /* 0.0 - 1.0 */
  };
  config_overrides?: {
    [SC in SCORE_CATEGORIES]?: number; /* per-API config overrides */
  };
  computed_at?: number;
  expires_at?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type list_chats_params = {
  user_id?: string;
  limit?: number;
  offset?: number;
  metadata_filter?: Partial<Record<string, unknown>>;
  sort_by?: 'created_at' | 'updated_at' | 'content_length';
  sort_order?: 'asc' | 'desc';
};

export type list_chat_response = {
  chats: ChatEntry[];
  total: number;
  has_more: boolean;
};

export type list_relationships_params = {
  from_id?: string;
  to_id?: string;
  type?: RelationshipType;
  status?: RelationshipStatus;
  limit?: number;
  offset?: number;
  sort_by?: 'computed_at' | 'overlap_score' | 'semantic_similarity';
  sort_order?: 'asc' | 'desc';
};

export type list_relationships_response = {
  relationships: RelationshipEntry[];
  total: number;
  has_more: boolean;
};

export type create_relationship_request = {
  from_id: string;
  to_id: string;
  type: RelationshipType;
  scores?: Partial<Record<ScoreCategory, number>>;
  config_overrides?: Partial<Record<ScoreCategory, number>>;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type create_relationship_response = {
  relationship: RelationshipEntry;
  action: 'created' | 'duplicate';
};

export type request_recalculation_request = {
  relationship_id: relationship_entry_id;
  include_ids?: string[]; /* optional override of sources */
};

export type request_recalculation_response = {
  relationship_id: relationship_entry_id;
  status: RelationshipStatus;
  message: string;
};

export type relationship_diagnostics = {
  missing_ids?: string[]; /* unsupported/missing sources */
  reasons?: string[]; /* capture retry justification when status == 'pending' */
};

export type deprecate_relationship_response = {
  relationship_id: relationship_entry_id;
  old_status: RelationshipStatus;
  reason?: string;
};