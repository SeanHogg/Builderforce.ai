/**
 * The page-review runner's capability tokens (PRD 33 §5.2) — mirrors the MP4 export's
 * (`replayVideoExport.mintExportToken`): an opaque JWT per JOB naming exactly what the
 * runner may write, with a one-hour expiry, and NO `tid`/`sub` so the platform's user
 * auth rejects it everywhere else.
 *
 *   capture  tenant, site, path, release, device — the one capture row it may write
 *   render   tenant, site, prescription          — the one fix whose after-render it may store
 */

import type { ReplayCaptureDevice } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import { signOpaqueJwt, verifyOpaqueJwt } from '../../infrastructure/auth/JwtService';
import { UnauthorizedError } from '../../domain/shared/errors';

const TOKEN_TTL_SECONDS = 60 * 60;
export const PAGE_CAPTURE_TOKEN_TYPE = 'replay-page-capture';
export const PAGE_RENDER_TOKEN_TYPE = 'replay-page-render';

/** Where the runner callbacks are mounted (under `/api/replay`). */
export const PAGE_RUNNER_PREFIX = '/api/replay/page-runner';

export interface CaptureClaims {
  typ: typeof PAGE_CAPTURE_TOKEN_TYPE;
  /** Tenant — NOT `tid`, so the user auth middleware never accepts this token. */
  xt: number;
  sid: string;
  p: string;
  rk: string;
  dc: ReplayCaptureDevice;
  exp: number;
}

export interface RenderClaims {
  typ: typeof PAGE_RENDER_TOKEN_TYPE;
  xt: number;
  sid: string;
  pid: string;
  exp: number;
}

const expiry = (now: Date) => Math.floor(now.getTime() / 1000) + TOKEN_TTL_SECONDS;

export function mintCaptureToken(
  env: Env,
  input: { tenantId: number; siteId: string; path: string; releaseKey: string; device: ReplayCaptureDevice },
  now: Date = new Date(),
): Promise<string> {
  const claims: CaptureClaims = { typ: PAGE_CAPTURE_TOKEN_TYPE, xt: input.tenantId, sid: input.siteId, p: input.path, rk: input.releaseKey, dc: input.device, exp: expiry(now) };
  return signOpaqueJwt({ ...claims }, env.JWT_SECRET);
}

export function mintRenderToken(env: Env, input: { tenantId: number; siteId: string; prescriptionId: string }, now: Date = new Date()): Promise<string> {
  const claims: RenderClaims = { typ: PAGE_RENDER_TOKEN_TYPE, xt: input.tenantId, sid: input.siteId, pid: input.prescriptionId, exp: expiry(now) };
  return signOpaqueJwt({ ...claims }, env.JWT_SECRET);
}

async function verify<T extends { typ: string; exp: number }>(env: Env, authorization: string | undefined, typ: T['typ']): Promise<T> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) throw new UnauthorizedError('Missing runner token');
  let claims: T;
  try {
    claims = await verifyOpaqueJwt<T>(token, env.JWT_SECRET);
  } catch {
    throw new UnauthorizedError('Invalid or expired runner token');
  }
  if (claims.typ !== typ) throw new UnauthorizedError('Runner token is not for this job');
  return claims;
}

export async function verifyCaptureToken(env: Env, authorization: string | undefined): Promise<CaptureClaims> {
  const claims = await verify<CaptureClaims>(env, authorization, PAGE_CAPTURE_TOKEN_TYPE);
  if (!Number.isInteger(claims.xt) || typeof claims.sid !== 'string' || typeof claims.p !== 'string' || typeof claims.rk !== 'string'
    || (claims.dc !== 'desktop' && claims.dc !== 'phone')) {
    throw new UnauthorizedError('Runner token is malformed');
  }
  return claims;
}

/** The render token, which must name exactly `prescriptionId`. */
export async function verifyRenderToken(env: Env, authorization: string | undefined, prescriptionId: string): Promise<RenderClaims> {
  const claims = await verify<RenderClaims>(env, authorization, PAGE_RENDER_TOKEN_TYPE);
  if (!Number.isInteger(claims.xt) || typeof claims.sid !== 'string' || claims.pid !== prescriptionId) {
    throw new UnauthorizedError('Runner token does not match this fix');
  }
  return claims;
}
