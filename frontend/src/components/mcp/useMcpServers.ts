'use client';

/**
 * State for the workspace's bring-your-own MCP servers: the list, the mutations,
 * and the entitlement that decides whether any of it may be read at all.
 *
 * Owns data access only — no rendering — so the gallery and any future surface
 * (a canvas card, an onboarding step) share one contract with the API instead of
 * each re-implementing the fetch/refresh/error dance.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePermission } from '@/lib/rbac';
import { getStoredTenant } from '@/lib/auth';
import { faultMessage } from '@/lib/apiClient';
import {
  mcpExtensionsApi,
  type CreateMcpExtensionInput,
  type McpExtension,
  type UpdateMcpExtensionInput,
} from '@/lib/mcpExtensionsApi';

export interface McpServersState {
  /** True when this member may read/write the workspace's registered servers. */
  allowed: boolean;
  /** Role name the workspace requires, for the not-entitled hint. */
  requiredLabel: string;
  servers: McpExtension[];
  loading: boolean;
  /** Last failure, already reduced to displayable text. */
  error: string | null;
  reload: () => Promise<void>;
  create: (input: CreateMcpExtensionInput) => Promise<McpExtension | null>;
  update: (id: string, input: UpdateMcpExtensionInput) => Promise<McpExtension | null>;
  remove: (id: string) => Promise<boolean>;
  /** Resolves the consent URL; the CALLER navigates (a consent screen cannot be framed). */
  connectUrl: (id: string, returnTo?: string) => Promise<string | null>;
  disconnect: (id: string) => Promise<boolean>;
}

export function useMcpServers(): McpServersState {
  const { allowed, requiredLabel } = usePermission('mcp.manage');
  // `Tenant.id` is the JWT claim's string; every tenant-scoped client takes the
  // numeric id (see `BillingClient`), so the narrowing happens here rather than
  // being pushed into the API module for one caller.
  const storedTenantId = getStoredTenant()?.id;
  const tenantId = storedTenantId != null ? Number(storedTenantId) : null;
  const [servers, setServers] = useState<McpExtension[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!allowed || tenantId == null) return;
    setLoading(true);
    try {
      setServers(await mcpExtensionsApi.list(tenantId));
      setError(null);
    } catch (e) {
      setError(faultMessage(e));
    } finally {
      setLoading(false);
    }
  }, [allowed, tenantId]);

  useEffect(() => { void reload(); }, [reload]);

  /** Run one mutation, surface its failure as text, and refresh on success. */
  const mutate = useCallback(async <T,>(work: (tenant: number) => Promise<T>): Promise<T | null> => {
    if (!allowed || tenantId == null) return null;
    try {
      const result = await work(tenantId);
      setError(null);
      await reload();
      return result;
    } catch (e) {
      setError(faultMessage(e));
      return null;
    }
  }, [allowed, tenantId, reload]);

  return {
    allowed,
    requiredLabel,
    servers,
    loading,
    error,
    reload,
    create: (input) => mutate((tenant) => mcpExtensionsApi.create(tenant, input)),
    update: (id, input) => mutate((tenant) => mcpExtensionsApi.update(tenant, id, input)),
    remove: async (id) => (await mutate((tenant) => mcpExtensionsApi.remove(tenant, id))) !== null,
    connectUrl: async (id, returnTo) => {
      if (!allowed || tenantId == null) return null;
      try {
        const { authUrl } = await mcpExtensionsApi.oauthConnect(tenantId, id, returnTo);
        setError(null);
        return authUrl;
      } catch (e) {
        setError(faultMessage(e));
        return null;
      }
    },
    disconnect: async (id) => (await mutate((tenant) => mcpExtensionsApi.oauthDisconnect(tenant, id))) !== null,
  };
}
