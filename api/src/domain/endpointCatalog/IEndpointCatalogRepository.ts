import type { EndpointCatalogEntry, EndpointEntryType, AuthRequirement, SyncRunProps } from './EndpointCatalog';

export interface EndpointCatalogFilters {
  tenantId: number;
  type?: EndpointEntryType;
  serviceName?: string;
  path?: string;
  owner?: string;
  team?: string;
  authRequirement?: AuthRequirement;
  deprecated?: boolean;
  search?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface UpsertEndpointInput {
  tenantId: number;
  type: EndpointEntryType;
  httpMethod: string | null;
  path: string;
  serviceName: string;
  componentName?: string | null;
  description?: string | null;
  authRequirement?: AuthRequirement;
  owner?: string | null;
  team?: string | null;
  sourceFile?: string | null;
  sourceLine?: number | null;
  tags?: string[];
  deprecated?: boolean;
  version?: string | null;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface IEndpointCatalogRepository {
  list(filters: EndpointCatalogFilters): Promise<PaginatedResult<EndpointCatalogEntry>>;
  findById(id: number, tenantId: number): Promise<EndpointCatalogEntry | null>;
  upsert(input: UpsertEndpointInput): Promise<EndpointCatalogEntry>;
  bulkUpsert(inputs: UpsertEndpointInput[]): Promise<{ added: number; updated: number }>;
  deleteStale(tenantId: number, seenBefore: Date, idsSeen: number[]): Promise<number>;
  stats(tenantId: number): Promise<{
    total: number;
    byType: Record<string, number>;
    byService: Record<string, number>;
    byAuth: Record<string, number>;
    deprecated: number;
  }>;
  createSyncRun(tenantId: number): Promise<SyncRunProps>;
  completeSyncRun(id: number, result: {
    status: 'completed' | 'failed';
    endpointsFound: number;
    endpointsAdded: number;
    endpointsUpdated: number;
    endpointsRemoved: number;
    errorMessage?: string | null;
  }): Promise<SyncRunProps>;
  listSyncRuns(tenantId: number, limit?: number): Promise<SyncRunProps[]>;
}
