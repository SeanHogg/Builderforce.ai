/**
 * Insights OPERATIONS — the only thing an operator sees across workspaces (PRD 33
 * D17): aggregates. No site, visitor, recording or route of any workspace leaves
 * here; a superadmin reads Builderforce's own recordings as a member of the
 * Builderforce workspace, through the ordinary `/api/replay/*` routes.
 *
 * Every statement is a declared `platform_aggregate` read, cached five minutes.
 */

import { and, count, countDistinct, eq, gte, like, sql } from 'drizzle-orm';
import type { ReplayOpsSummaryDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { orders, replayRecordings, replayRouteDaily, replaySites } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { DAY_MS } from '../../domain/shared/time';
import { REPLAY_PACK_ORDER_PREFIX } from '../commerce/replayPackSettlement';
import { replayTelemetryDb } from './replayDatabase';

const SUMMARY_KEY = 'replay:ops:summary';

const num = (value: unknown): number => Number(value ?? 0) || 0;

export class ReplayOpsService {
  constructor(private readonly env: Env, private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  async summary(): Promise<ReplayOpsSummaryDto> {
    return getOrSetCached(this.env, SUMMARY_KEY, async () => {
      const now = this.clock().getTime();
      const since7 = new Date(now - 7 * DAY_MS);
      const since7Day = since7.toISOString().slice(0, 10);
      const since30 = new Date(now - 30 * DAY_MS);
      const store = replayTelemetryDb(this.env, this.db);

      const [sites] = await this.db
        .select({ sites: count(), tenants: countDistinct(replaySites.tenantId) })
        .from(replaySites)
        .where(acrossTenants(replaySites, 'platform_aggregate', eq(replaySites.status, 'active')));
      const [sessions] = await store
        .select({ n: sql<string>`coalesce(sum(${replayRouteDaily.sessions}), 0)` })
        .from(replayRouteDaily)
        .where(acrossTenants(replayRouteDaily, 'platform_aggregate', gte(replayRouteDaily.day, since7Day)));
      const [kept] = await store
        .select({ n: count(), bytes: sql<string>`coalesce(sum(${replayRecordings.bytes}), 0)` })
        .from(replayRecordings)
        .where(acrossTenants(replayRecordings, 'platform_aggregate', gte(replayRecordings.startedAt, since7)));
      const [revenue] = await this.db
        .select({ cents: sql<string>`coalesce(sum(${orders.totalCents}), 0)` })
        .from(orders)
        .where(acrossTenants(orders, 'platform_aggregate', and(
          like(orders.orderNumber, `${REPLAY_PACK_ORDER_PREFIX}%`),
          eq(orders.status, 'paid'),
          gte(orders.createdAt, since30),
        )));

      return {
        sites: num(sites?.sites),
        tenants: num(sites?.tenants),
        sessions7d: num(sessions?.n),
        keptRecordings7d: num(kept?.n),
        bytes7d: num(kept?.bytes),
        packRevenueCents30d: num(revenue?.cents),
      };
    }, { kvTtlSeconds: 300 });
  }
}
