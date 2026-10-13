/**
 * The operator's Insights client — `/api/admin/replay-ops/*` (PRD 33 D8, D9, D17).
 *
 * Aggregates only: the platform summary, a workspace's two Insights switches and
 * the audited credit grant. Never a site, visitor or recording — Builderforce reads
 * its own recordings in the Insights app as a member of its workspace (D17).
 *
 * Its own module rather than more of `adminApi.ts` (which is not grown). The summary
 * path comes from the shared `REPLAY_PATHS`; the settings and grant paths are
 * admin-only and live here.
 */

import { REPLAY_PATHS, type ReplayMethodFunnelSeedDto, type ReplayOpsSummaryDto } from '@builderforce/interaction-contract';
import { apiRequest } from './apiClient';
import { getStoredWebToken } from './auth';

const OPS_BASE = '/api/admin/replay-ops';

/** `tenants.settings` keys the operator controls (D8, D9). */
export interface ReplayTenantSettings {
  replayExcluded: boolean;
  /** Null = the catalog's free allowance applies. */
  replayFreeAllowanceOverride: number | null;
}

export interface ReplayCreditGrantInput {
  tenantId: number;
  units: number;
  reason: string;
}

export interface ReplayCreditGrantResult {
  auditId: string;
  reference: string;
  units: number;
  /** The workspace's spendable credits after the grant. */
  credits: number;
}

async function opsRequest<T>(path: string, init: { method?: string; body?: string } = {}): Promise<T> {
  if (!getStoredWebToken()) throw new Error('Not authenticated. Sign in with a superadmin account.');
  return apiRequest<T>(path, { ...init, auth: 'web' });
}

const tenantSettingsPath = (tenantId: number) => `${OPS_BASE}/tenants/${encodeURIComponent(String(tenantId))}/settings`;

export const replayOpsApi = {
  summary(): Promise<ReplayOpsSummaryDto> {
    return opsRequest(REPLAY_PATHS.opsSummary);
  },
  tenantSettings(tenantId: number): Promise<ReplayTenantSettings> {
    return opsRequest(tenantSettingsPath(tenantId));
  },
  updateTenantSettings(tenantId: number, patch: Partial<ReplayTenantSettings>): Promise<ReplayTenantSettings> {
    return opsRequest(tenantSettingsPath(tenantId), { method: 'PATCH', body: JSON.stringify(patch) });
  },
  grantCredits(input: ReplayCreditGrantInput): Promise<ReplayCreditGrantResult> {
    return opsRequest(`${OPS_BASE}/grants`, { method: 'POST', body: JSON.stringify(input) });
  },
  /** Seed "The method" funnel + its four smart events on one site (PRD 33 §5.3.6). Idempotent. */
  seedMethodFunnel(siteId: string): Promise<ReplayMethodFunnelSeedDto> {
    return opsRequest(REPLAY_PATHS.opsSeedMethodFunnel.replace(':siteId', encodeURIComponent(siteId)), { method: 'POST' });
  },
};
