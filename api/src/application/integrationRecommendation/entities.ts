import type { Db } from '../infrastructure/database/connection';
import {
  recommendationImpressions,
  recommendationClicks,
  recommendationDismissals,
  integrationInstallEvents
} from '../infrastructure/database/schema';
import { eq, desc, count, sql as sqlExpr } from 'drizzle-orm';

export interface RecommendationEvent {
  integrationId: string;
  surface: 'marketplace' | 'onboarding' | 'incontext';
  userId?: string;
  timestamp: Date;
}

export interface DismissalEvent extends RecommendationEvent {
  reason: string;
}

export async function recordImpression(
  db: Db,
  event: RecommendationEvent
): Promise<void> {
  await db.insert(recommendationImpressions).values({
    integrationId: event.integrationId,
    surface: event.surface,
    userId: event.userId || null,
    timestamp: event.timestamp,
  });
}

export async function recordClick(
  db: Db,
  event: RecommendationEvent
): Promise<void> {
  await db.insert(recommendationClicks).values({
    integrationId: event.integrationId,
    surface: event.surface,
    userId: event.userId || null,
    timestamp: event.timestamp,
  });
}

export async function recordDismissal(
  db: Db,
  event: DismissalEvent
): Promise<void> {
  await db.insert(recommendationDismissals).values({
    integrationId: event.integrationId,
    surface: event.surface,
    reason: event.reason,
    userId: event.userId || null,
    timestamp: event.timestamp,
  });
}

export async function recordIntegrationInstall(
  db: Db,
  integrationId: string,
  surface: 'marketplace' | 'onboarding' | 'incontext',
  userId?: string
): Promise<void> {
  await db.insert(integrationInstallEvents).values({
    integrationId,
    surface,
    userId: userId || null,
    timestamp: new Date(),
  });
}

export async function getRecommendationMetrics(userId?: string) {
  const where = userId ? eq(recommendationImpressions.userId, userId) : undefined;

  const [impressionCount] = await db
    .select({ count: sqlExpr<number>(count()) })
    .from(recommendationImpressions)
    .where(where);

  const [clickCount] = await db
    .select({ count: sqlExpr<number>(count()) })
    .from(recommendationClicks)
    .where(where);

  const [dismissalCount] = await db
    .select({ count: sqlExpr<number>(count()) })
    .from(recommendationDismissals)
    .where(where);

  const [installCount] = await db
    .select({ count: sqlExpr<number>(count()) })
    .from(integrationInstallEvents)
    .where(where);

  return {
    impressions: impressionCount?.count ?? 0,
    clicks: clickCount?.count ?? 0,
    dismissals: dismissalCount?.count ?? 0,
    installs: installCount?.count ?? 0,
  };
}