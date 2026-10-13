/**
 * The operator's Insights client — `/api/admin/replay-ops/*` (PRD 33 D8, D9, D17).
 *
 * Aggregates only: the platform summary, a workspace's two Insights switches and
 * the audited credit grant. Never a site, visitor or recording — Builderforce reads
 * its own recordings in the Insights app as a member of its workspace (D17).
 *
 * Its own module rather than more of `adminApi.ts` (which is not grown). Every
 * path comes from the shared `REPLAY_PATHS` and every shape from
 * `@builderforce/interaction-contract`, so the API and this client cannot drift.
 */

import {
  REPLAY_PATHS,
  type ReplayCreditGrantInput,
  type ReplayCreditGrantResult,
  type ReplayMethodFunnelSeedDto,
  type ReplayOpsSummaryDto,
  type ReplayTenantSettings,
} from '@builderforce/interaction-contract';
import { apiRequest } from './apiClient';
import { getStoredWebToken } from './auth';
import { fill } from './replayHttp';

async function opsRequest<T>(path: string, init: { method?: string; body?: string } = {}): Promise<T> {
  if (!getStoredWebToken()) throw new Error('Not authenticated. Sign in with a superadmin account.');
  return apiRequest<T>(path, { ...init, auth: 'web' });
}

const tenantSettingsPath = (tenantId: number) => fill(REPLAY_PATHS.opsTenantSettings, { tenantId });

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
    return opsRequest(REPLAY_PATHS.opsGrants, { method: 'POST', body: JSON.stringify(input) });
  },
  /** Seed "The method" funnel + its four smart events on one site (PRD 33 §5.3.6). Idempotent. */
  seedMethodFunnel(siteId: string): Promise<ReplayMethodFunnelSeedDto> {
    return opsRequest(fill(REPLAY_PATHS.opsSeedMethodFunnel, { siteId }), { method: 'POST' });
  },
};
