/**
 * Adding a university, as a screen instead of a deploy.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * LTI platform registrations lived in the `LTI_REGISTRATIONS` secret, so onboarding
 * an institution was `wrangler secret put` by whoever holds Cloudflare credentials,
 * key rotation was manual, and nothing recorded who added a registration or when.
 * Migration 0480 moved them to a table with the signing key sealed in the
 * `credentialCrypto` envelope; this is the use case behind the screen.
 *
 * ── THE TOOL GENERATES THE KEY ───────────────────────────────────────────────
 * An administrator is never asked to paste a private key. `create` generates a
 * 2048-bit RSA pair in the Worker, seals the private half, stores the public half
 * in the clear, and returns only the public JWK and the tool's own URLs. A form
 * that accepts a private key is a form somebody eventually pastes one into a
 * support ticket.
 *
 * ── WHAT A READ RETURNS ──────────────────────────────────────────────────────
 * Never the private half, and never the ciphertext either. The list projection is
 * built by naming columns, not by spreading a row — a `SELECT *` here is one
 * refactor away from serving `tool_private_key_enc` to a screen.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { ltiRegistrations } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { credentialSecret, encryptCredentials } from '../integrations/credentialCrypto';
import type { Env } from '../../env';
import { invalidateRegistrations, publicHalfOf } from './LtiService';

export class LtiAdminError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'LtiAdminError';
  }
}

/** What a screen is allowed to see. No key material, no ciphertext. */
export interface LtiRegistrationView {
  id: number;
  label: string;
  issuer: string;
  clientId: string;
  deploymentIds: string[];
  authLoginUrl: string;
  accessTokenUrl: string;
  keySetUrl: string;
  toolKeyId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LtiRegistrationInput {
  label: string;
  issuer: string;
  clientId: string;
  deploymentIds: string[];
  authLoginUrl: string;
  accessTokenUrl: string;
  keySetUrl: string;
}

const RSA_PARAMS = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
} as const;

/** A URL an LMS will be redirected to, or refuse. `http` is rejected outright:
 *  an LTI login that leaves the browser over plaintext is a launch anybody on the
 *  path can read, and every real platform is https. */
function requireHttpsUrl(value: string, field: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new LtiAdminError(`${field} is not a URL. Copy it from the LMS's own tool-configuration screen.`, 400);
  }
  if (parsed.protocol !== 'https:') {
    throw new LtiAdminError(`${field} must be https. An LTI exchange over plaintext is readable by anybody on the path.`, 400);
  }
  return trimmed.slice(0, 2000);
}

function normalize(input: LtiRegistrationInput): LtiRegistrationInput {
  const label = input.label.trim().slice(0, 160);
  const issuer = input.issuer.trim().replace(/\/$/, '').slice(0, 255);
  const clientId = input.clientId.trim().slice(0, 255);
  if (!label) throw new LtiAdminError('Name the institution — it is how this registration is recognised later.', 400);
  if (!issuer) throw new LtiAdminError('The platform issuer is required. It is the `iss` the LMS signs its launches with.', 400);
  if (!clientId) throw new LtiAdminError('The client id the LMS issued for this tool is required.', 400);

  const deploymentIds = [...new Set(
    input.deploymentIds.map((id) => String(id).trim()).filter(Boolean).map((id) => id.slice(0, 255)),
  )].slice(0, 100);
  if (!deploymentIds.length) {
    throw new LtiAdminError(
      'At least one deployment id is required. One issuer hosts many institutions, so a registration with no deployment would accept launches from all of them.',
      400,
    );
  }

  return {
    label,
    issuer: requireHttpsUrl(issuer, 'The platform issuer'),
    clientId,
    deploymentIds,
    authLoginUrl: requireHttpsUrl(input.authLoginUrl, 'The authorization endpoint'),
    accessTokenUrl: requireHttpsUrl(input.accessTokenUrl, 'The token endpoint'),
    keySetUrl: requireHttpsUrl(input.keySetUrl, 'The platform JWKS endpoint'),
  };
}

const view = (row: {
  id: number; label: string; issuer: string; clientId: string; deploymentIds: unknown;
  authLoginUrl: string; accessTokenUrl: string; keySetUrl: string; toolKeyId: string;
  status: string; createdAt: Date; updatedAt: Date;
}): LtiRegistrationView => ({
  id: row.id,
  label: row.label,
  issuer: row.issuer,
  clientId: row.clientId,
  deploymentIds: Array.isArray(row.deploymentIds) ? row.deploymentIds as string[] : [],
  authLoginUrl: row.authLoginUrl,
  accessTokenUrl: row.accessTokenUrl,
  keySetUrl: row.keySetUrl,
  toolKeyId: row.toolKeyId,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Named columns, never a row spread — see the module note. */
const COLUMNS = {
  id: ltiRegistrations.id,
  label: ltiRegistrations.label,
  issuer: ltiRegistrations.issuer,
  clientId: ltiRegistrations.clientId,
  deploymentIds: ltiRegistrations.deploymentIds,
  authLoginUrl: ltiRegistrations.authLoginUrl,
  accessTokenUrl: ltiRegistrations.accessTokenUrl,
  keySetUrl: ltiRegistrations.keySetUrl,
  toolKeyId: ltiRegistrations.toolKeyId,
  status: ltiRegistrations.status,
  createdAt: ltiRegistrations.createdAt,
  updatedAt: ltiRegistrations.updatedAt,
} as const;

export async function listRegistrations(db: Db, tenantId: number): Promise<LtiRegistrationView[]> {
  const rows = await db
    .select(COLUMNS)
    .from(ltiRegistrations)
    .where(scopedToTenant(ltiRegistrations, tenantId))
    .orderBy(ltiRegistrations.label);
  return rows.map(view);
}

/**
 * Generate a signing key, seal it, and store the registration.
 *
 * The keypair is generated HERE and the private half never leaves this function
 * unsealed. `toolKeyId` is random rather than derived from the issuer: it is
 * published on `/api/lti/jwks`, and a key id that names the institution tells
 * every other institution who else is registered.
 */
export async function createRegistration(
  env: Env,
  db: Db,
  tenantId: number,
  input: LtiRegistrationInput,
  createdBy: string | null,
): Promise<{ registration: LtiRegistrationView; publicJwk: JsonWebKey }> {
  const clean = normalize(input);

  const [existing] = await db
    .select({ id: ltiRegistrations.id })
    .from(ltiRegistrations)
    .where(and(eq(ltiRegistrations.issuer, clean.issuer), eq(ltiRegistrations.clientId, clean.clientId)))
    .limit(1);
  if (existing) {
    throw new LtiAdminError('That issuer and client id are already registered. Edit the existing registration rather than adding a second one — the pair is its identity.', 409);
  }

  const pair = await crypto.subtle.generateKey(RSA_PARAMS, true, ['sign', 'verify']) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey;
  const toolKeyId = crypto.randomUUID();
  const publicJwk = publicHalfOf(await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey, toolKeyId);

  const sealed = await encryptCredentials({ jwk: privateJwk }, credentialSecret(env), tenantId);

  const [row] = await db
    .insert(ltiRegistrations)
    .values({
      tenantId,
      label: clean.label,
      issuer: clean.issuer,
      clientId: clean.clientId,
      deploymentIds: clean.deploymentIds,
      authLoginUrl: clean.authLoginUrl,
      accessTokenUrl: clean.accessTokenUrl,
      keySetUrl: clean.keySetUrl,
      toolKeyId,
      toolPublicJwk: publicJwk as unknown as Record<string, unknown>,
      toolPrivateKeyEnc: sealed.enc,
      toolPrivateKeyIv: sealed.iv,
      createdBy,
    })
    .returning(COLUMNS);
  if (!row) throw new LtiAdminError('The registration could not be saved.', 500);

  await invalidateRegistrations(env);
  return { registration: view(row), publicJwk };
}

/** Edit everything except the key. Issuer and client id are the identity and are
 *  deliberately editable — an LMS admin who typed one wrong should fix it rather
 *  than delete a registration and lose the audit of what it authorised. */
export async function updateRegistration(
  env: Env,
  db: Db,
  tenantId: number,
  id: number,
  input: LtiRegistrationInput,
): Promise<LtiRegistrationView> {
  const clean = normalize(input);
  const [row] = await db
    .update(ltiRegistrations)
    .set({
      label: clean.label,
      issuer: clean.issuer,
      clientId: clean.clientId,
      deploymentIds: clean.deploymentIds,
      authLoginUrl: clean.authLoginUrl,
      accessTokenUrl: clean.accessTokenUrl,
      keySetUrl: clean.keySetUrl,
      updatedAt: new Date(),
    })
    .where(scopedToTenant(ltiRegistrations, tenantId, eq(ltiRegistrations.id, id)))
    .returning(COLUMNS);
  if (!row) throw new LtiAdminError('That registration does not exist in this workspace.', 404);
  await invalidateRegistrations(env);
  return view(row);
}

/**
 * Rotate the signing key.
 *
 * The whole point of moving off the secret. Returns the new public JWK so the
 * screen can tell the administrator to re-fetch the tool's JWKS in their LMS —
 * platforms cache it, and a rotation nobody told them about surfaces as
 * `invalid_client` a day later with no further detail.
 */
export async function rotateRegistrationKey(
  env: Env,
  db: Db,
  tenantId: number,
  id: number,
): Promise<{ registration: LtiRegistrationView; publicJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(RSA_PARAMS, true, ['sign', 'verify']) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey;
  const toolKeyId = crypto.randomUUID();
  const publicJwk = publicHalfOf(await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey, toolKeyId);
  const sealed = await encryptCredentials({ jwk: privateJwk }, credentialSecret(env), tenantId);

  const [row] = await db
    .update(ltiRegistrations)
    .set({
      toolKeyId,
      toolPublicJwk: publicJwk as unknown as Record<string, unknown>,
      toolPrivateKeyEnc: sealed.enc,
      toolPrivateKeyIv: sealed.iv,
      updatedAt: new Date(),
    })
    .where(scopedToTenant(ltiRegistrations, tenantId, eq(ltiRegistrations.id, id)))
    .returning(COLUMNS);
  if (!row) throw new LtiAdminError('That registration does not exist in this workspace.', 404);
  await invalidateRegistrations(env);
  return { registration: view(row), publicJwk };
}

/**
 * Retire a registration.
 *
 * `status = 'disabled'` rather than DELETE: launches this registration authorised
 * are bound to boards through `lti_context_bindings`, and deleting the row would
 * cascade those bindings away — losing which LMS course a board belongs to in
 * order to stop new launches from it.
 */
export async function disableRegistration(
  env: Env,
  db: Db,
  tenantId: number,
  id: number,
): Promise<LtiRegistrationView> {
  const [row] = await db
    .update(ltiRegistrations)
    .set({ status: 'disabled', updatedAt: new Date() })
    .where(scopedToTenant(ltiRegistrations, tenantId, eq(ltiRegistrations.id, id)))
    .returning(COLUMNS);
  if (!row) throw new LtiAdminError('That registration does not exist in this workspace.', 404);
  await invalidateRegistrations(env);
  return view(row);
}

/** Bring a disabled registration back. Same reason `disable` is not a delete. */
export async function enableRegistration(
  env: Env,
  db: Db,
  tenantId: number,
  id: number,
): Promise<LtiRegistrationView> {
  const [row] = await db
    .update(ltiRegistrations)
    .set({ status: 'active', updatedAt: new Date() })
    .where(scopedToTenant(ltiRegistrations, tenantId, eq(ltiRegistrations.id, id)))
    .returning(COLUMNS);
  if (!row) throw new LtiAdminError('That registration does not exist in this workspace.', 404);
  await invalidateRegistrations(env);
  return view(row);
}
