/**
 * Integration Recommendations Service
 *
 * Provides scored recommendation lists per workspace + user, keyed by surface:
 *   marketplace, onboarding, in_context
 *
 * Scoring combines:
 *   - local signal: usage patterns (derived from interaction/activity ledgers)
 *   - meta signal: peer adoption (aggregate workspace + org-wide install velocity)
 *   - admin signal: pinned/suppressed rules, plus overrides (pinned integration IDs)
 *   - recency signal: trending via high install velocity
 *
 * Falls back to popularity-ranked list when insufficient local signals (e.g., new workspace < 1 week).
 */

import {
  eq,
  sql,
  and,
  gte,
  lte,
  desc,
  count,
} from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  integrationCredentials,
  integrationRecommendationEvents,
  integrationRecommendationDismissals,
  integrationRecommendationRules,
  projects,
  tenants,
} from '../../infrastructure/database/schema';
import { db } from '../../infrastructure/database/connection';

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

/**
 * An integration candidate with its computed relevance score.
 */
export type RecommendedIntegration = {
  id: number;
  name: string;
  description: string;
  logoUrl: string | null;
  surface: 'marketplace' | 'onboarding' | 'in_context';
  score: number; // 0–100, aggregated across signals
  signalDetails: {
    scoreSources: Array<{
      name: string;
      weight: number;
      rawScore: number;
      reason: string;
    }>;
  };
  cta: {
    text: string;
    action: 'connect' | 'learn_more';
    target: string;
  };
};

/**
 * A workspace recommendation context used for scoring.
 */
export type WorkspaceContext = {
  tenantId: number;
  workspaceId: number;
  userId: number;
  nDaysActive?: number; // if provided, used to fall back from popularity if low
  surface: 'marketplace' | 'onboarding' | 'in_context';
};

/**
 * Pruning identifiers: integration IDs or workspace+user+integration triples.
 */
export type PruningKey =
  | { type: 'workspace'; workspaceId: number; userId: number; surface: string; integrationId: number }
  | { type: 'workspace'; workspaceId: number; surface: string };

// ---------------------------------------------------------------------
// Helper: operator to prune a key (so far only workspace)
// ---------------------------------------------------------------------

/**
 * Returns true if a dismissal/expiry map includes a given key.
 */
export function isDismissed(
  dismissals: Map<string, '30d' | 'perma'>,
  key: PruningKey,
): boolean {
  const str = pruneSerialization(key);
  return dismissals.has(str);
}

/**
 * Serializes a pruning key to a stable string for maps/DB.
 */
function pruneSerialization(key: PruningKey): string {
  if (key.type === 'workspace') {
    return `${key.workspaceId}:${key.surface}:${key.integrationId}`;
  }
  // add support for cleanup/delete by peel/settings when needed
  throw new Error('Unknown prune serialization type, add impl');
}

/**
 * Returns true if a discount (pin/suppress) entry applies.
 */
export function isDiscountApplied(
  discounts: Map<string, number>,
  key: PruningKey,
): number | null {
  const str = pruneSerialization(key);
  return discounts.get(str) ?? null;
}

/**
 * Returns true if any discount list excludes this integration.
 */
export function isDiscountSuppressed(
  discounts: Map<string, number[]>,
  workspaceId: number,
  integrationId: number,
): boolean {
  for (const [str, list] of discounts.entries()) {
    if (str.startsWith(`${workspaceId}:`)) {
      if (list.includes(integrationId)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------

/**
 * Constrained to the provided surfaces (fallback + pinning applied).
 */
export async function scoreIntegrationsForWorkspace(
  db: Db,
  ctx: WorkspaceContext,
): Promise<RecommendedIntegration[]> {
  const { tenantId, workspaceId, userId, surface } = ctx;

  // 1) Base discovery: all integrations NOT currently active in this workspace.
  const activeIntegrations = await db
    .select({ integrationId: integrationCredentials.id })
    .from(integrationCredentials)
    .innerJoin(projects, eq(integrationCredentials.projectId, projects.id))
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.isActive, true),
        eq(projects.id, workspaceId),
      ),
    );

  const activeIntegrationsSet = new Set(activeIntegrations.map((i) => i.integrationId));

  // List all available integrations (active + inactive) to score and pin to surfaces.
  const allIntegrations = await db
    .select({
      id: integrationCredentials.id,
      name: integrationCredentials.name,
      description: integrationCredentials.description,
      logoUrl: integrationCredentials.logoUrl,
    })
    .from(integrationCredentials)
    .where(eq(integrationCredentials.tenantId, tenantId));

  // For onboarding, limit to up to 10 featured and sort them so they span surfaces.
  const limitTo = surface === 'onboarding' ? 10 : undefined;

  // ---------------------------------------------------------------------
  // 2) Load maps: dismissals, discounts (pin/suppress).
  // ---------------------------------------------------------------------
  const dismissals = new Map<string, '30d' | 'perma'>();
  const discounts = new Map<string, number[]>();

  const dismissRows = await db.select()
    .from(integrationRecommendationDismissals)
    .where(and(
      eq(integrationRecommendationDismissals.tenantId, tenantId),
      eq(integrationRecommendationDismissals.workspaceId, workspaceId),
      eq(integrationRecommendationDismissals.expiresAt, sql`NOW() + INTERVAL '30 days'`),
    ));

  for (const r of dismissRows) {
    dismissals.set(pruneSerialization({ type: 'workspace', workspaceId, surface, integrationId: r.integrationId }), '30d');
  }

  // ---------------------------------------------------------------------
  // 3) Apply discounts (pin/suppress).
  // ---------------------------------------------------------------------
  // Prepare workspace—discount map integrationId → discountEffect to compute per‑integration.
  const discountsByWorkspace = new Map<number, { pinScore: number; suppress: boolean }>();
  const discountEntries = await db.select()
    .from(integrationRecommendationRules)
    .where(and(eq(integrationRecommendationRules.tenantId, tenantId), eq(integrationRecommendationRules.workspaceId, workspaceId), eq(integrationRecommendationRules.ruleType, sql`'pin'`)));

  const suppressRows = await db.select()
    .from(integrationRecommendationRules)
    .where(and(eq(integrationRecommendationRules.tenantId, tenantId), eq(integrationRecommendationRules.workspaceId, workspaceId), eq(integrationRecommendationRules.ruleType, sql`'suppress'`)));

  for (const r of discountEntries) {
    const current = discountsByWorkspace.get(r.workspaceId) ?? { pinScore: 0, suppress: false };
    // pinScore = priority 1..3, normalizing to a weight range
    current.pinScore = Math.max(current.pinScore, (r.rulePosition ?? 1)); // prefer higher priority
    discountsByWorkspace.set(r.workspaceId, current);
  }
  for (const r of suppressRows) {
    const current = discountsByWorkspace.get(r.workspaceId) ?? { pinScore: 0, suppress: false };
    current.suppress = true;
    discountsByWorkspace.set(r.workspaceId, current);
  }

  // ---------------------------------------------------------------------
  // 4) Compute the scored list on this workspace’s discount settings.
  // ---------------------------------------------------------------------
  const workspaceDiscount = discountsByWorkspace.get(workspaceId) ?? { pinScore: 0, suppress: false };

  // ---------------------------------------------------------------------
  // 5) Score each integration (popularity -> fallback if low signals).
  // ---------------------------------------------------------------------
  const scored = await Promise.all(
    allIntegrations.map(async (integration) => {
      if (activeIntegrationsSet.has(integration.id)) return null; // skip active

      const veto = workspaceDiscount.suppress; // suppress overrides everything
      const baseScore = veto ? 0 : scoreIntegrationsPerWorkspaceAndUser(db, tenantId, workspaceId, userId, integration.id, nDaysActive(ctx));
      const pinWeight = workspaceDiscount.pinScore; // 1..3 weight
      const finalScore = veto ? 0 : clampScore(
        (baseScore + pinWeight * 30) / 1.3, // pinScore used as a weight-based boost
      );

      const isDismissedNow = isDismissed(dismissals, { type: 'workspace', workspaceId, surface, integrationId: integration.id });
      if (isDismissedNow) return null;

      return {
        id: integration.id,
        name: integration.name,
        description: integration.description,
        logoUrl: integration.logoUrl,
        surface,
        score: finalScore,
        signalDetails: { scoreSources: [] },
        cta: surface === 'onboarding' ? { text: 'Add to pickup', action: 'learn_more' : { text: 'Connect', action: 'connect', target: `/integrations/${integration.name.toLowerCase()}` },
      };
    }),
  );

  const ranked: RecommendedIntegration[] = scored
    .filter((r): r is RecommendedIntegration => r != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limitTo);

  return ranked;
}

/**
 * Returns N days since workspace creation if provided, otherwise uses activity/cached logic.
 */
function nDaysActive(ctx: WorkspaceContext): number | undefined {
  return ctx.nDaysActive; // this will likely be populated by a separate service/consumer
}

/**
 * Constrain score to 0–100 and subject to discount-based boosts.
 */
function clampScore(s: number): number {
  return Math.max(0, Math.min(100, s));
}

// ---------------------------------------------------------------------
// Helper: per-integration scoring (popularity fallback)
// ---------------------------------------------------------------------

/**
 * Scores an integration against:
 *   - workspace peer adoption (workspace + org-wide install count)
 *   - usage patterns (derived from interaction ledgers, optional)
 *   - admin rules (already applied via workspaceDiscount)
 *   - recency (install velocity)
 *
 * In case of insufficient signal data (e.g., workspace < 1 week), falls back
 * to a popularity-ranked score (global + organization install count).
 */
async function scoreIntegrationsPerWorkspaceAndUser(
  db: Db,
  tenantId: number,
  workspaceId: number,
  userId: number,
  integrationId: number,
  daysActive: number | undefined,
): Promise<number> {
  // 1) Retrieve basic counts
  const [workspaceInstallCount, orgInstallCountArr] = await Promise.all([
    db.select({ count: integrationCount() })
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.tenantId, tenantId),
          eq(integrationCredentials.projectId, workspaceId),
          eq(integrationCredentials.isActive, true),
        ),
      ),
    db.select({ count: integrationCount() })
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.tenantId, tenantId),
          eq(integrationCredentials.isActive, true),
        ),
      ),
  ]);
  const orgInstallCount = orgInstallCountArr[0]?.count ?? 0;
  const i = workspaceInstallCount[0] as { count: number } | undefined;
  const workspaceCount = i?.count ?? 0;

  // 2) Determine signal adequacy and pick baseline score
  const isFreshWorkspace = daysActive != null && daysActive < 7;
  const baselineScore = Math.max(20, Math.min(50, orgInstallCount)); // baseline 20–50 driven by org popularity

  // Use popularity fallback if workspace is too new to derive meaningful usage patterns
  // or no data is available from interaction activity.
  // NOTE: this implementation presumes a future utility to create the 'signals' service
  // that computes usage pattern scores; for now, we skip those evaluations and rely on
  // the popularity baseline (org installs) which is stable and reliable.
  return baselineScore;
}

export function integrationCount() {
  return count(integrationCredentials.id);
}

/**
 * Initiates a v2 scoring service to compute usage pattern signals from integration/activity ledgers.
 */
export class RecommendationSignalService {
  constructor(private db: Db) {}

  /**
   * Computes a usage-pattern score for an integration by workspace + user.
   * Broken out to allow later SAS-style tuning without breaking existing recipes.
   */
  async computeUsagePatternScore(tenantId: number, workspaceId: number, userId: number, integrationId: number): Promise<number> {
    // In-flight: will compute based on:
    //   - related workflows we have/have not yet stored (ActivityLedger)
    //   - embedded agent tool calls that reference the integration (ToolAuditEvents)
    // For now, 0 signal; callers that need usage scores must use async load.
    return 0;
  }

  /**
   * Persists a recommendation click event.
   */
  async recordEvent(params: {
    tenantId: number;
    workspaceId: number;
    user_id: number;
    integration_id: number;
    surface: 'marketplace' | 'onboarding' | 'in_context';
    event_type: 'impression' | 'click' | 'dismissed' | 'installed';
    reason?: string;
  }) {
    await db.insert(integrationRecommendationEvents).values(params);
  }

  /**
   * Records a dismissal with 30-day expiry via integration_recommendation_dismissals.
   */
  async recordDismissal(params: {
    tenantId: number;
    workspaceId: number;
    user_id: number;
    integration_id: number;
    surface: 'marketplace' | 'onboarding' | 'in_context';
    reason?: string;
    dismissedAt: Date;
    expiresAt: Date;
  }) {
    await db.insert(integrationRecommendationDismissals).values(params);
  }

  /**
   * Creates or updates admin pin/suppress rules per workspace.
   */
  async upsertAdminRule(params: {
    tenantId: number;
    workspaceId: number;
    integration_id: number;
    rule_type: 'pin' | 'suppress';
    rule_position?: number; // 1..3
  }) {
    return db.insert(integrationRecommendationRules).values(params)
      .onConflictDoUpdate({
        target: [integrationRecommendationRules.tenantId,
          integrationRecommendationRules.workspaceId,
          integrationRecommendationRules.integrationId],
        set: {
          rule_type: params.rule_type,
          rule_position: params.rule_type === 'pin' ? params.rule_position ?? 1 : sql`NULL`,
        },
      });
  }
}