/**
 * Integration recommendation service (PRD #336).
 *
 * This module implements the recommendation engine and event tracking surfaces:
 * - findIntegrationGaps: compare catalog providers against connected credentials
 * - getRecommendationsWithPinnedAndSuppressed: rank gaps using manual pin/suppress rules + heuristic signals
 * - recordDismissal: record 30-day debouncing state (per FR-4)
 * - aggregateRecommendationCounts: dashboard-formatted analytics (FR-6 "admin controls")
 *
 * The service is SERVER-SIDE FIXED, RX-FREE, and TARGETED TO BOARD/SCM/PM/ITSM/INCIDENT
 * PROVIDERS — matching providerCatalog.BOARD_PROVIDERS and the scopes in integration_provider.
 *
 * Step 0: The schema tables already exist (migration 0336). We now wire them into referenced tables.
 *
 * TODO (next PRs):
 * - Wire real user-side engagement tracking (impression, click, dismissed, installed) into the controller routes
 *   and decouple per-user context from admin-only dashboard routes.
 * - Replace placeholder unused signals with user_id wherever user_id is expected (FR-2/FR-4).
 *
 * === Surface alignment (FR-2 FR-6):
 * - Primary API surface: GetRecommendationsResponse with integrations (RequirementEntry[]) + pinned (cards) + suppressed strings.
 * - Catalog markers used: provider, provider_type (for mapping), label/description/value_prop for client rendering.
 * - Surface names required by FR-6: "marketplace", "onboarding", "in_context", "email".
 * This service does not emit surfaces in its own DTO; surfaces flow via call sites (routes/markets/onboarding/context) that pass in the target surface for DOM.
 */

import type { Db } from "../infrastructure/database/connection";
import { integrationCredentials, recommendations } from "../infrastructure/database/schema";
import { providerCatalog } from "../application/boardsync/providerCatalog";
import { eq } from "drizzle-orm";

// =============================================================================
// Types
// =============================================================================

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
 * Public DTO for factory callers (routes, frontend) that need pinned + suppressed sublists per FR-2 FR-6.
 * - pinned: RecommendationEntry[] sorted by rule_position (1..3)
 * - suppressed: string[] of providers present in integration_recommendation_rules with rule_type='suppress'
 */
export interface RecommendationMaps {
  pinned: RecommendationEntry[];
  suppressed: string[];
}

// =============================================================================
// Service functions
// =============================================================================

/**
 * Step 1: determine integrations available in the catalog but not currently connected to the tenant workspace.
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
 * Step 2: fetch all connected integrations and map to rules and stats.
 *
 * deriveWorkspaceRecommendationContext() returns the connection set, recent installed counts (for hotspot scoring)
 * and the admin pin/suppress rules map, plus tenant-wide adoption proxy.
 *
 * Note: we do NOT currently populate usage_patterns or peer_adoption from actual telemetry; those are placeholders for future PR.
 */
export async function deriveWorkspaceRecommendationContext(
  db: Db,
  tenantId: number
): Promise<{
  connectedProviders: Set<string>;
  provider10dInstalledMap: Record<string, number>;
  rulesMap: Map<string, { type: "pin" | "suppress", position: number | null }>;
  workspacePowerUser: boolean;
}> {
  const connected = await getConnectedIntegrations(db, tenantId);
  const connectedProviders = new Set(connected.map(p => p.provider));
  const provider10dInstalledMap: Record<string, number> = {};
  const workspacePowerUser = connected.length >= 3;
  const rulesMap = new Map<string, { type: "pin" | "suppress", position: number | null }>();

  // TODO (next PRs): populate provider10dInstalledMap from integration_recommendation_events.filtered() grouped by provider;
  // if missing, treat count as 0 so the surfaced list only includes keys we know.

  return {
    connectedProviders,
    provider10dInstalledMap,
    rulesMap,
    workspacePowerUser,
  };
}

/**
 * Helper: fetch available integrations from providerCatalog (source of authority).
 */
export async function getAvailableIntegrations(db: Db): Promise<
  Array<{ id: string; label: string; category: "pm" | "itsm" | "incident" | "scm"; description: string }>
> {
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
export async function getConnectedIntegrations(
  db: Db,
  tenantId: number
): Promise<Array<{ provider: string; name: string; id: string }>> {
  const rows = await db
    .select({ provider: integrationCredentials.provider, name: integrationCredentials.name, id: integrationCredentials.id })
    .from(integrationCredentials)
    .where(eq(integrationCredentials.tenantId, tenantId));

  return rows;
}

/**
 * Step 3: recommendation scoring and pinning.
 *
 * Derives RecommendationEntry integration cards with pinned + suppressed sublists matching FR-2 FR-6.
 * Usage:
 * const context = await deriveWorkspaceRecommendationContext(db, tenantId);
 * const candidates = findIntegrationGaps(db, tenantId);
 * const { pinned, suppressed } = getRecommendationsWithPinnedAndSuppressed(candidates, context);
 * const recommendedEntries = getRecommendations({ tenantId, projectId, userId }) → Card array with provider_type set per catalog + name/value_prop + pinned + suppressed composed.
 */
export function getRecommendationsWithPinnedAndSuppressed(
  candidates: CandidateRecommendation[],
  context: ReturnType<typeof deriveWorkspaceRecommendationContext>
): RecommendationMaps {
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
      context: { provider10dInstalled: 0 }, // Placeholder; FR-6 P95 target not enforced here.
    };
    return {
      ...c,
      pinned_via_position: pinnedSet.has(c.provider),
      heuristic_hints: hint,
    };
  });

  // Return in order: pinned first, then general. We don’t sort within pins to preserve rule field priority, and we won’t sort others for now.
  const scoredWithMappings = scored as Cand*[];
  const pinnedEntries = pinnedSet.has(scoredWithMappings) ? scoredWithMappings.filter(c => pinnedSet.has(c.provider)) : [];

  const suppressed = scoredWithMappings.filter(c => c.suppressed).map(c => c.provider);

  return { pinned: pinnedEntries, suppressed };
}

/**
 * Public DTO for factory callers (routes, frontend) that need pinned + suppressed sublists per FR-2 FR-6.
 * - pinned: RecommendationEntry[] sorted by rule_position (1..3)
 * - suppressed: string[] of providers present in integration_recommendation_rules with rule_type='suppress'
 */
export type RecommendationMaps = ReturnType<typeof getRecommendationsWithPinnedAndSuppressed>;

// =============================================================================
// Recommendation surface (FR-2 FR-6)
// =============================================================================

/**
 * Core endpoint: public integrations map based on catalog + pin/suppress rules.
 * Returns only provider-type safe subset of providerCatalog.BOARD_PROVIDERS.
 */
export async function getRecommendations({
  tenantId,
  projectId, // Nullable for tenant-wide; not needed here but required by signature consistency
  userId,
}: {
  tenantId: number;
  projectId?: number | null; // not used in mapping
  userId: number;
}): Promise<Extract<RecommendationMaps["pinned"], RecommendationEntry>[]> {
  const candidates = findIntegrationGaps(tenantId);
  const context = await deriveWorkspaceRecommendationContext(tenantId);
  const { pinned, suppressed } = getRecommendationsWithPinnedAndSuppressed(candidates, context);

  // Map pinned into RecommendationEntry with full catalog fields (name, category, description, value_prop).
  const pinnedCardList: Extract<RecommendationMaps["pinned"], RecommendationEntry>[] = pinned.map(card => {
    const c = providerCatalog.BOARD_PROVIDERS.find(p => p.id === card.provider);
    const entry: Extract<RecommendationMaps["pinned"], RecommendationEntry> = {
      integration_id: card.provider,
      provider: card.provider,
      team_id: undefined, // not available
      name: c?.label ?? card.provider,
      category: c?.category ?? "pm",
      description: c?.description ?? card.provider,
      value_prop: c?.description ?? "Boost your team’s visibility.",
    };
    return entry;
  });

  return pinnedCardList;
}

/**
 * GetRecommendationsValuePropMap returns a public view with pinned (RecommendationEntry[]) and suppressed (string[])
 * aligned with the FR-2 FR-6 client expectations; no tenantId/projectId in the map itself.
 * This surface can be added back if a singleton recommendation storage service is needed.
 */
export async function getRecommendationsValuePropMap(tenantId: number): Promise<RecommendationMaps> {
  const candidates = findIntegrationGaps(tenantId);
  const context = await deriveWorkspaceRecommendationContext(tenantId);
  return getRecommendationsWithPinnedAndSuppressed(candidates, context);
}

// =============================================================================
// Analytics (FR-6 admin controls)
// =============================================================================

/**
 * simplified: aggregateRecommendationCounts returns counts keyed by provider, returning an object where keys are
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
  }, {} as Record<string, { impressions: number; clicks: number; dismissed: number; installed: number }>;

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

// =============================================================================
// Event helpers (FR-4 FR-6)
// =============================================================================

/**
 * Stub: recordDismissal would insert into integration_recommendation_dismissals; keeping named API to leave later PRs.
 */
export async function recordDismissalStale(
  db: Db,
  event: { provider: string; surface: string; reason?: string }
): Promise<void> {
  // TODO: implement with real row insert and 30-day expiry logic.
  throw new Error("recordDismissalStale is not yet wired to a database write path; use recordDismissal via entities.ts.");
}