/**
 * Connected data sources — the canvas's read-only view of a live warehouse.
 *
 * Server counterpart: `api/src/presentation/routes/dataSourceRoutes.ts`.
 *
 * Everything here is a READ. There is no write method and there is not meant to
 * be one: a canvas binds to a source so a board can be grounded in real rows and
 * a real schema, and the port refuses anything that is not a single SELECT.
 */

import { apiRequest } from './apiClient';
import type { TabularSource } from './canvasTabularData';
import type { IntrospectedRelationship, IntrospectedTable } from './canvasDataModel';

export interface DataSourceSummary {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  transport: 'http' | 'tcp';
  operations: string[];
  reachable: boolean;
  canIntrospect: boolean;
  canQuery: boolean;
  note: string | null;
}

export interface DataSourceSchema {
  provider: string;
  providerLabel: string;
  tables: IntrospectedTable[];
  relationships: IntrospectedRelationship[];
  scanned: string[];
}

export interface DataSourceQueryResult extends TabularSource {
  rowCount: number;
  truncated: boolean;
  sql: string;
  source: { id: string; name: string; provider: string; providerLabel: string };
}

export const dataSourceApi = {
  list: () => apiRequest<{ sources: DataSourceSummary[] }>('/api/data-sources'),

  /** `dataset` is required by BigQuery and ignored by every other provider. */
  schema: (id: string, dataset?: string) =>
    apiRequest<DataSourceSchema>(`/api/data-sources/${encodeURIComponent(id)}/schema${dataset ? `?dataset=${encodeURIComponent(dataset)}` : ''}`),

  query: (id: string, sql: string, limit?: number) =>
    apiRequest<DataSourceQueryResult>(`/api/data-sources/${encodeURIComponent(id)}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql, ...(limit ? { limit } : {}) }),
    }),
};

/**
 * Pick the source a canvas action should use.
 *
 * Ambiguity is an error, exactly as it is for a workflow node: silently choosing
 * between a staging and a production warehouse is how a board ends up quoting
 * the wrong numbers with total confidence.
 */
export function resolveDataSource(
  sources: readonly DataSourceSummary[],
  hint: { id?: string | null; name?: string | null } = {},
): { ok: true; source: DataSourceSummary } | { ok: false; error: string } {
  const usable = sources.filter((source) => source.reachable);
  if (!usable.length) {
    return { ok: false, error: sources.length
      ? 'The connected data sources cannot be reached from this runtime.'
      : 'No data source is connected to this workspace.' };
  }
  if (hint.id) {
    const match = usable.find((source) => source.id === hint.id);
    return match ? { ok: true, source: match } : { ok: false, error: `No connected data source has the id "${hint.id}".` };
  }
  if (hint.name) {
    const needle = hint.name.trim().toLowerCase();
    const matches = usable.filter((source) => source.name.toLowerCase() === needle || source.provider === needle || source.providerLabel.toLowerCase() === needle);
    if (matches.length === 1) return { ok: true, source: matches[0]! };
    if (matches.length > 1) return { ok: false, error: `Several connected sources are called "${hint.name}". Use the id instead.` };
    return { ok: false, error: `No connected data source is called "${hint.name}". Connected: ${usable.map((source) => source.name).join(', ')}.` };
  }
  if (usable.length === 1) return { ok: true, source: usable[0]! };
  return { ok: false, error: `Say which data source to use: ${usable.map((source) => `${source.name} (${source.providerLabel})`).join(', ')}.` };
}
