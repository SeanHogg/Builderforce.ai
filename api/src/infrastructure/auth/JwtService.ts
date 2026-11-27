import { decodeJwtPayload, signHs256, tryDecodeJwtPayload, verifyHs256 } from '@builderforce/hs256-jwt';
import { TenantRole } from '../../domain/shared/types';
import type { DeviceClient } from '@builderforce/creation-canvas-contract';

export { decodeJwtPayload };

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface JwtPayload {
  sub:  string;       // userId
  tid:  number;       // tenantId
  role: TenantRole;
  sv?:  number;       // session_version — for fast force-logout without a blocklist
  jti?: string;
  sid?: string;
  // Federated-tenancy claims (present on tokens for 'segmented' tenants whose
  // IdP is an external host, e.g. BurnRateOS). resolveSegment() maps these to a
  // Segment. Absent on 'single'/direct tenants → default segment is used.
  acct?: string;      // external account id (host coordinate)
  co?:   string;      // external company id (host coordinate)
  /**
   * The CLOUD AGENT this token acts as (`ide_agents.id` / published agent ref).
   *
   * Minted only for the in-process route replay a cloud agent's platform-tool call
   * performs — never for a person's session. It rides inside the SIGNED payload rather
   * than a header precisely because it confers identity: an authorship claim a client
   * could set for itself would be worthless.
   *
   * Without it an agent's platform-tool write authenticated with the agent ref sitting
   * in `sub`, which every consumer reads as a user id — so an agent that moved a ticket
   * through `update_task` was recorded as a person whose id nobody could resolve.
   */
  agt?: string;
  /** Trusted client surface — the device-flow app the session was minted for
   * (`DEVICE_CLIENTS`). Minted by the server; never inferred from a request header
   * because it controls kill-switch exemptions. */
  src?: DeviceClient;
  /**
   * The `tenant_api_keys.id` this session was exchanged from. Set only on editor sessions
   * minted from a `bfk_*` key (and carried forward by a workspace re-scope), so a route can
   * check what THAT KEY may do - e.g. whether it may act in another workspace. Absent on web
   * sessions and every other minter.
   */
  kid?: string;
  iat:  number;
  exp:  number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireSecret(secret: string): string {
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    throw new Error(
      'JWT_SECRET is not set. Set it with: wrangler secret put JWT_SECRET (in the api/ directory), or add JWT_SECRET to api/.env and run npm run secrets:from-env'
    );
  }
  return secret;
}

const FAILURE_MESSAGE = {
  malformed: 'Malformed token',
  bad_signature: 'Invalid token signature',
  expired: 'Token expired',
  not_yet_valid: 'Token not yet valid',
} as const;

const REJECTIONS: ReadonlySet<string> = new Set(Object.values(FAILURE_MESSAGE));

/** Did a verify throw because the TOKEN was refused — as opposed to a server fault (no secret)? */
export function isTokenRejection(error: unknown): boolean {
  return error instanceof Error && REJECTIONS.has(error.message);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * SIGN ANY CLAIM SET — the HS256 machine, written once.
 *
 * This file used to hold three byte-identical copies of the four lines below
 * (session, web, emulation), and a fourth token type — the install-scoped token a
 * marketplace vendor calls us with (PRD 24 §5.3) — would have made four. A
 * duplicated signer is not merely untidy: it is four places a `typ` header, an
 * algorithm confusion check or a clock-skew tolerance has to be fixed, and the one
 * that is missed keeps accepting what the others have learned to refuse.
 *
 * The claim TYPES stay separate and stay specific, because what a token asserts is
 * the domain's business. Only the crypto is shared.
 */
function signClaims(claims: Record<string, unknown>, secret: string): Promise<string> {
  return signHs256(claims, requireSecret(secret));
}

/**
 * Verify a signature and expiry, and hand back the claims.
 *
 * The signature is checked BEFORE the body is parsed, which is the ordering that
 * matters: a verifier that reads claims first has already acted on attacker-
 * controlled JSON by the time it decides the token was forged.
 */
async function verifyClaims<T extends { exp: number }>(
  token: string,
  secret: string,
  options?: { nowSeconds?: number },
): Promise<T> {
  const verdict = await verifyHs256<T>(token, requireSecret(secret), options);
  if (!verdict.ok) throw new Error(FAILURE_MESSAGE[verdict.reason]);
  return verdict.claims;
}

/** Sign a claim set that is not one of this file's own token types. */
export async function signOpaqueJwt(claims: Record<string, unknown>, secret: string): Promise<string> {
  return signClaims(claims, secret);
}

/** Verify a claim set signed by {@link signOpaqueJwt}. Signature and expiry only —
 *  every claim inside is the caller's to check. */
export async function verifyOpaqueJwt<T extends { exp: number }>(token: string, secret: string): Promise<T> {
  return verifyClaims<T>(token, secret);
}

/**
 * Signs a JWT using HMAC-SHA-256 via the Web Crypto API.
 * Compatible with Cloudflare Workers (no Node.js required).
 */
export async function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = {
    ...payload,
    jti: payload.jti ?? crypto.randomUUID(),
    sid: payload.sid,
    iat: now,
    exp: now + expiresInSeconds,
  };
  return signClaims(full as unknown as Record<string, unknown>, secret);
}

/**
 * Verifies and decodes a JWT.
 * Throws if the signature is invalid or the token is expired.
 */
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload> {
  return verifyClaims<JwtPayload>(token, secret);
}

// ---------------------------------------------------------------------------
// Web / Marketplace JWT  (no tenant / role required)
// ---------------------------------------------------------------------------

export interface WebJwtPayload {
  sub:      string;   // userId
  email:    string;
  username: string;
  sa?:      boolean;  // true only for superadmins
  act?:     string;   // account_type ('freelancer' | 'standard'); omitted for standard
  jti?:     string;
  sid?:     string;
  mfa?:     boolean;
  mfaPending?: boolean;
  amr?:     string[];
  /** Session start (unix seconds) — fixed for the life of a session, carried across renewals. */
  sat?:     number;
  /** The session's maximum age in seconds, counted from `sat`. */
  sma?:     number;
  iat:      number;
  exp:      number;
}

/** How long one web access token is valid. Renewed in the background before it lapses. */
export const WEB_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Sign a web session token.
 *
 * `sessionMaxAgeSeconds` is the length of the SESSION (24 h, or 30 days for a trusted
 * device), not of this token: the token itself lives {@link WEB_ACCESS_TOKEN_TTL_SECONDS}
 * and never past the session's end. A renewal passes the original `sat`/`sma` in the
 * payload so the session end never moves. A pending-MFA token is a one-step challenge
 * and keeps its own short lifetime.
 *
 * `options.nowSeconds` fixes `iat`: a renewal that hands back an already-issued
 * successor re-signs it at its original issue time, so it is the same token.
 */
export async function signWebJwt(
  payload:                Omit<WebJwtPayload, 'iat' | 'exp'>,
  secret:                 string,
  sessionMaxAgeSeconds:   number = 86_400, // 24 hours for web sessions
  options?:               { nowSeconds?: number },
): Promise<string> {
  const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  let session: { sat?: number; sma?: number; exp: number };
  if (payload.mfaPending) {
    session = { exp: now + sessionMaxAgeSeconds };
  } else {
    const sat = payload.sat ?? now;
    const sma = payload.sma ?? sessionMaxAgeSeconds;
    session = { sat, sma, exp: Math.min(now + WEB_ACCESS_TOKEN_TTL_SECONDS, sat + sma) };
  }
  const full: WebJwtPayload = {
    ...payload,
    sat: session.sat,
    sma: session.sma,
    jti: payload.jti ?? crypto.randomUUID(),
    sid: payload.sid ?? (payload.mfaPending ? undefined : crypto.randomUUID()),
    iat: now,
    exp: session.exp,
  };

  return signClaims(full as unknown as Record<string, unknown>, secret);
}

/**
 * Verify a web token. `options.ignoreExpiry` checks the signature and shape only —
 * for renewal, where the gate is the session's maximum age (`sat + sma`) and the
 * token's ledger row, not the access token's own `exp`. The token's own `iat` is the
 * clock for the time checks; the signature is checked first either way, and a forged
 * `iat` fails it.
 */
export async function verifyWebJwt(
  token: string,
  secret: string,
  options?: { ignoreExpiry?: boolean },
): Promise<WebJwtPayload> {
  if (!options?.ignoreExpiry) return verifyClaims<WebJwtPayload>(token, secret);
  const iat = tryDecodeJwtPayload<{ iat?: unknown }>(token)?.iat;
  if (typeof iat !== 'number') throw new Error(FAILURE_MESSAGE.malformed);
  return verifyClaims<WebJwtPayload>(token, secret, { nowSeconds: iat });
}

/**
 * The `auth_tokens.expires_at` a web token's ledger row carries: the end of its
 * SESSION (`sat + sma`) when the token names one, so a renewable token's row is not
 * swept while the session may still be renewed (a device asleep for days); the
 * token's own `exp` otherwise (pending-MFA, tenant and pre-renewal tokens).
 */
export function authTokenRowExpiresAt(claims: { exp: number; sat?: number; sma?: number }): Date {
  const end = typeof claims.sat === 'number' && typeof claims.sma === 'number' ? claims.sat + claims.sma : claims.exp;
  return new Date(end * 1000);
}

// ---------------------------------------------------------------------------
// Emulation JWT  (Super Admin impersonation)
// ---------------------------------------------------------------------------

/**
 * Extended payload for Super Admin impersonation tokens.
 * Carries the standard tenant fields plus emulation metadata.
 * `emu_readonly: true` causes API middleware to reject all mutating verbs.
 */
export interface EmulationJwtPayload extends JwtPayload {
  emu:         true;
  emu_by:      string;  // superadmin userId who started the session
  emu_sid:     string;  // adminImpersonationSessions.id
  emu_readonly: true;
}

/**
 * Signs a 1-hour, read-only emulation token for a target user/tenant/role.
 * The resulting JWT must travel via `X-Emulation-Token`; it is rejected by
 * all `/api/admin/*` routes and all mutating verbs.
 */
export async function signEmulationJwt(
  payload: {
    sub:     string;   // target userId
    tid:     number;   // tenantId
    role:    TenantRole;
    emuBy:   string;   // superadmin userId
    emuSid:  string;   // impersonation session id
  },
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const full: EmulationJwtPayload = {
    sub:          payload.sub,
    tid:          payload.tid,
    role:         payload.role,
    emu:          true,
    emu_by:       payload.emuBy,
    emu_sid:      payload.emuSid,
    emu_readonly: true,
    jti,
    iat:          now,
    exp:          now + 3600,  // 1 hour, non-renewable
  };

  return signClaims(full as unknown as Record<string, unknown>, secret);
}

/**
 * Verifies and decodes an emulation JWT.
 * Throws if invalid, expired, or not an emulation token.
 */
export async function verifyEmulationJwt(
  token: string,
  secret: string,
): Promise<EmulationJwtPayload> {
  const payload = await verifyJwt(token, secret) as EmulationJwtPayload;
  if (!payload.emu) throw new Error('Not an emulation token');
  return payload;
}
