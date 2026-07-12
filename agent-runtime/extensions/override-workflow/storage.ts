/**
 * Override Workflow Storage
 * Persists override records (including active overrides to be restored on start)
 */

import { OverrideRequest } from './types';

interface PersistedOverride {
  id: string;
  title: string;
  description?: string;
  entityType: string;
  entityId: string;
  reason: string;
  enabled: boolean;
  requiresApproval: boolean;
  approvalStatus: ApprovalStatus;
  entityTypeDisplay: string;
  requestMetadata?: Record<string, any>;
  approvalChain?: any[];
  createdById: string;
  createdAt: string;
  expiresAt?: string;
  escalatedTo?: string;
}

export class ApprovalStorage {
  private storage: Map<string, PersistedOverride> = new Map();
  private readonly filename = 'agent-runtime/extensions/overrides.json';

  /**
   * Initialize: read persisted overrides
   */
  async initialize(): Promise<void> {
    try {
      const content = await this.getContents();
      if (!content) return;
      
      for (const item of content) {
        const override = this.hydrate(item);
        this.storage.set(override.id, override);
      }
    } catch (error: any) {
      console.warn('[ApprovalStorage] Load failed, starting empty:', error.message);
    }
  }

  async getContents(): Promise<PersistedOverride[] | null> {
    try {
      const fs = require('fs/promises');
      const path = require('path');
      try {
        const raw = await fs.readFile(path.resolve(__dirname, this.filename), 'utf-8');
        const content = JSON.parse(raw);
        return Array.isArray(content) ? content : null;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return null; // file not found — no persisted overrides
        }
        throw err;
      }
    } catch (err) {
      console.warn('[ApprovalStorage] Could not read file:', err);
      return null;
    }
  }

  save(override: OverrideRequest): Promise<void> {
    const entry = this.sanitize(override);
    this.storage.set(override.id, entry);
    return this.persist();
  }

  get(id: string): PersistedOverride | undefined {
    return this.storage.get(id);
  }

  list(): OverrideRequest[] {
    return Array.from(this.storage.values());
  }

  async persist(): Promise<void> {
    const storage = Array.from(this.storage.values());
    try {
      const fs = require('fs/promises');
      const path = require('path');
      await fs.writeFile(path.resolve(__dirname, this.filename), JSON.stringify(storage, null, 2));
    } catch (err) {
      console.error('[ApprovalStorage] Failed to persist overrides:', err);
      throw new Error('Failed to persist overrides');
    }
  }
}

export class ApprovalChainStorage {
  async save(chain: any): Promise<void> {
    // Not persisted separately; approval steps are kept in-memory for demo
  }

  get(id: string) {
    return null;
  }
}

// Initialize storage on load
const approvalStorage = new ApprovalStorage();
const approvalChainStorage = new ApprovalChainStorage();

// Hydrate in-memory OverrideRequest from persisted object
function hydrate(entry: PersistedOverride): OverrideRequest {
  return {
    id: entry.id,
    title: entry.title,
    description: entry.description,
    entityType: entry.entityType,
    entityId: entry.entityId,
    reason: entry.reason,
    enabled: entry.enabled,
    requiresApproval: entry.requiresApproval,
    approvalStatus: entry.approvalStatus,
    entityTypeDisplay: entry.entityTypeDisplay,
    requestMetadata: entry.requestMetadata,
    approvalChain: entry.approvalChain || [],
    createdById: entry.createdById,
    createdAt: new Date(entry.createdAt),
    expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : undefined,
    escalatedTo: entry.escalatedTo,
    unblockedAt: undefined,
    approvedBy: undefined,
    approvedAt: undefined,
    cancelledById: undefined,
    cancelledAt: undefined,
    cancellationReason: undefined,
    escalationTriggeredAt: undefined,
    recallDate: undefined,
  };
}

// Sanitize for persistence (remove temporary/sync-only fields)
function sanitize(override: OverrideRequest): PersistedOverride {
  return {
    id: override.id,
    title: override.title,
    description: override.description,
    entityType: override.entityType,
    entityId: override.entityId,
    reason: override.reason,
    enabled: override.enabled,
    requiresApproval: override.requiresApproval,
    approvalStatus: override.approvalStatus,
    entityTypeDisplay: override.entityTypeDisplay,
    requestMetadata: override.requestMetadata,
    approvalChain: override.approvalChain,
    createdById: override.createdById,
    createdAt: override.createdAt.toISOString(),
    expiresAt: override.expiresAt ? override.expiresAt.toISOString() : undefined,
    escalatedTo: override.escalatedTo,
  };
}

export { approvalStorage, approvalChainStorage };