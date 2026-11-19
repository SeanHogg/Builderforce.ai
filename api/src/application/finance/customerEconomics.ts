/**
 * Per-customer unit economics (PRD 25 §25a.3 B3).
 *
 * The LTV-tranche chart partitions these rows. No per-customer ledger is synced
 * yet, so the port returns a single declared blended row when the founder has
 * declared ARPA, margin, churn or CAC — flagged `declared: true`, the same
 * claim-to-proof rule `/finance` already applies. No declaration returns `[]`,
 * which the tile renders as not measured, never as a zero tranche.
 */

import type { Db } from '../../infrastructure/database/connection';
import { latestDeclaredValue } from '../dashboards/declaredKpi';
import type { CustomerEconomicsRow } from '../dashboards/ltvTranches';

export async function loadCustomerEconomics(db: Db, tenantId: number): Promise<CustomerEconomicsRow[]> {
  const [arpa, marginPct, churnPct, cac] = await Promise.all([
    latestDeclaredValue(db, tenantId, 'growth.mrr'),
    latestDeclaredValue(db, tenantId, 'growth.grossMargin'),
    latestDeclaredValue(db, tenantId, 'growth.logoChurn'),
    latestDeclaredValue(db, tenantId, 'growth.cac'),
  ]);
  if (arpa == null && marginPct == null && churnPct == null && cac == null) return [];
  return [{
    id: 'declared',
    plan: null,
    cohortMonth: null,
    channel: null,
    segment: null,
    arpa,
    marginPct,
    churnPct,
    cac,
    declared: true,
  }];
}
