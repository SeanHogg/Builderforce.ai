/**
 * CI/CD Deploy Event Ingestion Service
 * 
 * Manages deploy event lifecycle:
 * - Canonical schema validation (PRD FR-2.1)
 * - Ingest receipt generation (FR-2.2)
 * - Event storage and quarantine for failed events (FR-2.5)
 * - Checkpoint for replay/visibility (FR-6.2: 90-day metrics retention)
 */

import { db } from '../../db/client';
import { drizzleStore } from '../../db/drizzleStore';

// -------------------------------------------------------------------------
// Types mirroring models.py and migration schemas
// -------------------------------------------------------------------------

export type DeployEventStatus = 'accepted' | 'rejected' | 'quarantined';
export type ValidationErrorDetail = {
  field_name: string;
  error_code: string;
  error_message: string;
  context?: Record<string, any>;
};

export interface CanonicalDeployEventData {
  service_name: string;
  environment: string;
  deploy_id: string;
  timestamp: Date;
  status: string;
  commit_sha: string;
  pr_number?: number;
  triggered_by?: string;
  custom_payload?: Record<string, any>;
}

// Tuple of already-synced properties we want to ignore going forward.
type MinimalUnsyncedProps = Exclude<keyof CanonicalDeployEventData, keyof SyncedDeployEventData>;

// Minimal syncable subset of the canonical model.
export interface SyncedDeployEventData {
  service_name: string;
  environment: string;
  deploy_id: string;
  timestamp: Date;
  status: string;
  commit_sha: string;
}

export interface IngestReceiptData {
  event_id: string;
  integration_id: number;
  status: DeployEventStatus;
  reason?: string;
  errors: ValidationErrorDetail[];
}

// ---------------------------------------------------------------------------
// DeployEventRepository (internal drizzleStore wrapper)
// ---------------------------------------------------------------------------

class DeployEventRepository {
  /**
   * Create a deploy event record (validated payload, schema-full)
   */
  async create(event: SyncedDeployEventData): Promise<CICDDeployEventRecord> {
    const now = new Date();
    const [row] = await drizzleStore.insert('cicd_deploy_events').values({
      ...event,
      tenant_id: 0, // placeholder: will be set by tenant env at ingestion
      integration_id: 0, // placeholder
      event_id: event.deploy_id,
      pr_number: event.pr_number,
      triggered_by: event.triggered_by,
      custom_payload: null,
      ingestion_receipt_id: null,
      created_at: now,
    }).returning();
    if (!row) throw new Error('Failed to create deploy event');
    return row;
  }

  /**
   * List deploy events with filters (FR-3.2:Deploy Event Inspector)
   */
  async list({
    tenantId,
    integration_id,
    service_name,
    environment,
    start_ts,
    end_ts,
    limit = 100,
    offset = 0,
  }: {
    tenantId: number;
    integration_id?: number;
    service_name?: string;
    environment?: string;
    start_ts: Date;
    end_ts: Date;
    limit?: number;
    offset?: number;
  }): Promise<CICDDeployEventRecord[]> {
    const conditions: any[] = [
      eq('tenant_id', tenantId),
      gte('timestamp', start_ts),
      lte('timestamp', end_ts),
    ];
    if (integration_id) conditions.push(eq('integration_id', integration_id));
    if (service_name) conditions.push(eq('service_name', service_name));
    if (environment) conditions.push(eq('environment', environment));

    const results = await drizzleStore
      .select()
      .from('cicd_deploy_events')
      .where(and(...conditions))
      .orderBy(desc('timestamp'))
      .limit(limit)
      .offset(offset);
    return results;
  }

  /**
   * Get event by event_id (primary unique key)
   */
  async getByEventId(eventId: string, tenantId: number): Promise<CICDDeployEventRecord | null> {
    const results = await drizzleStore
      .select()
      .from('cicd_deploy_events')
      .where(({ and, eq }) => and(eq('event_id', eventId), eq('tenant_id', tenantId)));
    return results[0] || null;
  }

  /**
   * Delete expired records (FR-2.5 retention; FR-6.2 90-day metrics)
   */
  // Ideally nonblocking, best-effort—commit if useful even if a side-effect fails.
  async deleteExpired(tenantId: number, thresholdDays = 90): Promise<{ affected: number }> {
    const cutoff = subDays(new Date(), thresholdDays);
    const { results } = await drizzleStore
      .delete('cicd_deploy_events')
      .where(({ and, lte, isNull }) =>
        and(
          eq('tenant_id', tenantId),
          lte('created_at', cutoff),
          isNull('ingest_receipt_id')  // only clean unreferenced checkpoints
        )
      );
    return { affected: results.length };
  }
}

const deployRepo = new DeployEventRepository();

// ---------------------------------------------------------------------------
// IngestReceiptRepository (internal drizzleStore wrapper)
// ---------------------------------------------------------------------------

class IngestReceiptRepository {
  /**
   * Create a new ingest receipt
   */
  async create(receipt: IngestReceiptData): Promise<CICDIngestReceiptRecord> {
    const now = new Date();
    const [row] = await drizzleStore.insert('cicd_ingest_receipts').values({
      ...receipt,
      tenant_id: 0, // placeholder
      integration_id: 0, // placeholder
      receipt_at: now,
      total_errors: receipt.errors.length,
      errors_json: receipt.errors.map(e => ({
        field_name: e.field_name,
        error_code: e.error_code,
        error_message: e.error_message,
        context: e.context,
      })),
    }).returning();
    if (!row) throw new Error('Failed to create ingest receipt');
    return row;
  }

  /**
   * Get receipt by event_id (to normalize event state)
   */
  async getByEventId(eventId: string, tenantId: number): Promise<CICDIngestReceiptRecord | null> {
    const results = await drizzleStore
      .select()
      .from('cicd_ingest_receipts')
      .where(({ and, eq }) => and(eq('event_id', eventId), eq('tenant_id', tenantId)));
    return results[0] || null;
  }
}

const receiptRepo = new IngestReceiptRepository();

// ---------------------------------------------------------------------------
// CICDDeployEventService (public API)
// ---------------------------------------------------------------------------

export class CICDDeployEventService {
  /**
   * Normalize and validate a deploy event payload (FR-2.1)
   */
  normalizePayload(payload: any): SyncedDeployEventData {
    const now = new Date();
    // Required fields
    const requiredFields: (keyof SyncedDeployEventData)[] = [
      'service_name', 'environment', 'deploy_id', 'timestamp', 'status', 'commit_sha'
    ];
    const missing: string[] = [];

    for (const field of requiredFields) {
      if (payload[field] === undefined || payload[field] === null) missing.push(field);
    }

    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    // Validate types
    const ts = new Date(payload.timestamp);
    if (isNaN(ts.getTime())) {
      throw new Error('Invalid timestamp value');
    }

    // Accept any valid string for status and commit_sha per migration
    return {
      service_name: String(payload.service_name),
      environment: String(payload.environment),
      deploy_id: String(payload.deploy_id),
      timestamp: ts,
      status: String(payload.status),
      commit_sha: String(payload.commit_sha),
      pr_number: typeof payload.pr_number === 'number' ? payload.pr_number : undefined,
      triggered_by: typeof payload.triggered_by === 'string' ? payload.triggered_by : undefined,
    };
  }

  /**
   * Store a deploy event (FR-2.1, FR-2.2)
   * 
   - Normalizes and runs quick validation
   - Returns full event + receipt for guaranteed consistency
   */
  async ingest(
    tenantId: number,
    integrationId: number,
    rawPayload: any
  ): Promise<{
    event: CICDDeployEventRecord;
    receipt: CICDIngestReceiptRecord & { parsedTimestamp: Date };
    validationPassed: boolean;
  }> {
    const normalized = this.normalizePayload(rawPayload);

    // Validation steps
    const errors: ValidationErrorDetail[] = [];
    const isAccepted = this.validateEvent(normalized, errors);

    // Create receipt first (FR-2.2)
    const receiptData: IngestReceiptData = {
      event_id: normalized.deploy_id,
      integration_id,
      status: isAccepted ? 'accepted' : 'rejected',
      reason: isAccepted ? undefined : 'validation_failed',
      errors,
    };
    const receipt = await receiptRepo.create(receiptData);

    // Create event (schema-full)
    const event = await deployRepo.create(normalized);
    await drizzleStore
      .update('cicd_deploy_events')
      .set({ ingest_receipt_id: receipt.id })
      .where(({ and, eq }) => and(eq('id', event.id), eq('tenant_id', tenantId)));

    return {
      event,
      receipt: { ...receipt, parsedTimestamp: normalized.timestamp },
      validationPassed: isAccepted,
    };
  }

  /**
   * Validate event and collect errors (internal helper)
   */
  private validateEvent(event: SyncedDeployEventData, errors: ValidationErrorDetail[]): boolean {
    // service_name: required, non-empty
    if (event.service_name === '') {
      errors.push({
        field_name: 'service_name',
        error_code: 'empty',
        error_message: 'Service name must not be empty',
      });
    }

    // environment: required, non-empty
    if (event.environment === '') {
      errors.push({
        field_name: 'environment',
        error_code: 'empty',
        error_message: 'Environment must not be empty',
      });
    }

    // deploy_id: required, non-empty
    if (event.deploy_id === '') {
      errors.push({
        field_name: 'deploy_id',
        error_code: 'empty',
        error_message: 'Deploy ID must not be empty',
      });
    }

    // timestamp: must be a valid future date (allowing recent past)
    const now = new Date();
    if (event.timestamp > now) {
      errors.push({
        field_name: 'timestamp',
        error_code: 'future_timestamp',
        error_message: 'Timestamp must be in the past or present',
      });
    }

    // status: required, must be one of accepted deploy statuses as per migration
    // Based on migration, allowed values: deployed|failed|cancelled|skipped
    const validStatuses = ['deployed', 'failed', 'cancelled', 'skipped'];
    if (!event.status || !validStatuses.includes(event.status)) {
      // If empty or invalid, warn and accept (more lenient)
      // Could reject if strictly required; currently decided to pick 'deployed'
      if (!event.status) {
        event.status = 'deployed';
      } else {
        errors.push({
          field_name: 'status',
          error_code: 'invalid_status',
          error_message: `Status must be one of: ${validStatuses.join(', ')}`,
        });
      }
    }

    // commit_sha: required, non-empty
    if (event.commit_sha === '') {
      errors.push({
        field_name: 'commit_sha',
        error_code: 'empty',
        error_message: 'Commit SHA must not be empty',
      });
    }

    return errors.length === 0;
  }

  /**
   * List events for inspector (FR-3.2)
   */
  async listEvents(tenantId: number, integration_id?: number, service_name?: string, environment?: string, start_ts: Date, end_ts: Date, limit = 100, offset = 0): Promise<CICDDeployEventRecord[]> {
    return deployRepo.list({
      tenantId,
      integration_id,
      service_name,
      environment,
      start_ts,
      end_ts,
      limit,
      offset,
    });
  }

  /**
   * Get a specific event by ID or event_id (FR-3.3)
   */
  async getEventById(tenantId: number, id: number | string): Promise<CICDDeployEventRecord | null> {
    const numeric = typeof id === 'number' ? id : undefined;
    const eventId = typeof id === 'string' ? id : undefined;
    // Prefer numeric ID; fallback to string if needed
    if (numeric) {
      const row = await drizzleStore.select().from('cicd_deploy_events').where(({ and, eq }) => and(eq('id', numeric), eq('tenant_id', tenantId)));
      return row[0] || null;
    }
    return deployRepo.getByEventId(eventId!, tenantId);
  }

  /**
   * Delete expired events (FR-2.5 retention + FR-6.2 metrics purge)
   */
  async deleteExpired(tenantId: number, thresholdDays = 90): Promise<void> {
    await deployRepo.deleteExpired(tenantId, thresholdDays);
  }
}

// ---------------------------------------------------------------------------
// HTTP response adapters (matching schemas.py)
// ---------------------------------------------------------------------------

/**
 * Builds a minimal deploy event list item for API responses
 */
export function buildDeployEventListItem(record: CICDDeployEventRecord) {
  return {
    event_id: record.event_id,
    integration_id: record.integration_id,
    service_name: record.service_name,
    environment: record.environment,
    timestamp: record.timestamp,
    deploy_id: record.deploy_id,
    status: record.status,
    commit_sha: record.commit_sha,
    validate_passed: record.validation_passed,
  };
}

/**
 * Builds a full deploy event detail item for inspection
 */
export function buildDeployEventDetail(record: CICDDeployEventRecord & { validation_errors: any[] }) {
  return {
    event_id: record.event_id,
    integration_id: record.integration_id,
    service_name: record.service_name,
    environment: record.environment,
    deploy_id: record.deploy_id,
    timestamp: record.timestamp,
    status: record.status,
    commit_sha: record.commit_sha,
    ingest_timestamp: record.ingest_at,
    ingest_event_id: record.ingest_receipt_id,
    validation_passed: record.validation_passed,
    validation_errors: record.validation_errors,
    custom_payload: record.custom_payload,
    metadata: record.metadata,
  };
}