/**
 * Connector platform client — /api/connectors.
 *
 * Rides the ONE transport (`apiRequest`) for the reasons documented at the top of
 * `apiClient.ts`: emulation, locale and error-toast headers are load-bearing, and
 * a hand-rolled fetch here would silently opt out of all three.
 *
 * The types mirror `api/src/application/connectors/*` deliberately closely — the
 * builder round-trips a manifest through this client unchanged, so a divergence
 * between the two shapes shows up as a validation error the user can't act on.
 */

import { apiRequest } from './apiClient';

export type ConnectorCategory =
  | 'communication' | 'crm' | 'productivity' | 'devtools'
  | 'finance' | 'marketing' | 'support' | 'storage' | 'data' | 'other';

export type ConnectorAuthKind = 'none' | 'api_key' | 'bearer' | 'basic' | 'oauth2';
export type ConnectorMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ConnectorParamLocation = 'path' | 'query' | 'body' | 'header';

export interface ConnectorAuthField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface ConnectorAuth {
  kind: ConnectorAuthKind;
  in?: 'header' | 'query';
  name?: string;
  prefix?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  fields?: ConnectorAuthField[];
}

export interface ConnectorParam {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
  in: ConnectorParamLocation;
  name?: string;
  enum?: string[];
  default?: unknown;
  bodyPath?: string;
}

export interface ConnectorAction {
  key: string;
  label: string;
  description: string;
  method: ConnectorMethod;
  path: string;
  mutates: boolean;
  params: Record<string, ConnectorParam>;
  required?: string[];
  bodyTemplate?: Record<string, unknown>;
  headers?: Record<string, string>;
  bodyFormat?: 'json' | 'form';
  /** Present when the action speaks SOAP rather than JSON — a transport the runtime
   *  supplies so a SOAP-only vendor (Microsoft Advertising) can be manifest data like
   *  everything else. The builder shows it read-only; nothing here composes one. */
  soap?: {
    action: string;
    namespace: string;
    operation: string;
    version?: '1.1' | '1.2';
    header?: Record<string, string>;
  };
  resultPath?: string;
}

export interface ConnectorManifest {
  key: string;
  name: string;
  description: string;
  category: ConnectorCategory;
  icon: string;
  baseUrl: string;
  docsUrl?: string;
  auth: ConnectorAuth;
  defaultHeaders?: Record<string, string>;
  actions: ConnectorAction[];
}

export interface ConnectorSummary {
  key: string;
  name: string;
  description: string;
  category: ConnectorCategory;
  icon: string;
  origin: 'builtin' | 'tenant';
  status: 'published' | 'draft';
  id: string | null;
  version: number;
  actionCount: number;
  docsUrl?: string;
  authKind: ConnectorAuthKind;
  connectionCount: number;
}

export interface ConnectorDetail {
  manifest: ConnectorManifest;
  origin: 'builtin' | 'tenant';
  status: 'published' | 'draft';
  id: string | null;
  version: number;
  editable: boolean;
}

export interface ConnectorConnection {
  id: string;
  connectorKey: string;
  name: string;
  enabled: boolean;
  baseUrlOverride: string | null;
  /** Non-secret credential values, echoed back so a connection is identifiable. */
  publicFields: Record<string, string>;
  /** Keys that HAVE a stored secret. The values never leave the server. */
  secretFieldsSet: string[];
  lastTestOk: boolean | null;
  lastTestedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ConnectorCallResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
  durationMs: number;
  truncated?: boolean;
}

export interface ConnectorCallLog {
  id: number;
  connectorKey: string;
  actionKey: string;
  ok: boolean;
  statusCode: number | null;
  durationMs: number | null;
  error: string | null;
  actorKind: string;
  createdAt: string;
}

export interface OpenApiImportResult {
  manifest: ConnectorManifest;
  warnings: string[];
  totalOperations: number;
}

/** One parameter of one action, as a form needs it. */
export interface CatalogParam {
  name: string;
  in: string;
  type: string;
  description: string;
  required: boolean;
  enum?: string[];
}

export interface CatalogAction {
  key: string;
  label: string;
  description: string;
  /** True when the action CHANGES something — sends a message, charges a card. */
  mutates: boolean;
  params: CatalogParam[];
  /** Input object pre-seeded with every required parameter. */
  inputTemplate: Record<string, string>;
}

export interface CatalogConnector {
  key: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  origin: 'builtin' | 'tenant';
  docsUrl?: string;
  authFields: Array<{ key: string; label: string; required: boolean; secret: boolean }>;
  actions: CatalogAction[];
}

export const connectorsApi = {
  /** Catalog: built-ins + this tenant's custom connectors, with connection counts. */
  catalog: (): Promise<{ connectors: ConnectorSummary[]; categories: ConnectorCategory[] }> =>
    apiRequest('/api/connectors'),

  /**
   * Every callable action with its parameters — what the workflow builder's
   * connector node picks from. Server-cached, so opening the picker repeatedly
   * is free.
   */
  actions: (): Promise<CatalogConnector[]> =>
    apiRequest<{ connectors: CatalogConnector[] }>('/api/connectors/actions').then((r) => r.connectors ?? []),

  get: (key: string): Promise<ConnectorDetail> =>
    apiRequest(`/api/connectors/${encodeURIComponent(key)}`),

  create: (manifest: ConnectorManifest, publish = false): Promise<{ id: string; status: string }> =>
    apiRequest('/api/connectors', { method: 'POST', body: JSON.stringify({ manifest, publish }) }),

  update: (id: string, body: { manifest?: ConnectorManifest; status?: 'published' | 'draft' }) =>
    apiRequest<{ status: string }>(`/api/connectors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  remove: (id: string): Promise<{ ok: boolean; deletedConnections: number }> =>
    apiRequest(`/api/connectors/${id}`, { method: 'DELETE' }),

  /** Generate a DRAFT manifest from an OpenAPI/Swagger document. Does not save. */
  importOpenApi: (body: {
    key: string; specUrl?: string; spec?: unknown; name?: string; icon?: string; category?: string;
  }): Promise<OpenApiImportResult> =>
    apiRequest('/api/connectors/import/openapi', { method: 'POST', body: JSON.stringify(body) }),

  listConnections: (connectorKey?: string): Promise<ConnectorConnection[]> =>
    apiRequest<{ connections: ConnectorConnection[] }>(
      `/api/connectors/connections/list${connectorKey ? `?connectorKey=${encodeURIComponent(connectorKey)}` : ''}`,
    ).then((r) => r.connections ?? []),

  createConnection: (body: {
    connectorKey: string; name: string; credentials: Record<string, string>; baseUrlOverride?: string | null;
  }): Promise<ConnectorConnection> =>
    apiRequest<{ connection: ConnectorConnection }>('/api/connectors/connections', {
      method: 'POST', body: JSON.stringify(body),
    }).then((r) => r.connection),

  updateConnection: (id: string, body: {
    name?: string; enabled?: boolean; credentials?: Record<string, string>; baseUrlOverride?: string | null;
  }): Promise<ConnectorConnection> =>
    apiRequest<{ connection: ConnectorConnection }>(`/api/connectors/connections/${id}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }).then((r) => r.connection),

  removeConnection: (id: string): Promise<{ ok: boolean }> =>
    apiRequest(`/api/connectors/connections/${id}`, { method: 'DELETE' }),

  testConnection: (id: string, body?: { actionKey?: string; input?: Record<string, unknown> }) =>
    apiRequest<{ ok: boolean; message: string; result?: ConnectorCallResult }>(
      `/api/connectors/connections/${id}/test`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
    ),

  /** Run one action by hand — the builder's "Run action", audited as actorKind 'user'. */
  runAction: (key: string, action: string, body: { input?: Record<string, unknown>; connectionId?: string }) =>
    apiRequest<ConnectorCallResult>(
      `/api/connectors/${encodeURIComponent(key)}/actions/${encodeURIComponent(action)}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  logs: (connectionId?: string, limit = 25): Promise<ConnectorCallLog[]> =>
    apiRequest<{ logs: ConnectorCallLog[] }>(
      `/api/connectors/logs/recent?limit=${limit}${connectionId ? `&connectionId=${connectionId}` : ''}`,
    ).then((r) => r.logs ?? []),
};

/**
 * The credential fields a connection for this manifest must collect.
 *
 * Mirrors `authFieldsFor` on the server. It is duplicated rather than fetched
 * because the connect form must render before any round-trip, and the DEFAULTS are
 * a property of the auth kind — a fixed, versioned contract, not tenant data.
 */
export function authFieldsFor(manifest: ConnectorManifest): ConnectorAuthField[] {
  if (manifest.auth.fields?.length) return manifest.auth.fields;
  switch (manifest.auth.kind) {
    case 'api_key':
      return [{ key: 'apiKey', label: 'API key', secret: true, required: true }];
    case 'bearer':
      return [{ key: 'token', label: 'Access token', secret: true, required: true }];
    case 'basic':
      return [
        { key: 'username', label: 'Username', secret: false, required: true },
        { key: 'password', label: 'Password or API token', secret: true, required: true },
      ];
    case 'oauth2':
      return [{ key: 'accessToken', label: 'Access token', secret: true, required: true }];
    default:
      return [];
  }
}
