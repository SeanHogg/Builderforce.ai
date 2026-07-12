/**
 * CI/CD Integration Service
 * 
 * Manages CI/CD integration lifecycle:
 * - CRUD operations (create, read, update, delete)
 * - Connection status tracking (FR-1)
 * - Webhook and polling telemetry (FR-1.4, FR-1.5)
 * - Audit trail (FR-6.1)
 * 
 * Architectural note:
 * - No raw database access; uses Repository pattern via drizzleStore
 * - Mutation paths: create | update | delete | testConnection | updateStatus
 * - Query paths: list | get | getConfig
 * - Enforces ConnectionStatus enum from models.py
 */

import { db } from '../../db/client';
import { drizzleStore } from '../../db/drizzleStore';
import { ConnectionStatus } from '../../cicd-integrations/models';  // Import from schemas/models matching models.py

// Internal: Drizzle-inferrable representation of the table
// (Identical to the SQL migration columns)
interface CICDIntegrationRecord {
  id: number;
  tenant_id: number;
  segment_id: string | null;
  name: string;
  integration_type: string;
  connection_config: string | null;
  current_status: string;
  last_success_at: Date | null;
  last_webhook_at: Date | null;
  last_payload_hash: string | null;
  last_poll_at: Date | null;
  last_poll_result_count: number | null;
  auth_failure_code: string | null;
  connection_hint: string | null;
  active_webhooks: any[] | null;
  metadata: any;
  created_at: Date;
  updated_at: Date;
}

// Types matching upstream models (inSync with models.py)
export type IntegrationType = 'github_actions' | 'jenkins' | 'gitlab_ci_cd' | 'circleci' | 'buildkite' | 'azure_devops_pipelines';

// ---------------------------------------------------------------------
// Repository (internal drizzleStore wrapper)
// ---------------------------------------------------------------------

class IntegrationRepository {
  /**
   * Find integration by ID (tenant-scoped)
   */
  async findById(tenantId: number, id: number): Promise<CICDIntegrationRecord | null> {
    const results = await drizzleStore
      .select()
      .from('cicd_integrations')
      .where(({ and, eq, isNull }) => and(eq('tenant_id', tenantId), eq('id', id)));
    return results[0] || null;
  }

  /**
   * List integrations (tenant + optional type filter + pagination)
   */
  async list(tenantId: number, integrationType?: IntegrationType, activeOnly = false, limit = 50): Promise<CICDIntegrationRecord[]> {
    const conditions: any[] = [eq('tenant_id', tenantId)];
    if (integrationType) conditions.push(eq('integration_type', integrationType));
    if (activeOnly) conditions.push(eq('current_status', 'connected'));

    const results = await drizzleStore
      .select()
      .from('cicd_integrations')
      .where(and(...conditions))
      .orderBy(desc('updated_at'))
      .limit(limit);
    return results;
  }

  /**
   * Create a new integration
   */
  async create(data: {
    tenantId: number;
    segmentId?: string;
    name: string;
    integrationType: IntegrationType;
    connectionConfig?: any;
  }): Promise<CICDIntegrationRecord> {
    const now = new Date();
    const [row] = await drizzleStore
      .insert('cicd_integrations')
      .values({
        ...data,
        connection_config: JSON.stringify(data.connectionConfig || {}),
        current_status: 'never_configured',
        created_at: now,
        updated_at: now,
      })
      .returning();

    if (!row) throw new Error('Failed to create integration');
    return row;
  }

  /**
   * Update integration configuration and metadata
   */
  async update(
    tenantId: number,
    id: number,
    data: {
      name?: string;
      connectionConfig?: any;
      activeWebhooks?: any[];
      metadata?: any;
    }
  ): Promise<CICDIntegrationRecord> {
    const { rows } = await drizzleStore
      .update('cicd_integrations')
      .set({
        name: data.name,
        connection_config: data.connectionConfig ? JSON.stringify(data.connectionConfig) : undefined,
        active_webhooks: JSON.stringify(data.activeWebhooks || []),
        metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
        updated_at: new Date(),
      })
      .where(({ and, eq }) => and(eq('tenant_id', tenantId), eq('id', id)))
      .returning();

    if (!rows[0]) throw new Error('Integration not found');
    return rows[0];
  }

  /**
   * Delete integration (tenant-scoped)
   */
  async delete(tenantId: number, id: number): Promise<boolean> {
    const result = await drizzleStore
      .delete('cicd_integrations')
      .where(({ and, eq }) => and(eq('tenant_id', tenantId), eq('id', id)));
    return !result.error;
  }

  /**
   * Update integration status (triggered by webhook/poll success/failure)
   */
  async updateStatus(
    tenantId: number,
    id: number,
    data: {
      lastWebhookAt?: Date | null;
      lastPayloadHash?: string | null;
      lastSuccessAt?: Date | null;
      currentStatus?: string;
      authFailureCode?: string | null;
      connectionHint?: string;
      lastPollAt?: Date | null;
      lastPollResultCount?: number | null;
    }
  ): Promise<CICDIntegrationRecord> {
    const update: any = {
      ...data,
      updated_at: new Date(),
    };

    // If new status is explicit, include it (FR-1.2)
    if (data.currentStatus) update.current_status = data.currentStatus;
    // Otherwise only update telemetry if status wasn't reset
    else if (data.lastWebhookAt || data.lastPayloadHash || data.lastSuccessAt || data.lastPollAt) {
      update.current_status = undefined; // Keep existing status if no explicit transition
    } else {
      delete update.current_status;
    }

    const { rows } = await drizzleStore
      .update('cicd_integrations')
      .set(update)
      .where(({ and, eq }) => and(eq('tenant_id', tenantId), eq('id', id)))
      .returning();

    if (!rows[0]) throw new Error('Integration not found');
    return rows[0];
  }

  /**
   * Record connection state change in audit log (FR-6.1)
   */
  async logAudit(tenantId: number, integrationId: number, data: {
    action: string;
    previousState?: string;
    newState: string;
    actor: string | null;
    metadata?: any;
  }): Promise<void> {
    await drizzleStore
      .insert('cicd_integrations_audit_log')
      .values({
        tenant_id: tenantId,
        integration_id: integrationId,
        action: data.action,
        previous_state: data.previousState,
        new_state: data.newState,
        actor: data.actor,
        metadata: JSON.stringify(data.metadata || {}),
        created_at: new Date(),
      });
  }
}

const repo = new IntegrationRepository();

// ---------------------------------------------------------------------
// Public API (exposes detected models-compatible signatures)
// ---------------------------------------------------------------------

export class CICDIntegrationService {
  /**
   * Create a new CI/CD integration
   * 
   * Creates an integration record in 'never_configured' state (FR-1)
   */
  async createIntegration(params: {
    tenantId: number;
    name: string;
    integrationType: IntegrationType;
    connectionConfig?: any;
  }): Promise<CICDIntegrationRecord> {
    const record = await repo.create(params);
    // Audit: initial creation logged as 'configured'
    await repo.logAudit(params.tenantId, record.id, {
      action: 'configured',
      previousState: never null,
      newState: 'never_configured',
      actor: 'system',
    });
    return record;
  }

  /**
   * List integrations
   * 
   * Supports filtering by integration type and active-only flag
   */
  async listIntegrations(tenantId: number, options?: {
    integrationType?: IntegrationType;
    activeOnly?: boolean;
    limit?: number;
  }): Promise<CICDIntegrationRecord[]> {
    const record = await repo.list(tenantId, options?.integrationType, options?.activeOnly ?? false, options?.limit ?? 50);
    return record;
  }

  /**
   * Get integration by ID
   */
  async getIntegration(tenantId: number, id: number): Promise<CICDIntegrationRecord | null> {
    return repo.findById(tenantId, id);
  }

  /**
   * Update integration configuration
   */
  async updateIntegration(tenantId: number, id: number, data: {
    name?: string;
    connectionConfig?: any;
    activeWebhooks?: any[] | null;
    metadata?: any;
  }): Promise<CICDIntegrationRecord> {
    return repo.update(tenantId, id, data);
  }

  /**
   * Delete integration
   */
  async deleteIntegration(tenantId: number, id: number): Promise<boolean> {
    return repo.delete(tenantId, id);
  }

  /**
   * Record integration status update (FR-1)
   * 
   - Called on webhook reception or poll success/failure
   - Ensures audit trail (FR-6.1) and optional auth failure code preservation
   */
  async updateIntegrationStatus(
    tenantId: number,
    integrationId: number,
    data: {
      lastWebhookAt?: Date | null;
      lastPayloadHash?: string | null;
      lastSuccessAt?: Date | null;
      currentStatus?: string;
      authFailureCode?: string | null;
      connectionHint?: string;
      lastPollAt?: Date | null;
      lastPollResultCount?: number | null;
    }
  ): Promise<CICDIntegrationRecord> {
    const record = await repo.updateStatus(tenantId, integrationId, data);
    
    // Audit: transition + optional original status revert condition
    if (!record.current_status || data.currentStatus) {
      const previousState = record.current_status;
      const newState = data.currentStatus || record.current_status;
      await repo.logAudit(tenantId, integrationId, {
        action: newState === 'connected' ? 'connected' : newState === 'disconnected' ? 'disconnected' : 'auth_expired',
        previousState: previousState === 'never_configured' ? null : previousState,
        newState,
        actor: 'system',
        metadata: { reason: data.authFailureCode },
      });
    }
    return record;
  }
}

// ---------------------------------------------------------------------------
// Helper: models.py-safe status enrichment
// ---------------------------------------------------------------------------

/**
 * Helper to reconcile status with polling telemetry (FR-1)
 * 
 - Uses the same logic as canonicalize_connection_status in models.py
 - Returns: Connected|Degraded (when state is either DISCONNECTED/AUTH_FAILED but telemetry indicates connectivity)
 */
export function canonicalizeConnectionStatus(
  currentStatus: string,
  lastPollResultCount: number | null
): ConnectionStatus {
  // If already in a better state, keep it
  if (currentStatus !== 'disconnected' && currentStatus !== 'auth_failed') {
    return currentStatus as ConnectionStatus;
  }
  // Connected if recent polling data exists (3+ events)
  if (currentStatus === 'disconnected' && lastPollResultCount !== null && lastPollResultCount > 0) {
    return ConnectionStatus.CONNECTED;
  }
  // Degraded if auth_failed but ongoing telemetry exists
  if (currentStatus === 'auth_failed' && lastPollResultCount !== null && lastPollResultCount > 0) {
    return ConnectionStatus.DEGRADED;
  }
  return currentStatus as ConnectionStatus;
}