/**
 * Tenant-local validation engagement reader.
 *
 * Validation is now owned by Builderforce's validation results, dashboards and
 * feedback collectors. This replaces the former BurnRateOS HTTP proxy.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  feedbackCollectors,
  feedbackSubmissions,
  projects,
  validationDashboards,
  validationResults,
} from '../../infrastructure/database/schema';

export interface ValidationEngagement {
  id: string;
  name?: string;
  kind?: string;
  status?: string;
  responses?: number;
}

export interface ValidationEngagements {
  available: boolean;
  engagements: ValidationEngagement[];
  source: 'builderforce';
}

export interface FetchEngagementsArgs {
  tenantId: number;
  segmentId: string;
}

export async function fetchValidationEngagements(db: Db, args: FetchEngagementsArgs): Promise<ValidationEngagements> {
  const [results, dashboards, collectors] = await Promise.all([
    db.select({
      id: validationResults.id,
      name: validationResults.hypothesis,
      kind: validationResults.validationType,
      status: validationResults.result,
    })
      .from(validationResults)
      .where(and(eq(validationResults.tenantId, args.tenantId), eq(validationResults.segmentId, args.segmentId)))
      .orderBy(desc(validationResults.updatedAt))
      .limit(100),
    db.select({
      id: validationDashboards.id,
      name: validationDashboards.name,
      status: validationDashboards.status,
    })
      .from(validationDashboards)
      .where(eq(validationDashboards.tenantId, args.tenantId))
      .orderBy(desc(validationDashboards.updatedAt))
      .limit(100),
    db.select({
      id: feedbackCollectors.id,
      name: feedbackCollectors.name,
      enabled: feedbackCollectors.enabled,
      responses: sql<number>`count(${feedbackSubmissions.id})::int`,
    })
      .from(feedbackCollectors)
      .innerJoin(projects, and(eq(projects.id, feedbackCollectors.projectId), eq(projects.tenantId, args.tenantId)))
      .leftJoin(feedbackSubmissions, and(
        eq(feedbackSubmissions.collectorId, feedbackCollectors.id),
        eq(feedbackSubmissions.tenantId, args.tenantId),
      ))
      .where(and(eq(feedbackCollectors.tenantId, args.tenantId), eq(projects.segmentId, args.segmentId)))
      .groupBy(feedbackCollectors.id, feedbackCollectors.name, feedbackCollectors.enabled)
      .orderBy(desc(feedbackCollectors.updatedAt))
      .limit(100),
  ]);

  const engagements: ValidationEngagement[] = [
    ...results.map((row) => ({
      id: String(row.id), name: row.name, kind: row.kind ?? 'validation', status: row.status,
    })),
    ...dashboards.map((row) => ({
      id: `dashboard:${row.id}`, name: row.name, kind: 'dashboard', status: row.status,
    })),
    ...collectors.map((row) => ({
      id: String(row.id), name: row.name, kind: 'feedback_collector',
      status: row.enabled ? 'active' : 'disabled', responses: Number(row.responses) || 0,
    })),
  ];

  return { available: engagements.length > 0, source: 'builderforce', engagements };
}
