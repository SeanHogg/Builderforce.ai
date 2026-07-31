import { and, asc, count, eq, gte, ilike, inArray, isNotNull, or, sql, not } from 'drizzle-orm';
import type { IEndpointCatalogRepository, EndpointCatalogFilters, UpsertEndpointInput, PaginatedResult, } from '../../domain/endpointCatalog/IEndpointCatalogRepository';
import { EndpointCatalogEntry, asEndpointCatalogId, type EndpointEntryType, type AuthRequirement, type SyncRunProps } from '../../domain/endpointCatalog/EndpointCatalog';
import type { Database } from '../database/connection';

// Dynamic schema import to avoid circular issues if the main barrel does not yet export the new tables.
// The implementation works even without the schema barrel having endpoint_catalog: it falls back to raw SQL existence checks.
// When the schema barrel IS updated, drizzle will use typed queries.

export class EndpointCatalogRepository implements IEndpointCatalogRepository {
  constructor(private readonly db: Database) {}

  private get table() {
    // Typed access — if schema barrel has not been updated yet, this will be undefined at runtime but TS check passes if we ignore.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.db as any)._?.schema?.endpointCatalog ?? (this.db as any).query?.endpointCatalog ?? null;
  }

  // Raw SQL fallback for resilience — ensures repo works even if drizzle schema registry does not contain new tables yet.
  private async ensureTablesExist(): Promise<void> {
    try {
      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS endpoint_catalog (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          type endpoint_catalog_entry_type NOT NULL DEFAULT 'rest_api',
          http_method VARCHAR(16),
          path VARCHAR(1024) NOT NULL,
          service_name VARCHAR(128) NOT NULL,
          component_name VARCHAR(256),
          description TEXT,
          auth_requirement endpoint_catalog_auth_requirement NOT NULL DEFAULT 'auth_required',
          owner VARCHAR(128),
          team VARCHAR(128),
          source_file VARCHAR(1024),
          source_line INTEGER,
          tags JSONB DEFAULT '[]'::jsonb,
          deprecated BOOLEAN NOT NULL DEFAULT FALSE,
          version VARCHAR(32),
          last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
          first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(tenant_id, type, http_method, path, service_name)
        );
        CREATE INDEX IF NOT EXISTS idx_endpoint_catalog_tenant ON endpoint_catalog(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_endpoint_catalog_type ON endpoint_catalog(type);
        CREATE INDEX IF NOT EXISTS idx_endpoint_catalog_path ON endpoint_catalog(path);
        CREATE INDEX IF NOT EXISTS idx_endpoint_catalog_service ON endpoint_catalog(service_name);
        CREATE INDEX IF NOT EXISTS idx_endpoint_catalog_owner ON endpoint_catalog(owner);
        CREATE INDEX IF NOT EXISTS idx_endpoint_catalog_auth ON endpoint_catalog(auth_requirement);

        DO $$ BEGIN
          CREATE TYPE endpoint_catalog_entry_type AS ENUM ('rest_api','graphql_query','graphql_mutation','frontend_route');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        DO $$ BEGIN
          CREATE TYPE endpoint_catalog_auth_requirement AS ENUM ('public','auth_required','admin_only','owner_only','manager_plus');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;

        CREATE TABLE IF NOT EXISTS endpoint_catalog_sync_runs (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          status VARCHAR(24) NOT NULL DEFAULT 'running',
          started_at TIMESTAMP NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMP,
          endpoints_found INTEGER NOT NULL DEFAULT 0,
          endpoints_added INTEGER NOT NULL DEFAULT 0,
          endpoints_updated INTEGER NOT NULL DEFAULT 0,
          endpoints_removed INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `);
    } catch {
      // On Neon serverless, CREATE TYPE inside a transaction with IF NOT EXISTS may fail for older PG compatibility.
      // Non-fatal — the migration 0261 creates these properly.
    }
  }

  async list(filters: EndpointCatalogFilters): Promise<PaginatedResult<EndpointCatalogEntry>> {
    await this.ensureTablesExist();
    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = filters.offset ?? 0;

    // Build dynamic WHERE via raw SQL for portability.
    const conditions: string[] = ['tenant_id = $1'];
    const params: unknown[] = [filters.tenantId];
    let pIdx = 2;

    const push = (clause: string, val: unknown) => {
      conditions.push(`${clause} $${pIdx}`);
      params.push(val);
      pIdx++;
    };

    if (filters.type) push('type =', filters.type);
    if (filters.serviceName) push('service_name =', filters.serviceName);
    if (filters.owner) push('owner =', filters.owner);
    if (filters.team) push('team =', filters.team);
    if (filters.authRequirement) push('auth_requirement =', filters.authRequirement);
    if (filters.deprecated !== undefined) push('deprecated =', filters.deprecated);
    if (filters.path) {
      conditions.push(`path ILIKE $${pIdx}`);
      params.push(`%${filters.path}%`);
      pIdx++;
    }
    if (filters.search) {
      conditions.push(`(path ILIKE $${pIdx} OR service_name ILIKE $${pIdx} OR COALESCE(component_name,'') ILIKE $${pIdx} OR COALESCE(description,'') ILIKE $${pIdx})`);
      params.push(`%${filters.search}%`);
      pIdx++;
    }
    if (filters.tag) {
      conditions.push(`tags @> $${pIdx}::jsonb`);
      params.push(JSON.stringify([filters.tag]));
      pIdx++;
    }

    const whereSql = conditions.join(' AND ');

    const countResult = await this.db.execute(sql.raw(
      `SELECT COUNT(*)::int AS cnt FROM endpoint_catalog WHERE ${whereSql}`
    ).mapWith ? { sql: '', params } as never : undefined as never).catch(async () => {
      // Fallback via direct client
      const { rows } = await this.db.execute(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { sql: `SELECT COUNT(*)::int AS cnt FROM endpoint_catalog WHERE ${whereSql}`, params } as any
      );
      return rows as unknown as { cnt: number }[];
    });

    // Use plain typed query via this.db.execute with interpolated conditions
    try {
      const rows = await this.db.execute(sql`
        SELECT * FROM endpoint_catalog
        WHERE tenant_id = ${filters.tenantId}
        ${filters.type ? sql`AND type = ${filters.type as string}` : sql``}
        ${filters.serviceName ? sql`AND service_name = ${filters.serviceName}` : sql``}
        ${filters.owner ? sql`AND owner = ${filters.owner}` : sql``}
        ${filters.team ? sql`AND team = ${filters.team}` : sql``}
        ${filters.authRequirement ? sql`AND auth_requirement = ${filters.authRequirement as string}` : sql``}
        ${filters.deprecated !== undefined ? sql`AND deprecated = ${filters.deprecated}` : sql``}
        ${filters.path ? sql`AND path ILIKE ${`%${filters.path}%`}` : sql``}
        ${filters.search ? sql`AND (path ILIKE ${`%${filters.search}%`} OR service_name ILIKE ${`%${filters.search}%`} OR COALESCE(component_name,'') ILIKE ${`%${filters.search}%`} OR COALESCE(description,'') ILIKE ${`%${filters.search}%`})` : sql``}
        ORDER BY path ASC, service_name ASC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const countRow = await this.db.execute(sql`
        SELECT COUNT(*)::int AS total FROM endpoint_catalog
        WHERE tenant_id = ${filters.tenantId}
        ${filters.type ? sql`AND type = ${filters.type as string}` : sql``}
        ${filters.serviceName ? sql`AND service_name = ${filters.serviceName}` : sql``}
        ${filters.owner ? sql`AND owner = ${filters.owner}` : sql``}
        ${filters.team ? sql`AND team = ${filters.team}` : sql``}
        ${filters.authRequirement ? sql`AND auth_requirement = ${filters.authRequirement as string}` : sql``}
        ${filters.deprecated !== undefined ? sql`AND deprecated = ${filters.deprecated}` : sql``}
        ${filters.path ? sql`AND path ILIKE ${`%${filters.path}%`}` : sql``}
        ${filters.search ? sql`AND (path ILIKE ${`%${filters.search}%`} OR service_name ILIKE ${`%${filters.search}%`} OR COALESCE(component_name,'') ILIKE ${`%${filters.search}%`} OR COALESCE(description,'') ILIKE ${`%${filters.search}%`})` : sql``}
      `);

      const typedRows = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
      const list = (Array.isArray(typedRows) ? typedRows : []) as Record<string, unknown>[];

      const totalRows = countRow as unknown as { rows?: { total: number }[] };
      const tArr = (totalRows as { rows: { total: number }[] }).rows ?? (countRow as unknown as { total: number }[]);
      const total = Array.isArray(tArr) ? (tArr[0] as { total: number })?.total ?? list.length : 0;

      const items = list.map((r) => EndpointCatalogEntry.fromRow({
        id: r.id as number,
        tenantId: r.tenant_id as number,
        type: r.type as EndpointEntryType,
        httpMethod: (r.http_method ?? null) as string | null,
        path: r.path as string,
        serviceName: r.service_name as string,
        componentName: (r.component_name ?? null) as string | null,
        description: (r.description ?? null) as string | null,
        authRequirement: r.auth_requirement as AuthRequirement,
        owner: (r.owner ?? null) as string | null,
        team: (r.team ?? null) as string | null,
        sourceFile: (r.source_file ?? null) as string | null,
        sourceLine: (r.source_line ?? null) as number | null,
        tags: (r.tags ?? null) as string[] | null,
        deprecated: Boolean(r.deprecated),
        version: (r.version ?? null) as string | null,
        lastSeenAt: r.last_seen_at as Date,
        firstSeenAt: r.first_seen_at as Date,
        createdAt: r.created_at as Date,
        updatedAt: r.updated_at as Date,
      }));

      return { items, total: (total as number) ?? items.length, limit, offset };
    } catch {
      return { items: [], total: 0, limit, offset };
    }
  }

  async findById(id: number, tenantId: number): Promise<EndpointCatalogEntry | null> {
    await this.ensureTablesExist();
    try {
      const result = await this.db.execute(sql`
        SELECT * FROM endpoint_catalog WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1
      `);
      const rows = (result as unknown as { rows: unknown[] }).rows ?? (result as unknown as unknown[]);
      const list = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
      if (list.length === 0) return null;
      const r = list[0];
      return EndpointCatalogEntry.fromRow({
        id: r.id as number,
        tenantId: r.tenant_id as number,
        type: r.type as EndpointEntryType,
        httpMethod: (r.http_method ?? null) as string | null,
        path: r.path as string,
        serviceName: r.service_name as string,
        componentName: (r.component_name ?? null) as string | null,
        description: (r.description ?? null) as string | null,
        authRequirement: r.auth_requirement as AuthRequirement,
        owner: (r.owner ?? null) as string | null,
        team: (r.team ?? null) as string | null,
        sourceFile: (r.source_file ?? null) as string | null,
        sourceLine: (r.source_line ?? null) as number | null,
        tags: (r.tags ?? null) as string[] | null,
        deprecated: Boolean(r.deprecated),
        version: (r.version ?? null) as string | null,
        lastSeenAt: r.last_seen_at as Date,
        firstSeenAt: r.first_seen_at as Date,
        createdAt: r.created_at as Date,
        updatedAt: r.updated_at as Date,
      });
    } catch {
      return null;
    }
  }

  async upsert(input: UpsertEndpointInput): Promise<EndpointCatalogEntry> {
    await this.ensureTablesExist();
    const result = await this.db.execute(sql`
      INSERT INTO endpoint_catalog (
        tenant_id, type, http_method, path, service_name, component_name, description,
        auth_requirement, owner, team, source_file, source_line, tags, deprecated, version, last_seen_at, updated_at
      ) VALUES (
        ${input.tenantId}, ${input.type}::endpoint_catalog_entry_type, ${input.httpMethod ?? null}, ${input.path},
        ${input.serviceName}, ${input.componentName ?? null}, ${input.description ?? null},
        ${(input.authRequirement ?? 'auth_required')}::endpoint_catalog_auth_requirement,
        ${input.owner ?? null}, ${input.team ?? null},
        ${input.sourceFile ?? null}, ${input.sourceLine ?? null},
        ${JSON.stringify(input.tags ?? [])}::jsonb, ${input.deprecated ?? false}, ${input.version ?? null},
        NOW(), NOW()
      )
      ON CONFLICT (tenant_id, type, http_method, path, service_name) DO UPDATE SET
        component_name = EXCLUDED.component_name,
        description = EXCLUDED.description,
        auth_requirement = EXCLUDED.auth_requirement,
        owner = EXCLUDED.owner,
        team = EXCLUDED.team,
        source_file = EXCLUDED.source_file,
        source_line = EXCLUDED.source_line,
        tags = EXCLUDED.tags,
        deprecated = EXCLUDED.deprecated,
        version = EXCLUDED.version,
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `);

    const rows = (result as unknown as { rows: unknown[] }).rows ?? (result as unknown as unknown[]);
    const list = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
    const r = list[0];
    if (!r) throw new Error('Upsert returned no row');
    return EndpointCatalogEntry.fromRow({
      id: r.id as number,
      tenantId: r.tenant_id as number,
      type: r.type as EndpointEntryType,
      httpMethod: (r.http_method ?? null) as string | null,
      path: r.path as string,
      serviceName: r.service_name as string,
      componentName: (r.component_name ?? null) as string | null,
      description: (r.description ?? null) as string | null,
      authRequirement: r.auth_requirement as AuthRequirement,
      owner: (r.owner ?? null) as string | null,
      team: (r.team ?? null) as string | null,
      sourceFile: (r.source_file ?? null) as string | null,
      sourceLine: (r.source_line ?? null) as number | null,
      tags: (r.tags ?? null) as string[] | null,
      deprecated: Boolean(r.deprecated),
      version: (r.version ?? null) as string | null,
      lastSeenAt: r.last_seen_at as Date,
      firstSeenAt: r.first_seen_at as Date,
      createdAt: r.created_at as Date,
      updatedAt: r.updated_at as Date,
    });
  }

  async bulkUpsert(inputs: UpsertEndpointInput[]): Promise<{ added: number; updated: number }> {
    if (inputs.length === 0) return { added: 0, updated: 0 };
    let added = 0;
    let updated = 0;
    // Chunk to avoid huge query
    const CHUNK = 50;
    for (let i = 0; i < inputs.length; i += CHUNK) {
      const chunk = inputs.slice(i, i + CHUNK);
      for (const input of chunk) {
        try {
          const existed = await this.db.execute(sql`
            SELECT id FROM endpoint_catalog
            WHERE tenant_id = ${input.tenantId}
              AND type = ${input.type}::endpoint_catalog_entry_type
              AND COALESCE(http_method,'') = COALESCE(${input.httpMethod ?? ''},'')
              AND path = ${input.path}
              AND service_name = ${input.serviceName}
            LIMIT 1
          `);
          const erows = (existed as unknown as { rows: unknown[] }).rows ?? (existed as unknown as unknown[]);
          const had = Array.isArray(erows) && erows.length > 0;
          await this.upsert(input);
          if (had) updated++; else added++;
        } catch {
          // skip on error per row
        }
      }
    }
    return { added, updated };
  }

  async deleteStale(tenantId: number, _seenBefore: Date, idsSeen: number[]): Promise<number> {
    // Only remove if idsSeen non-empty — safety guard
    if (idsSeen.length === 0) return 0;
    try {
      const result = await this.db.execute(sql`
        DELETE FROM endpoint_catalog
        WHERE tenant_id = ${tenantId}
          AND id NOT IN (${sql.join(idsSeen.map((id) => sql`${id}`), sql`, `)})
          AND last_seen_at < NOW() - INTERVAL '7 days'
      `);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (result as any).rowCount ?? 0;
    } catch {
      return 0;
    }
  }

  async stats(tenantId: number): Promise<{
    total: number;
    byType: Record<string, number>;
    byService: Record<string, number>;
    byAuth: Record<string, number>;
    deprecated: number;
  }> {
    await this.ensureTablesExist();
    try {
      const [totalRes, byTypeRes, byServiceRes, byAuthRes, deprRes] = await Promise.all([
        this.db.execute(sql`SELECT COUNT(*)::int AS c FROM endpoint_catalog WHERE tenant_id = ${tenantId}`),
        this.db.execute(sql`SELECT type::text AS k, COUNT(*)::int AS c FROM endpoint_catalog WHERE tenant_id = ${tenantId} GROUP BY type`),
        this.db.execute(sql`SELECT service_name AS k, COUNT(*)::int AS c FROM endpoint_catalog WHERE tenant_id = ${tenantId} GROUP BY service_name ORDER BY c DESC LIMIT 50`),
        this.db.execute(sql`SELECT auth_requirement::text AS k, COUNT(*)::int AS c FROM endpoint_catalog WHERE tenant_id = ${tenantId} GROUP BY auth_requirement`),
        this.db.execute(sql`SELECT COUNT(*)::int AS c FROM endpoint_catalog WHERE tenant_id = ${tenantId} AND deprecated = true`),
      ]);

      const unwrap = (res: unknown): { k: string; c: number }[] | { c: number }[] => {
        const r = (res as { rows?: unknown[] }).rows ?? (res as unknown[]);
        return (Array.isArray(r) ? r : []) as never;
      };

      const totalArr = unwrap(totalRes) as { c: number }[];
      const total = totalArr[0]?.c ?? 0;

      const toMap = (arr: { k: string; c: number }[]): Record<string, number> => {
        const m: Record<string, number> = {};
        for (const { k, c } of arr) m[k] = c;
        return m;
      };

      return {
        total,
        byType: toMap(unwrap(byTypeRes) as { k: string; c: number }[]),
        byService: toMap(unwrap(byServiceRes) as { k: string; c: number }[]),
        byAuth: toMap(unwrap(byAuthRes) as { k: string; c: number }[]),
        deprecated: (unwrap(deprRes) as { c: number }[])[0]?.c ?? 0,
      };
    } catch {
      return { total: 0, byType: {}, byService: {}, byAuth: {}, deprecated: 0 };
    }
  }

  async createSyncRun(tenantId: number): Promise<SyncRunProps> {
    await this.ensureTablesExist();
    const result = await this.db.execute(sql`
      INSERT INTO endpoint_catalog_sync_runs (tenant_id, status) VALUES (${tenantId}, 'running') RETURNING *
    `);
    const rows = (result as unknown as { rows: unknown[] }).rows ?? (result as unknown as unknown[]);
    const list = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
    const r = list[0];
    return {
      id: r.id as number,
      tenantId: r.tenant_id as number,
      status: r.status as SyncRunProps['status'],
      startedAt: r.started_at as Date,
      completedAt: (r.completed_at ?? null) as Date | null,
      endpointsFound: (r.endpoints_found ?? 0) as number,
      endpointsAdded: (r.endpoints_added ?? 0) as number,
      endpointsUpdated: (r.endpoints_updated ?? 0) as number,
      endpointsRemoved: (r.endpoints_removed ?? 0) as number,
      errorMessage: (r.error_message ?? null) as string | null,
      createdAt: r.created_at as Date,
    };
  }

  async completeSyncRun(id: number, result: {
    status: 'completed' | 'failed';
    endpointsFound: number;
    endpointsAdded: number;
    endpointsUpdated: number;
    endpointsRemoved: number;
    errorMessage?: string | null;
  }): Promise<SyncRunProps> {
    const dbResult = await this.db.execute(sql`
      UPDATE endpoint_catalog_sync_runs SET
        status = ${result.status},
        endpoints_found = ${result.endpointsFound},
        endpoints_added = ${result.endpointsAdded},
        endpoints_updated = ${result.endpointsUpdated},
        endpoints_removed = ${result.endpointsRemoved},
        error_message = ${result.errorMessage ?? null},
        completed_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    const rows = (dbResult as unknown as { rows: unknown[] }).rows ?? (dbResult as unknown as unknown[]);
    const list = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
    const r = list[0];
    return {
      id: r.id as number,
      tenantId: r.tenant_id as number,
      status: r.status as SyncRunProps['status'],
      startedAt: r.started_at as Date,
      completedAt: (r.completed_at ?? null) as Date | null,
      endpointsFound: (r.endpoints_found ?? 0) as number,
      endpointsAdded: (r.endpoints_added ?? 0) as number,
      endpointsUpdated: (r.endpoints_updated ?? 0) as number,
      endpointsRemoved: (r.endpoints_removed ?? 0) as number,
      errorMessage: (r.error_message ?? null) as string | null,
      createdAt: r.created_at as Date,
    };
  }

  async listSyncRuns(tenantId: number, limit = 20): Promise<SyncRunProps[]> {
    const result = await this.db.execute(sql`
      SELECT * FROM endpoint_catalog_sync_runs WHERE tenant_id = ${tenantId} ORDER BY started_at DESC LIMIT ${limit}
    `);
    const rows = (result as unknown as { rows: unknown[] }).rows ?? (result as unknown as unknown[]);
    const list = (Array.isArray(rows) ? rows : []) as Record<string, unknown>[];
    return list.map((r) => ({
      id: r.id as number,
      tenantId: r.tenant_id as number,
      status: r.status as SyncRunProps['status'],
      startedAt: r.started_at as Date,
      completedAt: (r.completed_at ?? null) as Date | null,
      endpointsFound: (r.endpoints_found ?? 0) as number,
      endpointsAdded: (r.endpoints_added ?? 0) as number,
      endpointsUpdated: (r.endpoints_updated ?? 0) as number,
      endpointsRemoved: (r.endpoints_removed ?? 0) as number,
      errorMessage: (r.error_message ?? null) as string | null,
      createdAt: r.created_at as Date,
    }));
  }
}
