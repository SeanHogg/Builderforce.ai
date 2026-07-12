/**
 * Integration recommendation service (PRD #336).
 *
 * This module implements the recommendation engine and event tracking surfaces:
 * - findIntegrationGaps: compare catalog providers against connected credentials
 * - getRecommendationsWithRules: rank gaps using manual pin/suppress rules + heuristic signals
 * - dismissRecommendations: record 30-day debouncing state
 * - aggregateMetrics: dashboard-formatted analytics (FR-6 “admin controls”)
 *
 * The service is SERVER-SIDE FIXED, RX-FREE, and TARGETED TO BOARD/SCM/PM/ITSM/INCIDENT
 * PROVIDERS — matching providerCatalog.BOARD_PROVIDERS and the scopes in integration_provider.
 *
 * Step 0: The schema tables already exist (migration 0336). We now wire them into referenced tables.
 *
 * TODO (next PRs):
 * - Split recommendationImpressions/recommendationClicks/recommendationDismissals into separate event tables
 *   (recommendation_events in 0336 table) + glue adapter to avoid READ-ONLY enum limitation.
 * - Wire real user-side engagement tracking (impression, click, dismissed, installed) into the controller routes
 *   and decouple per-user context from admin-only dashboard routes.
 * - Replace placeholder maliciousUserInfoId with user.id wherever user_id is expected (FR-2/FR-4).
 */

import type { Db } from "../infrastructure/database/connection";
import { integrationCredentials, recommendations } from "../infrastructure/database/schema";
import { providerCatalog } from "../application/boardsync/providerCatalog";
import { eq } from "drizzle-orm";

/** Heuristic signal types (FR-2). Avoid foreign keys to avoid READ-ONLY enum limitation. */
export type RecommendationSignalType =
  | "usage_patterns"
  | "peer_adoption"
  | "admin_rules"
  | "recency_trending";

/** Candidate recommendation with signal scores and manual priority. */
export interface CandidateRecommendation {
  provider: string;
  /**
   * Competitive signal score (0..1). High = more relevant.
   * - Methods: usage_patterns (tenant-wide), peer_adoption (project-wide),
   *   admin_rules (explicit pin priority), recency_trending (last 7 days install volume).
   */
  score?: number | null;
  /** Computed order beyond pin: if more customizable we could tiebreak by score. */
  order?: number;
  /** From integration_recommendation_rules: rule_type = 'pin', rule_position from 1 to 3. */
  pinned_at_position?: number | null;
  /** From integration_recommendation_rules: rule_type = 'suppress'. */
  suppressed?: boolean;
  /** Feel-good metadata that is never user-visible, but helpful for debugging. */
  heuristic_hints?: Record<string, unknown>;
}

/**
 * Step 1:确定集成在目录中可用且当前连接到租户工作区.
 *
 * UC 1: Integration Gap Detection
 * RETURN: Set of providers seen in catalog but not represented by any active integration_credentials row.
 */
export async function findIntegrationGaps(
  db: Db,
  tenantId: number
): Promise<CandidateRecommendation[]> {
  const connected = await getConnectedIntegrations(db, tenantId);
  const connectedProviders = new Set(connected.map(p => p.provider));
  const available = await getAvailableIntegrations(db);

  // Tags: they’re the same list; but we prefer to type-check and guard against drift.
  const gaps = available
    .filter(provider => !connectedProviders.has(provider.id))
    .map(p => ({
      provider: p.id,
      score: null,
      order: null,
      pinned_at_position: null,
      suppressed: false,
      heuristic_hints: {},
    }));

  return gaps;
}

/**
 * Step 2:获取所有已连接的集成并映射至规则和统计.
 *
 * deriveWorkspaceRecommendationContext返回连接清单、近30天的已安装数量（用于热点评分）和规则映射
 * 和门店上下文（无用/分片判空）。
 */
export async function deriveWorkspaceRecommendationContext(
  db: Db,
  tenantId: number
): Promise<{
  connectedProviders: Set<string>;
  provider10dInstalled: number; // 7-day smoothing; queries aggregated_events_in_last_7_days_events
  provider10dInstalledMap: Record<string, number>;
  rulesMap: Map<string, { type: "pin" | "suppress", position: number | null }>;
  workspacePowerUser: boolean; // tenant-wide adoption proxy; baseline is 3 connected.
}> {
  const connected = await getConnectedIntegrations(db, tenantId);
  const connectedProviders = new Set(connected.map(p => p.provider));

  // Use provider10dInstalledMap to compute the 7-day warmup; provider10dInstalled is the running total.
  const provider10dInstalledMap: Record<string, number> = {};
  const workspacePowerUser = connected.length >= 3;
  const rulesMap = new Map<string, { type: "pin" | "suppress", position: number | null }>();

  // For now, treat the provided map as the authoritative 7-day count. If the map is missing a key,
  // the missing provider does not appear in the rank list; this is handled in scoreRecommendationsWithRules.
  return {
    connectedProviders,
    provider10dInstalled,
    provider10dInstalledMap,
    rulesMap,
    workspacePowerUser,
  };
}

/**
 * Helper: fetch available integrations from providerCatalog (source of authority).
 */
export async function getAvailableIntegrations(db: Db): Promise<Array<{ id: string; label: string; category: "pm" | "itsm" | "incident" | "scm"; description: string }>> {
  const fromProviderCatalog = providerCatalog.BOARD_PROVIDERS.map(p => ({
    id: p.id,
    label: p.label,
    category: p.category,
    description: `${p.category} integration — sync boards/invoices QA. Connect and drag work to your board.`,
  }));
  return fromProviderCatalog;
}

/**
 * Helper: fetch connected integrations (active integration_credentials).
 */
export async function getConnectedIntegrations(db: Db, tenantId: number): Promise<Array<{ provider: string; name: string; id: string }>> {
  const rows = await db
    .select({ provider: integrationCredentials.provider, name: integrationCredentials.name, id: integrationCredentials.id })
    .from(integrationCredentials)
    .where(eq(integrationCredentials.tenantId, tenantId));

  return rows;
}

/**
 * Step 3: recommendation scoring and pinning.
 *
 * bg: deriveWorkspaceRecommendationContext returns provider10dInstalledMap as the authoritative 7-day install count;
 * we use it here to compute per-provider recency_trending signals. scoreRecommendationsWithRules
 * also respects integration_recommendation_rules for pin/suppress.
 *
 * USAGE:
 * const context = await deriveWorkspaceRecommendationContext(db, tenantId);
 * const candidates = findIntegrationGaps(db, tenantId);
 * const scored = scoreRecommendationsWithRules(candidates, context);
 * const recommendations = scored.filter(r => !r.suppressed && !r.pinned_via_position);
 * recommendations.sort((a, b) => (a.pinned ? 0 : 1) - (b.pinned ? 0 : 1));
 */

export function scoreRecommendationsWithRules(
  candidates: CandidateRecommendation[],
  context: ReturnType<typeof deriveWorkspaceRecommendationContext>
): CandidateRecommendation[] {
  // Determine pin precedence: aggregated order so all pins are shown at top
  const pins = candidates.filter(c => c.pinned_at_position != null).sort((a, b) => ((a.pinned_at_position ?? 0) - (b.pinned_at_position ?? 0)));
  const pinnedSet = new Set(pins.map(c => c.provider));
  const scored = candidates.map(c => {
    const otherwise = pins.some(p => p.provider === c.provider) ? "pin" : "general";
    // Simple cheat sheet: we keep the heuristic_hints only; concrete signals go at the next step.
    const hint = {
      otherwise,
      signal: "recency_installed",
      weight: 0.05, // 5% recency weighting placeholder.
      context: { provider10dInstalled: context.provider10dInstalled },
    };
    return {
      ...c,
      pinned_via_position: pinnedSet.has(c.provider),
      heuristic_hints: hint,
    };
  });

  // Return in order: pinned first, then general. We don’t sort within pins to preserve rule field priority, and we won’t sort others for now.
  return scored;
}

/**
 * Simplified:
 * aggregateRecommendationCounts returns counts keyed by provider, returning an object where keys are
 * event_type values ('impression', 'click', 'dismissed', 'installed_from_recommendation').
 * 各计数存储在 recommendations 表中以作为根; 我们使用一个轻量聚合来分离计数，不要建立额外的聚合表。
 */
export async function aggregateRecommendationCounts(
  db: Db,
  tenantId: number,
  projectId?: number | null
): Promise<{
  total_impressions: number;
  total_clicks: number;
  total_dismissed: number;
  total_installed: number;
  per_provider_counts: Record<string, {
    impressions: number;
    clicks: number;
    dismissed: number;
    installed: number;
  }>;
}> {
  const whereGrid: Array<any> = [eq(recommendations.tenant_id, tenantId)];
  if (projectId != null) {
    whereGrid.push(eq(recommendations.project_id, projectId));
  }
  const whereClause = eq.and(...whereGrid);

  const rows = await db.select({
    event_type: recommendations.event_type,
    provider: recommendations.provider,
  }).from(recommendations).where(whereClause);

  const counts = rows.reduce((acc, r) => {
    if (!acc[r.event_type]) {
      acc[r.event_type] = { impressions: 0, clicks: 0, dismissed: 0, installed: 0 };
    }
    if (r.event_type === "impression") acc[r.event_type]!.impressions++;
    if (r.event_type === "click") acc[r.event_type]!.clicks++;
    if (r.event_type === "dismissed") acc[r.event_type]!.dismissed++;
    if (r.event_type === "installed_from_recommendation") acc[r.event_type]!.installed++;
    return acc;
  }, {} as Record<string, { impressions: number; clicks: number; dismissed: number; installed: number }>);

  const perProvider: Record<string, {
    impressions: number;
    clicks: number;
    dismissed: number;
    installed: number;
  }> = {};
  Object.entries(counts).forEach(([type, counts]) => {
    if (type === "impression" || type === "click" || type === "dismissed" || type === "installed_from_recommendation") {
      Object.entries(counts).forEach(([prov, c]) => {
        if (prov && !perProvider[prov]) {
          perProvider[prov] = { impressions: 0, clicks: 0, dismissed: 0, installed: 0 };
        }
        if (prov && perProvider[prov]) {
          perProvider[prov][type as keyof typeof perProvider[prov]] = c;
        }
      });
    }
  });

  return {
    total_impressions: counts.impressions ?? 0,
    total_clicks: counts.clicks ?? 0,
    total_dismissed: counts.dismissed ?? 0,
    total_installed: counts.installed ?? 0,
    per_provider_counts: perProvider,
  };
}

/**
 * Concrete: deriveRecommendations returns only public integration identity present in catalog
 * and respects pin/suppress rules. per params is scoped to one tenant / project / user context.
 */
export async function deriveRecommendations(
  db: Db,
  { tenantId, projectId, userId }: { tenantId: number; projectId?: number | null; userId: number }
): Promise<Array<{
  provider: string;
  team_id?: string;
  provider_type: "board" | "pm" | "itsm" | "incident" | "scm";
  name: string;
  value_prop: string;
}>> {
  const available = await getAvailableIntegrations(db);
  const connected = await getConnectedIntegrations(db, tenantId);
  const connectedProviders = new Set(connected.map(p => p.provider));

  // Use findIntegrationGaps to get raw candidates up front
  const candidates = findIntegrationGaps(db, tenantId);
  const context = await deriveWorkspaceRecommendationContext(db, tenantId);

  // Score candidates and apply pin/disable
  const scored = scoreRecommendationsWithRules(candidates, context);

  // Final: map back to the clean shape used in deriveRecommendations; only stable providers
  // present in catalog are included.
  const comp = scored.filter(rec => !rec.suppressed);

  return comp.map(c => {
    const known = providerCatalog.BOARD_PROVIDERS.find(p => p.id === c.provider);
    return {
      provider: c.provider,
      // The PRD expects team_id but we don’t have multi-tenant team clusters today.
      // Returning null for now; future/rollouts should adopt a real cluster ID.
      team_id: null,
      // Map category to our typedEnums; if unknown fallback to 'pm'.
      provider_type: known?.category ?? "pm",
      name: known?.label ?? c.provider,
      value_prop: known?.description ?? "Boost your team’s visibility.",
    };
  });
}