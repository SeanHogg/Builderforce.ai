/**
 * capabilitiesApi - Type-safe API client for capability CRUD operations.
 *
 * Provides typed wrappers around:
 * - GET /api/capabilities (list)
 * - POST /api/capabilities (create)
 * - PATCH /api/capabilities/:id (update)
 * - DELETE /api/capabilities/:id (delete)
 */

export interface Capability {
  id: string;
  title: string;
  description?: string;
  category: string;
  status: 'draft' | 'proposed' | 'in_progress' | 'completed' | 'deprecated' | 'retired';
  priority?: string;
  tags?: string[];
  tenantId: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCapabilityDTO {
  title: string;
  description?: string;
  category?: string;
  status: 'draft' | 'proposed' | 'in_progress' | 'completed' | 'deprecated' | 'retired';
  priority?: string;
  tags?: string[];
  tenantId: string;
  created_by_user_id: string;
}

export interface UpdateCapabilityDTO {
  title?: string;
  description?: string;
  category?: string;
  status?: 'draft' | 'proposed' | 'in_progress' | 'completed' | 'deprecated' | 'retired';
  // Note: Priority and tags removed from DTO for simplicity (committing to status-only updates)
  priority?: string;
  tags?: string[];
  tenantId?: string;
  updated_by_user_id?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Base API configuration
const BASE_API_URL = '/api/capabilities';

/**
 * Fetch capabilities from the server and return a typed array.
 *
 * @returns Promise<Capability[]> - Array of capabilities
 */
export async function listCapabilities(): Promise<Capability[]> {
  const response = await fetch(BASE_API_URL, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP ${response.status}: Failed to fetch capabilities`);
  }

  const data: ApiResponse<Capability[]> = await response.json();
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to retrieve capabilities');
  }

  return data.data;
}

/**
 * Create a new capability.
 *
 * @param dto - CreateCapabilityDTO containing the required and optional fields
 * @returns Promise<Capability> - The created capability
 */
export async function createCapability(dto: CreateCapabilityDTO): Promise<Capability> {
  const response = await fetch(BASE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP ${response.status}: Failed to create capability`);
  }

  const data: ApiResponse<Capability> = await response.json();
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to create capability');
  }

  return data.data;
}

/**
 * Update a capability by ID.
 * Supports partial updates for fields like status and title.
 *
 * @param id - Capability ID
 * @param dto - UpdateCapabilityDTO with fields to update
 * @returns Promise<Capability> - The updated capability
 */
export async function updateCapability(
  id: string,
  dto: UpdateCapabilityDTO
): Promise<Capability> {
  const response = await fetch(`${BASE_API_URL}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP ${response.status}: Failed to update capability`);
  }

  const data: ApiResponse<Capability> = await response.json();
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to update capability');
  }

  return data.data;
}

/**
 * Delete a capability by ID.
 *
 * @param id - Capability ID
 */
export async function deleteCapability(id: string): Promise<void> {
  const response = await fetch(`${BASE_API_URL}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || `HTTP ${response.status}: Failed to delete capability`);
  }

  // Expect 204 No Content for successful delete
  if (response.status !== 204) {
    const data: ApiResponse<void> = await response.json();
    if (!data.success) {
      throw new Error(data.message || 'Failed to delete capability');
    }
  }
}

/**
 * Fetch capabilities with optional filtering.
 * (Future enhancement — not required for PRD v1)
 */
export async function fetchCapabilities(
  options?: {
    filterCategory?: string;
    filterStatus?: string;
    limit?: number;
  }
): Promise<Capability[]> {
  const params = new URLSearchParams();
  if (options?.filterCategory) params.append('category', options.filterCategory);
  if (options?.filterStatus) params.append('status', options.filterStatus);
  if (options?.limit) params.append('limit', String(options.limit));

  const response = await fetch(`${BASE_API_URL}?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: Failed to fetch capabilities`);
  }

  const data: ApiResponse<Capability[]> = await response.json();
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Failed to retrieve capabilities');
  }

  return data.data;
}