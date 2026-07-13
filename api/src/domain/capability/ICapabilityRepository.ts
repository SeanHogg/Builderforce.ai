/**
 * Domain interface for capability repository operations.
 */

export interface Capability {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: 'draft' | 'proposed' | 'in_progress' | 'completed' | 'deprecated' | 'retired';
  priority: string | null;
  tags: string[] | null;
  created_by_user_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateCapabilityDTO {
  title: string;
  description?: string;
  category?: string;
  status?: 'draft' | 'proposed' | 'in_progress' | 'completed' | 'deprecated' | 'retired';
  priority?: string;
  tags?: string[];
  tenantId: string;
  created_by_user_id?: string;
}

export interface UpdateCapabilityDTO {
  title?: string;
  description?: string;
  category?: string;
  status?: 'draft' | 'proposed' | 'in_progress' | 'completed' | 'deprecated' | 'retired';
  priority?: string;
  tags?: string[];
}

export interface CapabilityListParams {
  tenantId: string;
  status?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export type Id = string; // UUID