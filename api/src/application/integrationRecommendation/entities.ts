import type { Db } from '../infrastructure/database/connection';
import { recommendations, recommendationImpressions, recommendationClicks, recommendationDismissals, integrationInstallEvents } from '../infrastructure/database/schema';
import { eq } from 'drizzle-orm';

export interface Recommendation {
  id: number;
  integration_id: string;
  label: string;
  category: string;
  description: string;
}

export interface RecommendationEvent {
  integration_id: string;
  surface: 'marketplace' | 'onboarding' | 'incontext';
  user_id?: string;
  timestamp: Date;
}

export interface DismissalEvent extends RecommendationEvent {
  reason: string;
}

export async function getRecommendations(db: Db, tenantId: number, limit = 10) {
  const results = await db.query.recommendations.findMany({
    where: eq(recommendations.tenant_id, tenantId),
    limit
  });

  return results;
}

export async function recordImpression(
  db: Db,
  event: RecommendationEvent
): Promise<void> {
  await db.insert(recommendationImpressions).values({
    recommendations_id: event.integration_id,
    surface: event.surface,
    user_id: event.user_id || null,
    created_at: event.timestamp,
  });
}

export async function recordClick(
  db: Db,
  event: RecommendationEvent
): Promise<void> {
  await db.insert(recommendationClicks).values({
    recommendations_id: event.integration_id,
    surface: event.surface,
    user_id: event.user_id || null,
    created_at: event.timestamp,
  });
}

export async function recordDismissal(
  db: Db,
  event: DismissalEvent
): Promise<void> {
  await db.insert(recommendationDismissals).values({
    recommendations_id: event.integration_id,
    surface: event.surface,
    reason: event.reason,
    user_id: event.user_id || null,
    created_at: event.timestamp,
  });
}

export async function recordIntegrationInstall(
  db: Db,
  integration_id: string,
  surface: 'marketplace' | 'onboarding' | 'incontext',
  user_id?: string
): Promise<void> {
  await db.insert(integrationInstallEvents).values({
    integration_id,
    surface,
    user_id: user_id || null,
    installed_at: new Date(),
  });
}