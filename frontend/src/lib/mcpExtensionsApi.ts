import { apiRequest } from './apiClient';

/**
 * Bring-your-own MCP servers — the external tool servers a workspace registers so
 * its agents can call them like any other platform tool.
 *
 * Server counterpart: `api/src/presentation/routes/mcpExtensionRoutes.ts`
 * (owner-only, tenant-scoped). The credential never reaches the browser: a static
 * secret is written once and stored AES-GCM encrypted, and an OAuth server is
 * connected through a three-legged flow the API drives server-to-server.
 *
 * Connecting is a top-level browser NAVIGATION, not a fetch — the provider's
 * consent screen cannot be framed — so `oauthConnect()` returns the URL for the
 * caller to navigate to, the same contract `mailboxApi.connect` uses.
 */

/** How a registered server authenticates. `none` = the server needs no credential. */
export type McpAuthKind = 'none' | 'secret' | 'oauth';

/** The MCP wire dialect used with a server; `auto` probes on first use. */
export type McpProtocol = 'auto' | 'mcp' | 'legacy';

export interface McpExtension {
  id: string;
  name: string;
  serverUrl: string;
  enabled: boolean;
  /** True when a static secret is stored. The secret itself is never returned. */
  hasSecret: boolean;
  protocol: string;
  /** null = every tool allowed; [] = registered but no tool consented. */
  allowedTools: string[] | null;
  authKind: McpAuthKind;
  oauthConnectedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreateMcpExtensionInput {
  name: string;
  serverUrl: string;
  secret?: string | null;
}

export interface UpdateMcpExtensionInput {
  name?: string;
  serverUrl?: string;
  enabled?: boolean;
  /** A string re-encrypts; `null` clears the stored secret. */
  secret?: string | null;
  /** `null` restores "every tool allowed". */
  allowedTools?: string[] | null;
  protocol?: McpProtocol;
}

const base = (tenantId: number): string => `/api/tenants/${tenantId}/mcp-extensions`;
// No Content-Type here: `apiRequest` sets `application/json` for any request
// with a non-self-typed body (see `isSelfTypedBody`), and typing this as a
// `RequestInit` — whose `headers` is `HeadersInit`, not the `Record<string,
// string>` `RequestOptions` takes — is what made every call site a type error.
const body = (payload: unknown): RequestOptions => ({ body: JSON.stringify(payload) });

export const mcpExtensionsApi = {
  list: (tenantId: number): Promise<McpExtension[]> =>
    apiRequest<{ extensions: McpExtension[] }>(base(tenantId)).then((r) => r.extensions),

  create: (tenantId: number, input: CreateMcpExtensionInput): Promise<McpExtension> =>
    apiRequest<McpExtension>(base(tenantId), { method: 'POST', ...body(input) }),

  update: (tenantId: number, id: string, input: UpdateMcpExtensionInput): Promise<McpExtension> =>
    apiRequest<{ extension: McpExtension }>(`${base(tenantId)}/${id}`, { method: 'PATCH', ...body(input) }).then((r) => r.extension),

  remove: (tenantId: number, id: string): Promise<{ ok: boolean }> =>
    apiRequest(`${base(tenantId)}/${id}`, { method: 'DELETE' }),

  /** Returns the provider consent URL. The caller navigates — see the note above. */
  oauthConnect: (tenantId: number, id: string, returnTo = '/settings/integrations'): Promise<{ authUrl: string }> =>
    apiRequest(`${base(tenantId)}/${id}/oauth/connect?returnTo=${encodeURIComponent(returnTo)}`),

  /** Revokes the OAuth grant but KEEPS the registration, so reconnecting does not
   *  have to re-register a client with the authorization server. */
  oauthDisconnect: (tenantId: number, id: string): Promise<{ ok: boolean }> =>
    apiRequest(`${base(tenantId)}/${id}/oauth`, { method: 'DELETE' }),
};
