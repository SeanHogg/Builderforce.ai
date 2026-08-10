/**
 * The cloud `mcp` node handler — the half of the workflow builder that never ran.
 *
 * Every integration in the builder's Data and Marketing palettes compiles to the
 * `mcp` node kind. `executeCloudNode` covered trigger/llm/transform/filter/
 * branch/output/gmail natively and failed `mcp` outright with "run this on a
 * self-hosted agent host" — and no agent-host handler for `node:mcp` existed
 * either, so a workflow assembled from those palettes failed on every surface.
 * This is the missing executor.
 *
 * HOW A NODE RESOLVES ITS CREDENTIAL
 * The node names a provider (`postgres`, `hubspot`, …) and optionally a specific
 * credential by id or name. With neither, the tenant's single enabled credential
 * for that provider is used — and an AMBIGUOUS match is an error, not a coin
 * flip: silently picking one of two Postgres connections would eventually write
 * to the wrong database.
 *
 * The actual HTTP call is delegated to `dataProviderCatalog.callProvider`, the
 * same function the connect form's "Test connection" runs, so a green test and a
 * green node mean the same thing.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { integrationCredentials } from '../../infrastructure/database/schema';
import { decryptCredentials } from '../integrations/credentialCrypto';
import { callProvider, providerSpec, tcpTransportMessage } from '../integrations/dataProviderCatalog';

/** The `config` an `mcp` node carries on the canvas. */
export interface McpNodeConfig {
  /** Provider id from the catalog — the palette writes this. */
  provider?: unknown;
  /** Legacy/alias key: the palette's integration id. */
  integrationId?: unknown;
  operation?: unknown;
  /** Operation parameters (table, sql, email, …). */
  params?: unknown;
  /** Disambiguators when a tenant has several credentials for one provider. */
  credentialId?: unknown;
  credentialName?: unknown;
}

export interface McpNodeContext {
  db: Db;
  tenantId: number;
  encryptionSecret: string;
}

export type McpNodeOutcome =
  | { ok: true; output: string }
  | { ok: false; error: string };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read the node's provider id, tolerating both keys the canvas has used.
 * Exported because the compiler and the palette both need to agree on it.
 */
export function providerIdFromConfig(config: McpNodeConfig): string {
  return text(config.provider) || text(config.integrationId);
}

/**
 * Find the credential this node should use.
 *
 * Ambiguity is an error. A workflow that writes to "the Postgres connection"
 * when the tenant has a staging one and a production one must say which.
 */
async function resolveNodeCredential(
  ctx: McpNodeContext,
  providerId: string,
  config: McpNodeConfig,
): Promise<
  | { ok: true; credentials: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const filters = [
    eq(integrationCredentials.tenantId, ctx.tenantId),
    eq(integrationCredentials.provider, providerId as never),
    eq(integrationCredentials.isEnabled, true),
  ];
  const credentialId = text(config.credentialId);
  const credentialName = text(config.credentialName);
  if (credentialId) filters.push(eq(integrationCredentials.id, credentialId));
  else if (credentialName) filters.push(eq(integrationCredentials.name, credentialName));

  const rows = await ctx.db
    .select({
      id: integrationCredentials.id,
      name: integrationCredentials.name,
      credentialsEnc: integrationCredentials.credentialsEnc,
      iv: integrationCredentials.iv,
    })
    .from(integrationCredentials)
    .where(and(...filters))
    .limit(5);

  if (rows.length === 0) {
    return {
      ok: false,
      error: `No enabled ${providerId} connection is set up for this workspace. Add one in Integrations.`,
    };
  }
  if (rows.length > 1) {
    const names = rows.map((r) => `"${r.name}"`).join(', ');
    return {
      ok: false,
      error: `This workspace has several ${providerId} connections (${names}). Set the node's credential to pick one.`,
    };
  }

  const row = rows[0]!;
  const credentials = await decryptCredentials(row.credentialsEnc, row.iv, ctx.encryptionSecret, ctx.tenantId);
  if (!credentials) {
    return { ok: false, error: `The stored ${providerId} credential could not be decrypted.` };
  }
  return { ok: true, credentials };
}

/**
 * Run one `mcp` node.
 *
 * Returns a typed outcome rather than throwing so the executor can record a
 * precise, user-readable failure on the task instead of a stack trace.
 */
export async function executeMcpNode(
  ctx: McpNodeContext,
  config: McpNodeConfig,
  inputText: string,
  fetchImpl: typeof fetch = fetch,
): Promise<McpNodeOutcome> {
  const providerId = providerIdFromConfig(config);
  if (!providerId) {
    return { ok: false, error: 'This integration node has no provider selected.' };
  }

  const spec = providerSpec(providerId);
  if (!spec) {
    return {
      ok: false,
      error: `"${providerId}" is not an integration this runtime can execute. `
        + `Supported providers are listed at GET /api/integrations/catalog.`,
    };
  }
  if (spec.transport === 'tcp') {
    return { ok: false, error: tcpTransportMessage(spec.label) };
  }

  const operation = text(config.operation) || spec.testOperation;
  const params = resolveParams(config.params, inputText);

  // Resolve against the CANONICAL id: the palette writes kebab-case, the enum
  // stores snake_case, and the credential lookup must use the stored form.
  const credential = await resolveNodeCredential(ctx, spec.id, config);
  if (!credential.ok) return credential;

  const result = await callProvider(providerId, operation, credential.credentials, params, fetchImpl);
  if (!result.ok) {
    return { ok: false, error: result.error ?? `${spec.label} call failed.` };
  }
  return { ok: true, output: typeof result.body === 'string' ? result.body : JSON.stringify(result.body) };
}

/**
 * Merge the node's static params with the upstream payload.
 *
 * A workflow's value is that an earlier step feeds a later one, so when the
 * upstream output is a JSON object it is spread UNDER the node's own config:
 * explicit configuration wins over inherited data, which is the least
 * surprising precedence and prevents an upstream field from silently
 * redirecting a write to another table.
 */
export function resolveParams(configured: unknown, inputText: string): Record<string, unknown> {
  const explicit =
    configured && typeof configured === 'object' && !Array.isArray(configured)
      ? (configured as Record<string, unknown>)
      : {};
  let inherited: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(inputText) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      inherited = parsed as Record<string, unknown>;
    }
  } catch {
    // Upstream produced plain text rather than a JSON object, so there are no
    // fields to inherit. Not an error: a prose-producing LLM node feeding an
    // integration node is a normal shape.
    inherited = {};
  }
  return { ...inherited, ...explicit };
}
