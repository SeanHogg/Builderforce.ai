/**
 * projectSecrets — THE access layer for a project's own credential vault.
 *
 * A project that has a running backend needs credentials the BACKEND holds, not
 * credentials an agent holds: the Twilio auth token its webhook verifier checks
 * signatures with, a signing key, a partner API key. Those are scoped to one
 * project's deployed system.
 *
 * This is deliberately NOT `connector_connections`. A connection is "the tenant's
 * production Slack, callable by any agent in the tenant"; a project secret is
 * "the value THIS project's backend runs with". They have different blast radius,
 * and collapsing them would mean a deployed project backend could read every
 * credential the tenant owns — including ones for systems it has no business
 * touching.
 *
 * ── READ DISCIPLINE ─────────────────────────────────────────────────────────
 * There is no "read one secret back to a human" operation, by design. Humans get
 * {@link listProjectSecrets} (name + hint + description, never the value); the
 * handler runtime gets {@link loadProjectSecretValues}, which is server-side only
 * and whose result must never be serialised into a response. `redactSecretValues`
 * exists so anything derived from a handler run can be scrubbed before it is
 * logged or returned.
 *
 * Sealing reuses `credentialCrypto` verbatim — one key-derivation contract in the
 * platform means a rotation or an algorithm change lands everywhere at once.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { projectSecrets } from '../../infrastructure/database/schema';
import { credentialSecret, decryptCredentials, encryptCredentials } from '../integrations/credentialCrypto';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** Env-var shape. Uppercase so a secret name is never mistaken for a template path. */
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

/** Largest value we will seal. Well above any real token, below a body limit. */
const MAX_SECRET_BYTES = 8_192;

export type SecretValidation = { ok: true } | { ok: false; reason: string };

/** Validate a secret NAME. Exported so the route and the blueprint loader agree. */
export function validateSecretName(name: string): SecretValidation {
  if (typeof name !== 'string' || name.length === 0) return { ok: false, reason: 'Secret name is required' };
  if (!SECRET_NAME_RE.test(name)) {
    return { ok: false, reason: 'Secret names are UPPER_SNAKE_CASE, starting with a letter (e.g. TWILIO_AUTH_TOKEN)' };
  }
  return { ok: true };
}

/** Validate a secret VALUE. Empty is rejected: an empty secret is a silent outage. */
export function validateSecretValue(value: string): SecretValidation {
  if (typeof value !== 'string' || value.length === 0) return { ok: false, reason: 'Secret value is required' };
  if (new TextEncoder().encode(value).length > MAX_SECRET_BYTES) {
    return { ok: false, reason: `Secret value exceeds ${MAX_SECRET_BYTES} bytes` };
  }
  return { ok: true };
}

/**
 * The identifying tail of a value, for the UI's `••••1a2b`. Short values get no
 * hint at all rather than a hint that reveals most of them.
 */
export function secretHint(value: string): string | null {
  return value.length >= 8 ? value.slice(-4) : null;
}

/** What a human is allowed to see about a stored secret. Never the value. */
export interface ProjectSecretSummary {
  id: string;
  name: string;
  description: string | null;
  hint: string | null;
  updatedAt: string | null;
}

/** Secrets for a project, masked. Safe to serialise into an HTTP response. */
export async function listProjectSecrets(
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<ProjectSecretSummary[]> {
  const rows = await db
    .select({
      id: projectSecrets.id,
      name: projectSecrets.name,
      description: projectSecrets.description,
      hint: projectSecrets.hint,
      updatedAt: projectSecrets.updatedAt,
    })
    .from(projectSecrets)
    .where(and(eq(projectSecrets.tenantId, tenantId), eq(projectSecrets.projectId, projectId)))
    .orderBy(projectSecrets.name);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    hint: r.hint,
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
  }));
}

export type SetSecretResult = { ok: true; id: string } | { ok: false; status: 400; reason: string };

/**
 * Create or replace one secret. Upsert (not insert) so re-running a blueprint or
 * rotating a token is the same call — a duplicate-name error here would only ever
 * push callers into delete-then-insert, which loses the value on a partial failure.
 */
export async function setProjectSecret(
  db: Db,
  env: Env,
  args: {
    tenantId: number;
    projectId: number;
    name: string;
    value: string;
    description?: string | null;
    userId?: string | null;
  },
): Promise<SetSecretResult> {
  const validName = validateSecretName(args.name);
  if (!validName.ok) return { ok: false, status: 400, reason: validName.reason };
  const validValue = validateSecretValue(args.value);
  if (!validValue.ok) return { ok: false, status: 400, reason: validValue.reason };

  const { enc, iv } = await encryptCredentials({ v: args.value }, credentialSecret(env), args.tenantId);
  const [row] = await db
    .insert(projectSecrets)
    .values({
      projectId: args.projectId,
      tenantId: args.tenantId,
      name: args.name,
      valueEnc: enc,
      iv,
      description: args.description ?? null,
      hint: secretHint(args.value),
      createdByUserId: args.userId ?? null,
    })
    .onConflictDoUpdate({
      target: [projectSecrets.projectId, projectSecrets.name],
      set: {
        valueEnc: enc,
        iv,
        description: args.description ?? null,
        hint: secretHint(args.value),
        updatedAt: new Date(),
      },
    })
    .returning({ id: projectSecrets.id });
  return { ok: true, id: row!.id };
}

/** Delete one secret by name. A missing name is a no-op (delete is idempotent). */
export async function deleteProjectSecret(
  db: Db,
  tenantId: number,
  projectId: number,
  name: string,
): Promise<void> {
  await db
    .delete(projectSecrets)
    .where(
      and(
        eq(projectSecrets.tenantId, tenantId),
        eq(projectSecrets.projectId, projectId),
        eq(projectSecrets.name, name),
      ),
    );
}

/**
 * Decrypted `{ NAME: value }` for the handler runtime. SERVER-SIDE ONLY — the
 * result must never reach a response body or a log. A row that fails to decrypt
 * is SKIPPED rather than throwing: one unreadable secret (a rotated base secret,
 * a restored row) must not take the whole backend offline, and the handler that
 * needed it will fail with a clear "missing secret" instead of a crypto error.
 */
export async function loadProjectSecretValues(
  db: Db,
  env: Env,
  tenantId: number,
  projectId: number,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ name: projectSecrets.name, valueEnc: projectSecrets.valueEnc, iv: projectSecrets.iv })
    .from(projectSecrets)
    .where(and(eq(projectSecrets.tenantId, tenantId), eq(projectSecrets.projectId, projectId)));

  const secret = credentialSecret(env);
  const out: Record<string, string> = {};
  for (const row of rows) {
    try {
      const blob = await decryptCredentials(row.valueEnc, row.iv, secret, tenantId);
      const value = blob?.v;
      if (typeof value === 'string' && value.length > 0) out[row.name] = value;
    } catch (error) {
      reportCaughtError(error, {
        source: 'application/secrets/projectSecrets.ts',
        operation: `loadProjectSecretValues:${row.name}`,
      });
    }
  }
  return out;
}

/**
 * Scrub every secret value out of a string before it is logged or returned.
 * Short values are skipped — replacing a 4-character secret would corrupt
 * unrelated text far more often than it would protect anything.
 */
export function redactSecretValues(text: string, values: Record<string, string>): string {
  let out = text;
  for (const v of Object.values(values)) {
    if (v && v.length >= 6) out = out.split(v).join('«redacted»');
  }
  return out;
}
