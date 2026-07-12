/**
 * Ingest Receipt Service
 * 
 - Query receipts, surface delivery rates, and link to deploy events
 - Supports audit-style inspection per integration and time window
 */

import { db } from '../../db/client';
import { drizzleStore } from '../../db/drizzleStore';
import { CICDDeployEventRecord } from './CICDDeployEventService';

// -------------------------------------------------------------------------
// Types mirroring the migration schema
// -------------------------------------------------------------------------

export interface IngestReceipt {
  id: number;
  tenant_id: number;
  event_id: string;
  integration_id: number;
  status: string; // accepted|rejected|quarantined
  reason?: string;
  errors: ValidationErrorDetail[];
  total_errors: number;
}

export interface DeliveryMetrics {
  integration_id: number;
  received_count: number; // ingest_receipts status=accepted
  expected_count: number; // ic-dev-events total events ingested for integration
  delivery_rate: number; // received/expected, 0..1
}

// -------------------------------------------------------------------------
// ReceiptRepository (internal drizzleStore wrapper)
// -------------------------------------------------------------------------

class ReceiptRepository {
  /**
   * Find receipt by event_id (for lookup)
   */
  async getByEventId(eventId: string, tenantId: number): Promise<IngestReceipt | null> {
    const results = await drizzleStore
      .select()
      .from('cicd_ingest_receipts')
      .where(({ and, eq }) => and(eq('event_id', eventId), eq('tenant_id', tenantId)));
    return results[0] || null;
  }

  /**
   * List receipts (filterable by integration_id, time range, status)
   */
  async list({
    tenantId,
    integration_id,
    status,
    start_ts,
    end_ts,
    limit = 100,
    offset = 0,
  }: {
    tenantId: number;
    integration_id?: number;
    status?: string;
    start_ts: Date;
    end_ts: Date;
    limit?: number;
    offset?: number;
  }): Promise<IngestReceipt[]> {
    const conditions: any[] = [
      eq('tenant_id', tenantId),
      gte('receipt_at', start_ts),
      lte('receipt_at', end_ts),
    ];
    if (integration_id !== undefined) conditions.push(eq('integration_id', integration_id));
    if (status) conditions.push(eq('status', status));

    const results = await drizzleStore
      .select()
      .from('cicd_ingest_receipts')
      .where(and(...conditions))
      .orderBy(desc('receipt_at'))
      .limit(limit)
      .offset(offset);
    return results;
  }

  /**
   * Compute delivery metrics per integration for a time window
   */
  async getDeliveryMetrics(
    tenantId: number,
    integration_id: number,
    start_ts: Date,
    end_ts: Date
  ): Promise<DeliveryMetrics> {
    // received_count: receipts for this integration in window where status=accepted
    const accepted_recs = await drizzleStore
      .select({ count: sql`COUNT(DISTINCT id)` })
      .from('cicd_ingest_receipts')
      .where(and(
        eq('tenant_id', tenantId),
        eq('integration_id', integration_id),
        gte('receipt_at', start_ts),
        lte('receipt_at', end_ts),
        eq('status', 'accepted')
      ));
    const received_count = Number(accepted_recs[0]?.count || 0);

    // expected_count: all unique event_ids ingested for this integration in window
    const expected_recs = await drizzleStore
      .select({ count: sql`COUNT(DISTINCT event_id)` })
      .from('cicd_deploy_events')
      .where(and(
        eq('tenant_id', tenantId),
        eq('integration_id', integration_id),
        gte('created_at', start_ts),
        lte('created_at', end_ts)
      ));
    const expected_count = Number(expected_recs[0]?.count || 0);

    const delivery_rate = expected_count > 0 ? received_count / expected_count : 0;
    return { integration_id, received_count, expected_count, delivery_rate };
  }
}

const receiptRepo = new ReceiptRepository();

/**
 * Ingest Receipt Service (exposes query-only/public helpers)
 * 
 - Reads receipts and joins with deploy events
 - Supports per-integration delivery rates per time window
 */
export class IngestReceiptService {
  /**
   * List receipts matching provided filters
   */
  async listReceipts(tenantId: number, options: {
    integration_id?: number;
    status?: string;
    start_ts: Date;
    end_ts: Date;
    limit?: number;
    offset?: number;
  }): Promise<IngestReceipt[]> {
    return receiptRepo.list(options);
  }

  /**
   - Get delivery rate between received events and expected counts (for reconcile/reporting)
   - Will be polled periodically or used for reconciliation within deployments
   */
  async getDeliveryRate(
    tenantId: number,
    integration_id: number,
    start_ts: Date,
    end_ts: Date
  ): Promise<DeliveryMetrics> {
    return receiptRepo.getDeliveryMetrics(tenantId, integration_id, start_ts, end_ts);
  }
}

// Receives registers for later usage; kept minimal as per contract.