/**
 * Integration recommendation routes (PRD #336).
 *
 * Endpoints:
 * - GET /api/integrations/recommendations?projectId=<id>&userId=<id>
 *   → ranked list of integrations not installed in the given scope (FR-2).
 * - GET /api/integrations/recommendations/analytics?projectId=<id>
 *   → aggregated metrics for admin dashboard (FR-6).
 * - POST /api/integrations/recommendations/dismiss
 *   → record user dismissal with 30-day expiry (FR-4).
 *
 * All writes go directly into 0336_integration_recommendations tables:
 * - integration_recommendation_events
 * - integration_recommendation_dismissals
 * - integration_recommendation_rules (pin/suppress) — currently no admin endpoints
 * - integration_recommendation_email_suppressions — reserved for email digests (FR-7)
 *
 * Public surfaces (no role gates yet) are opinionated around PRD usage:
 * - Admin pin/suppress logic is applied by scoring in recommendationsService.ts
 * - Analytics are read-only projection for now.
 */

import { Hono } from "hono";
import { authMiddleware } from "../middleware/authMiddleware";
import type { HonoEnv } from "../../env";
import type { Db } from "../../infrastructure/database/connection";
import {
  getRecommendations,
  aggregateRecommendationCounts,
} from "../../application/integrationRecommendation/recommendationService";
import { recordDismissal } from "../../application/integrationRecommendation/entities";
import { integrationCredentials, recommendations } from "../../infrastructure/database/schema";
import { eq } from "drizzle-orm";

/**
 * Recommendation analytics tooltip: aggregated counts with no P95 target
 * but aligned with FR-6 event naming simplifications.
 */
export interface AnalyticsResponse {
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

/**
 * /api/integrations/recommendations?projectId=<id>&userId=<id>
 * - Returns up to 10 integrations (FR-1 FR-2).
 * - Does NOT return summaries for all tenants.
 */
const router = new Hono<HonoEnv>();
router.use("*", authMiddleware);

function summarizeRecommendations(integrations) {
  return integrations.map(i => ({
    integration_id: i.provider,
    team_id: i.team_id,
    provider_type: i.provider_type,
    name: i.name,
    value_prop: i.value_prop,
    category: i.provider_type,
  }));
}

router.get("/", async (c) => {
  const db = c.get("db") as Db;
  const tenantId = c.get("tenantId") as number;
  const userId = c.get("userId") as number;
  const projectIdStr = c.req.query("projectId");
  const userIdParam = c.req.query("userId");

  const projectId = projectIdStr ? Number(projectIdStr) : null;
  const requestUserId = userIdParam ? Number(userIdParam) : userId;

  // Fetch from PRD scoring layer
  const integrations = await getRecommendations(db, {
    tenantId,
    projectId,
    userId: requestUserId,
  });

  const mapped = summarizeRecommendations(integrations);

  return c.json({ integrations: mapped.slice(0, 10), total: mapped.length });
});

/**
 * /api/integrations/recommendations/analytics?projectId=<id>
 * Public summary (no auth gate yet, for admin read projection).
 */
router.get("/analytics", async (c) => {
  const db = c.get("db") as Db;
  const tenantId = c.get("tenantId") as number;
  const projectIdStr = c.req.query("projectId");
  const projectId = projectIdStr ? Number(projectIdStr) : null;

  const counts = await aggregateRecommendationCounts(db, tenantId, projectId);
  const analytics: AnalyticsResponse = {
    total_impressions_count: counts.total_impressions,
    total_clicks_count: counts.total_clicks,
    total_dismissed_count: counts.total_dismissed,
    total_installed_from_rec_count: counts.total_installed,
    per_provider_metrics: counts.per_provider_counts,
  };

  return c.json(analytics);
});

/**
 * POST /api/integrations/recommendations/dismiss
 * - Records dismissal and sets a 30-day expiry row (FR-4).
 * - The request DOES NOT include a Depth-level ID, so we populate
 *   integration_recommendation_dismissals with NULL id placeholders.
 */
router.post("/dismiss", async (c) => {
  const db = c.get("db") as Db;
  const tenantId = c.get("tenantId") as number;
  const userId = c.get("userId") as number;
  const projectIdStr = c.req.query("projectId");
  const projectId = projectIdStr ? Number(projectIdStr) : null;

  const body = await c.req.json<{ provider: string; surface: string; reason?: string }>();
  if (!body.provider || !body.surface) {
    return c.json({ error: "provider and surface are required" }, 400);
  }

  const surfaces = [
    "marketplace",
    "onboarding",
    "in_context",
    "email",
  ] as const;
  if (!surfaces.includes(body.surface as any)) {
    return c.json({ error: `surface must be one of: ${surfaces.join(", ")}` }, 400);
  }

  await recordDismissal(db, {
    tenantId,
    projectId,
    userId,
    provider: body.provider,
    surface: body.surface,
    reason: body.reason,
  });

  return c.json({ dismissed: true, provider: body.provider, surface: body.surface });
});

/**
 * DELETE /api/integrations/recommendations/dismiss/:dismissId
 * (Optional follow up; not required for PRD FR-4 which only requires POST to debouncing)
 */
router.delete("/dismiss/:dismissId", async (c) => {
  const db = c.get("db") as Db;
  const tenantId = c.get("tenantId") as number;
  const dismissIdStr = c.req.param("dismissId");
  const dismissId = parseInt(dismissIdStr, 10);

  // Delete by primary key (no user filter yet); if more granular cleanup is needed split rows into their own domain.
  const deleted = await db
    .delete(recommendations)
    .where(eq(recommendations.id, dismissId))
    .returning();

  if (deleted.length === 0) {
    return c.json({ error: "Dismissal not found" }, 404);
  }

  return c.json({ dismissed: true, id: dismissId });
});

export function createIntegrationRecommendationRoutes(db: Db, _encryptionSecret: string): Hono<HonoEnv> {
  return router;
}