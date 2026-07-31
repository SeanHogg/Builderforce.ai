/**
 * Endpoint Catalog Service (PRD #170)
 * Business logic for endpoint catalog management.
 * Implements AC6/AC7: sync within 24h via periodic runner + on-demand trigger.
 */

import type { IEndpointCatalogRepository, EndpointCatalogFilters, UpsertEndpointInput } from '../../domain/endpointCatalog/IEndpointCatalogRepository';
import { EndpointCatalogScanner } from './EndpointCatalogScanner';
import type { EndpointCatalogEntry } from '../../domain/endpointCatalog/EndpointCatalog';
import type { PaginatedResult } from '../../domain/endpointCatalog/IEndpointCatalogRepository';
import type { SyncRunProps } from '../../domain/endpointCatalog/EndpointCatalog';

export class EndpointCatalogService {
  constructor(private readonly repo: IEndpointCatalogRepository) {}

  async list(filters: EndpointCatalogFilters): Promise<PaginatedResult<EndpointCatalogEntry>> {
    return this.repo.list(filters);
  }

  async getById(id: number, tenantId: number): Promise<EndpointCatalogEntry | null> {
    return this.repo.findById(id, tenantId);
  }

  async stats(tenantId: number): Promise<{
    total: number;
    byType: Record<string, number>;
    byService: Record<string, number>;
    byAuth: Record<string, number>;
    deprecated: number;
  }> {
    return this.repo.stats(tenantId);
  }

  async upsert(input: UpsertEndpointInput): Promise<EndpointCatalogEntry> {
    this.validateInput(input);
    return this.repo.upsert(input);
  }

  async bulkUpsert(inputs: UpsertEndpointInput[]): Promise<{ added: number; updated: number }> {
    for (const input of inputs) this.validateInput(input);
    return this.repo.bulkUpsert(inputs);
  }

  async listSyncRuns(tenantId: number, limit = 20): Promise<SyncRunProps[]> {
    return this.repo.listSyncRuns(tenantId, limit);
  }

  /**
   * Full sync: baseline scan + bulk upsert.
   * Implements FR6/AC6/AC7: ensures catalog reflects deployed endpoints within 24h.
   */
  async sync(tenantId: number, owner: string | null = null): Promise<{
    run: SyncRunProps;
    endpointsFound: number;
    added: number;
    updated: number;
  }> {
    const syncRun = await this.repo.createSyncRun(tenantId);
    try {
      const endpoints = EndpointCatalogScanner.buildBaseline(tenantId, owner);
      const { added, updated } = await this.repo.bulkUpsert(endpoints);

      const completed = await this.repo.completeSyncRun(syncRun.id, {
        status: 'completed',
        endpointsFound: endpoints.length,
        endpointsAdded: added,
        endpointsUpdated: updated,
        endpointsRemoved: 0,
      });

      return { run: completed, endpointsFound: endpoints.length, added, updated };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = await this.repo.completeSyncRun(syncRun.id, {
        status: 'failed',
        endpointsFound: 0,
        endpointsAdded: 0,
        endpointsUpdated: 0,
        endpointsRemoved: 0,
        errorMessage: message,
      });
      throw Object.assign(new Error(message), { syncRun: failed });
    }
  }

  /**
   * Import OpenAPI/Swagger spec as catalog entries (FR1: Support for OpenAPI specs)
   */
  async importOpenApiSpec(tenantId: number, spec: Record<string, unknown>, serviceName: string, owner: string | null = null): Promise<{ added: number; updated: number }> {
    const paths = (spec.paths ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
    const inputs: UpsertEndpointInput[] = [];

    for (const [pathKey, methods] of Object.entries(paths)) {
      for (const [methodKey, operation] of Object.entries(methods)) {
        const methodUpper = methodKey.toUpperCase();
        if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'].includes(methodUpper)) continue;
        const op = operation as { summary?: string; description?: string; tags?: string[]; deprecated?: boolean; security?: unknown[] };
        const isPublic = !op.security || op.security.length === 0;

        inputs.push({
          tenantId,
          type: 'rest_api',
          httpMethod: methodUpper,
          path: pathKey,
          serviceName,
          description: op.summary || op.description || `${methodUpper} ${pathKey}`,
          authRequirement: isPublic ? 'public' : 'auth_required',
          owner: owner ?? 'platform-team',
          team: 'engineering',
          sourceFile: `openapi: ${serviceName}`,
          tags: [...(op.tags ?? []), 'openapi', 'auto-discovered'],
          deprecated: Boolean(op.deprecated),
        });
      }
    }

    if (inputs.length === 0) return { added: 0, updated: 0 };
    return this.repo.bulkUpsert(inputs);
  }

  /**
   * Periodic sweeper to keep catalog current (FR6)
   */
  async sweepAllTenants?(tenantIds: number[]): Promise<void> {
    for (const tid of tenantIds) {
      try {
        await this.sync(tid);
      } catch {
        // Continue for other tenants
      }
    }
  }

  private validateInput(input: UpsertEndpointInput): void {
    if (!input.path || input.path.trim().length === 0) {
      throw new Error('path is required');
    }
    if (!input.serviceName || input.serviceName.trim().length === 0) {
      throw new Error('serviceName is required');
    }
    if (input.type === 'rest_api' && !input.httpMethod) {
      throw new Error('httpMethod is required for REST API entries');
    }
    if (input.path.length > 1024) {
      throw new Error('path exceeds max length 1024');
    }
  }
}
