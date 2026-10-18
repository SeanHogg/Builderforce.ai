/**
 * Superadmin mint-on-behalf client for tenant API keys (bfk_*).
 * Copied `adminRequest` (not exported from adminApi) so this module does not
 * import adminApi.ts — that would be a cycle.
 */

import { adminRequest } from './apiClient';

export interface AdminTenantApiKeyUsageRow {
  id: number;
  createdAt: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  retries: number;
  streamed: boolean;
  useCase: string | null;
  metadata: Record<string, unknown> | null;
  idempotencyKey: string | null;
  userId: string | null;
}

export interface AdminTenantApiKeyUsageResult {
  summary: { total: number; totalTokens: number; modelCount: number };
  rows: AdminTenantApiKeyUsageRow[];
  days: number;
  page: number;
  limit: number;
}

export interface AdminTenantApiKey {
  id: string;
  name: string;
  createdByUserId: string | null;
  allowedOrigins: string[] | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface AdminMintedTenantApiKey {
  key: string;
  id: string;
  name: string;
  allowedOrigins: string[] | null;
  createdAt: string;
}

/** Tenant API keys (bfk_*) — superadmin mint-on-behalf. Spread onto `adminApi`. */
export const adminTenantKeysApi = {
  async listTenantApiKeys(tenantId: number): Promise<AdminTenantApiKey[]> {
    const res = await adminRequest<{ keys: AdminTenantApiKey[] }>(`/api/admin/tenants/${tenantId}/api-keys`);
    return res.keys ?? [];
  },

  async mintTenantApiKey(tenantId: number, input: { name: string; allowedOrigins?: string[] | null }): Promise<AdminMintedTenantApiKey> {
    return adminRequest<AdminMintedTenantApiKey>(`/api/admin/tenants/${tenantId}/api-keys`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateTenantApiKey(
    tenantId: number,
    keyId: string,
    patch: { name?: string; allowedOrigins?: string[] | null },
  ): Promise<AdminTenantApiKey> {
    const res = await adminRequest<{ key: AdminTenantApiKey }>(`/api/admin/tenants/${tenantId}/api-keys/${keyId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return res.key;
  },

  async revokeTenantApiKey(tenantId: number, keyId: string): Promise<void> {
    await adminRequest(`/api/admin/tenants/${tenantId}/api-keys/${keyId}`, { method: 'DELETE' });
  },

  async tenantApiKeyUsage(
    tenantId: number,
    keyId: string,
    params?: { days?: number; page?: number; limit?: number },
  ): Promise<AdminTenantApiKeyUsageResult> {
    const q = new URLSearchParams();
    if (params?.days  != null) q.set('days',  String(params.days));
    if (params?.page  != null) q.set('page',  String(params.page));
    if (params?.limit != null) q.set('limit', String(params.limit));
    const suffix = q.toString();
    return adminRequest<AdminTenantApiKeyUsageResult>(
      `/api/admin/tenants/${tenantId}/api-keys/${keyId}/usage${suffix ? `?${suffix}` : ''}`,
    );
  },
};
