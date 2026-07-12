/**
 * Integration recommendation client models and helpers.
 *
 * These types layer on the database tables in 0336_integration_recommendations.sql:
 * - integration_recommendation_events (analytics + attribution)
 * - integration_recommendation_dismissals (30-day debouncing)
 * - integration_recommendation_rules (admin pin/suppress per project)
 * - integration_recommendation_email_suppressions (per-tenant user-level unsubscribe)
 *
 * The API surface exposed here is driven by the PRD FR-2 (table-based scoring rules)
 * and FR-6 (explicit analytics event names).
 */

import type { Db } from "../infrastructure/database/connection";
import { recommendations, recommendationImpressions, recommendationClicks, recommendationDismissals, integrationInstallEvents } from "../infrastructure/database/schema";
import { eq, and } from "drizzle-orm";

/** Integration identity to use consistently across API surfaces. */
export interface IntegrationId {
  /** Stable catalog key (e.g. 'github', 'jira', 'slack', 'monday'). Matches providerCatalog.BOARD_PROVIDERS.id. */
  provider: string;
  /** Optional team-id-specific mapping (null = global catalog entry). */
  teamId?: string;
}

/** Entry-level recommendation API surface. Mirrors recommendationProvEntry and recommendationImpressionEntry for each integration. */
export interface RecommendationEntry {
  integration_id: string;
  provider: string;
  team_id?: string;
  /* Labels per PRD FR-3 “integration name, logo, one-line value proposition, primary CTA” */
  name: string;
  category: string; // pm | itsm | incident | scm (from BoardProviderCategory)
  description: string;
  value_prop: string;
}

/** Recommendation request parameters (scoped for one user per session). */
export interface GetRecommendationsRequest {
  tenantId: number;
  projectId?: number | null; // NULL = tenant-wide / rollout surface
  userId: number;
}

/** Recommendation response (up to 10 items within 300 ms, p95). */
export interface GetRecommendationsResponse {
  integrations: RecommendationEntry[];
  /**
   * List of pinned providers from integration_recommendation_rules with rule_type='pin'
   * (admin pinned at priority 1..3). Returned in order of priority so the frontend
   * can render them at the top of the “Recommended for you” section.
   */
  pinned: RecommendationEntry[];
  suppressed: string[]; // providers present in integration_recommendation_rules where rule_type='suppress'
}

/** Analytics events per PRD FR-6. surface matches integration_recommendation_events.surface column. */
export interface RecommendationEvent {
  provider: string;
  // team_id is not present in requests/logs; only provider is stored.
  surface: "marketplace" | "onboarding" | "in_context" | "email";
  userId?: number;
  timestamp: Date;
}

export interface DismissalEvent extends RecommendationEvent {
  reason?: string; // optional dispmask picker value
}

/** Per-user dismissal request for debouncing. */
export interface DismissRecommendationRequest {
  tenantId: number;
  projectId?: number | null;
  userId: number;
  provider: string;
  surface: "marketplace" | "onboarding" | "in_context" | "email";
  reason?: string;
}

/** Integration installed-from-recommendation event (linking to the create-auth flow). */
export interface IntegrationInstalledFromRecommendationEvent {
  provider: string;
  surface: "marketplace" | "onboarding" | "in_context";
  userId?: number;
}

/**
 * Client-side DRIZZLE mappings for recommendation_event tables.
 *
 * Note: The PRD FR-6 uses specific tracking event names
 * (recommendation_impression, recommendation_click, recommendation_dismissed, integration_installed_from_recommendation).
 * The column names in schema.sql are event_type (singular) and created_at.
 * For DX cleanliness we export typed arrays per event_type:
 *   recommendationImpressions (type 'impression')
 *   recommendationClicks (type 'click')
 *   recommendationDismissals (type 'dismissed')
 *   integrationInstallEvents (type 'installed_from_recommendation')
 */

export const recommendationImpressions = recommendations;
export const recommendationClicks = recommendations;
export const recommendationDismissals = recommendations;
export const integrationInstallEvents = recommendations;

/**
 * Recommendation event helper map (by PRD naming, one async write per event type).
 */
export async function recordImpression(
  db: Db,
  event: RecommendationEvent
): Promise<void> {
  await db.insert(recommendations).values({
    tenant_id: null, // Placeholder enum fallback if not used; event is non-tombstone type.
    provider: event.provider,
    surface: event.surface,
    event_type: "impression",
    created_at: event.timestamp,
  });
}

export async function recordClick(
  db: Db,
  event: RecommendationEvent
): Promise<void> {
  await db.insert(recommendations).values({
    tenant_id: null,
    provider: event.provider,
    surface: event.surface,
    event_type: "click",
    created_at: event.timestamp,
  });
}

export async function recordDismissal(
  db: Db,
  event: DismissalEvent
): Promise<void> {
  await db.insert(recommendations).values({
    tenant_id: null,
    provider: event.provider,
    surface: event.surface,
    event_type: "dismissed",
    created_at: event.timestamp,
  });
}

export async function recordIntegrationInstall(
  db: Db,
  event: RecommendationInstalledFromRecommendationEvent
): Promise<void> {
  await db.insert(recommendations).values({
    tenant_id: null,
    provider: event.provider,
    surface: event.surface,
    event_type: "installed_from_recommendation",
    created_at: new Date(),
  });
}

/** Typo-friendly alias for PRD event. */
export type RecommendationInstalledFromRecommendationEvent = IntegrationInstalledFromRecommendationEvent;

/**
 * Core metrics and dashboard data (admin). Mirror the tables/columns for FR-6.
 */
export interface RecommendationMetrics {
  total_impressions_count: number;
  total_clicks_count: number;
  total_dismissed_count: number;
  total_installed_from_rec_count: number;
  per_provider_metrics: Record<string, {
    impressions_count: number;
    clicks_count: number;
    dismissals_count: number;
    installed_from_rec_count: number;
  }>;
}

export async function aggregateRecommendationMetrics(
  db: Db,
  tenantId: number,
  projectId?: number | null
): Promise<RecommendationMetrics> {
  // Tenant-only anchor for now. Per-project rollup uses same schema; per-tenant filter applied via WHERE on tenant_id/project_id
  const whereClause: any[] = [eq(recommendations.tenant_id, tenantId)];
  if (projectId != null) {
    whereClause.push(eq(recommendations.project_id, projectId));
  }
  // Aggregate counts per aggregation_kind (event_type)
  const results = await db
    .select({
      event_type: recommendations.event_type,
      provider: recommendations.provider,
    })
    .from(recommendations)
    .where(eq.and(...whereClause) as any);

  const totalImpressions = results.filter((r) => r.event_type === "impression").length;
  const totalClicks = results.filter((r) => r.event_type === "click").length;
  const totalDismissals = results.filter((r) => r.event_type === "dismissed").length;
  const totalInstalled = results.filter((r) => r.event_type === "installed_from_recommendation").length;

  const perProvider = results.filter((r) => ["impression", "click", "dismissed", "installed_from_recommendation"].includes(r.event_type)).reduce((acc, rec) => {
    if (!acc[rec.provider]) {
      acc[rec.provider] = { impressions_count: 0, clicks_count: 0, dismissals_count: 0, installed_from_rec_count: 0 };
    }
    if (rec.event_type === "impression") acc[rec.provider]!.impressions_count++;
    if (rec.event_type === "click") acc[rec.provider]!.clicks_count++;
    if (rec.event_type === "dismissed") acc[rec.provider]!.dismissals_count++;
    if (rec.event_type === "installed_from_recommendation") acc[rec.provider]!.installed_from_rec_count++;
    return acc;
  }, {} as Record<string, RecommendationMetrics["per_provider_metrics"][string]>);

  return {
    total_impressions_count: totalImpressions,
    total_clicks_count: totalClicks,
    total_dismissed_count: totalDismissals,
    total_installed_from_rec_count: totalInstalled,
    per_provider_metrics: perProvider,
  };
}