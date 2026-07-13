/**
 * API client for capabilities CRUD operations.
 */

const API_BASE = '/api/capabilities';

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
  status?: string;
  priority?: string;
  tags?: string[];
  tenantId: string;
  created_by_user_id?: string;
}

export interface UpdateCapabilityDTO {
  title?: string;
  description?: string;
  category?: string;
  status?: string;
  priority?: string;
  tags?: string[];
}

export interface CreateCapabilityResponse extends Capability {
  id: string;
}

// Predefined values
export const VALID_STATUSES = [
  'draft',
  'proposed',
  'in_progress',
  'completed',
  'deprecated',
  'retired',
] as const;

export const VALID_CATEGORIES = [
  'security',
  'performance',
  'usability',
  'accessibility',
  'compliance',
  'scalability',
  'reliability',
  'scalable_score',
] as const;

/**
 * Create a new capability.
 * POST /api/capabilities
 */
export async function createCapability(data: CreateCapabilityDTO): Promise<Capability> {
  const res = await fetch(`${API_BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to create capability' }));
    throw new Error(error.error || 'Failed to create capability');
  }

  return res.json();
}

/**
 * List capabilities for tenant.
 * GET /api/capabilities
 */
export async function listCapabilities(
  status?: string,
  category?: string
): Promise<Capability[]> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  if (category) params.append('category', category);

  const url = params.toString() ? `${API_BASE}?${params}` : API_BASE;
  const res = await fetch(`${url}`);

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to list capabilities' }));
    throw new Error(error.error || 'Failed to list capabilities');
  }

  return res.json();
}

/**
 * Get a capability by ID.
 * GET /api/capabilities/:id
 */
export async function getCapabilityById(id: string): Promise<Capability> {
  const res = await fetch(`${API_BASE}/${id}`);

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Capability not found' }));
    throw new Error(error.error || 'Failed to get capability');
  }

  return res.json();
}

/**
 * Update a capability (title, status, etc.).
 * PATCH /api/capabilities/:id
 */
export async function updateCapability(
  id: string,
  data: UpdateCapabilityDTO
): Promise<Capability> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to update capability' }));
    throw new Error(error.error || 'Failed to update capability');
  }

  return res.json();
}

/**
 * Delete a capability.
 * DELETE /api/capabilities/:id
 */
export async function deleteCapability(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to delete capability' }));
    throw new Error(error.error || 'Failed to delete capability');
  }
}