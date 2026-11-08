/**
 * What the distribution use cases share: the posting lookup, the connection-backed
 * params, the public-link builder and its filter, and the injected seam they all run
 * through.
 *
 * Four use cases — publish (`distributePosting`), link (`linkBoardJob`), import
 * (`importBoardApplicants`) and link-finding (`resolveBoardUrls`) — need these, and they
 * used to live in the first of them, which made the other three import a use case for its
 * helpers. They live here so each use case imports only what it uses.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { jobPostings } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { fillTemplate, type ConnectorAction } from '../connectors/connectorManifest';
import { templateConnectionFields } from '../connectors/connectorMappingValidators';
import { renderUrlTemplate } from '../connectors/connectorResponseMapping';
import { executeConnectorAction, loadConnection } from '../connectors/connectorRuntime';
import { AtsError } from './atsError';

/** The seam a test replaces; production is the one connector executor. */
export interface DistributeDeps {
  execute: typeof executeConnectorAction;
  /**
   * Decrypt one connection. Injected so a test can supply the organisation URN
   * (and any other connection-backed param) without standing up encryption.
   * Production uses {@link loadConnection}.
   */
  loadConnection?: typeof loadConnection;
}

export const DEFAULT_DISTRIBUTE_DEPS: DistributeDeps = { execute: executeConnectorAction, loadConnection };

/** The posting facts a board listing is built from. */
export type DistributablePosting = {
  id: string;
  title: string;
  description: string | null;
  requirements: string | null;
  status: string;
  experienceLevel: string | null;
};

/** The posting, tenant-scoped; a 404 `AtsError` for an id this workspace does not own. */
export async function requirePosting(db: Db, tenantId: number, postingId: string): Promise<DistributablePosting> {
  const [row] = await db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      description: jobPostings.description,
      requirements: jobPostings.requirements,
      status: jobPostings.status,
      experienceLevel: jobPostings.experienceLevel,
    })
    .from(jobPostings)
    .where(scopedToTenant(jobPostings, tenantId, eq(jobPostings.id, postingId)))
    .limit(1);
  if (!row) throw new AtsError('No posting in this workspace has that id', 404);
  return row;
}

/**
 * Action params that a posting does not own — they live on the connection.
 *
 * A default of `{{auth.x}}` is the declaration: the value is a connection fact,
 * not a requisition fact. LinkedIn's organisation URN is the one today; a board
 * that needs a similar tenant-level id declares the same default and is filled
 * the same way, so this file still names no vendor.
 *
 * Empty after substitution is omitted: the caller then sees the param as missing
 * and refuses to publish, rather than sending `company_id: ''` upstream.
 */
export function connectionBackedInput(
  action: ConnectorAction,
  auth: Record<string, string>,
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [name, param] of Object.entries(action.params)) {
    if (typeof param.default !== 'string' || !/\{\{\s*auth\./.test(param.default)) continue;
    const filled = fillTemplate(param.default, auth).trim();
    if (filled) extra[name] = filled;
  }
  return extra;
}

/** Connection-backed params that are still empty after filling from auth. */
export function missingConnectionParams(
  action: ConnectorAction,
  body: Record<string, unknown>,
): string[] {
  const missing: string[] = [];
  for (const [name, param] of Object.entries(action.params)) {
    if (typeof param.default !== 'string' || !/\{\{\s*auth\./.test(param.default)) continue;
    const value = body[name];
    if (typeof value !== 'string' || !value.trim()) missing.push(name);
  }
  return missing;
}

/**
 * A board-reported or rendered URL, kept only when it is an absolute HTTPS address.
 *
 * The URL is shown as a link on the canvas card and in the seat, and it came from a
 * third party's response body (or a template filled from a connection). Anything else —
 * a relative path, a `javascript:` URL, plain `http:` — is dropped rather than repaired:
 * the publication is still confirmed by its id, it simply has no link, which is the
 * honest reading of a board that gave none usable. Every board here serves HTTPS, so a
 * downgrade is a fault, not a link.
 */
export function publicUrl(value: string | null): string | null {
  if (!value || value.length > 1000) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The public link a manifest's `urlTemplate` builds for a confirmed posting, or null.
 *
 * Best-effort by design: the posting IS confirmed by its id, and a link that cannot be
 * built (no template, a connection field the template needs is empty, the connection
 * cannot be read) simply leaves the row without one. Only the non-secret fields the
 * template names are read from the decrypted connection, and the result passes the same
 * {@link publicUrl} gate as a board-reported URL.
 */
export async function derivedUrl(
  db: Db,
  env: Env,
  deps: DistributeDeps,
  args: { tenantId: number; connectionId: string; action: ConnectorAction },
  externalId: string,
  postId: string | null = null,
): Promise<string | null> {
  const template = args.action.response?.urlTemplate;
  if (!template) return null;
  const fields = templateConnectionFields(template);
  const connection: Record<string, string> = {};
  if (fields.length) {
    try {
      const loaded = await (deps.loadConnection ?? loadConnection)(db, env, args.tenantId, args.connectionId);
      for (const field of fields) connection[field] = loaded.auth[field] ?? '';
    } catch {
      return null;
    }
  }
  return publicUrl(renderUrlTemplate(template, {
    externalId, postId, connection,
    ...(args.action.response?.externalIdPattern ? { externalIdPattern: args.action.response.externalIdPattern } : {}),
  }));
}

/** Postgres `unique_violation` (23505), whichever way the driver wraps it. */
export function isUniqueViolation(error: unknown): boolean {
  const code = (value: unknown): unknown => (value && typeof value === 'object' ? (value as { code?: unknown }).code : undefined);
  return code(error) === '23505' || code((error as { cause?: unknown } | null)?.cause) === '23505';
}
