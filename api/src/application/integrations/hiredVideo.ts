/**
 * hired.video provider seam.
 *
 * Wraps the official partner SDK (`@seanhogg/hired-video-sdk`, v0.2.x) so the rest
 * of the app depends on a small, stable surface. Every call is gated on
 * `HIRED_API_KEY`: when the key is absent the provider reports `configured=false`
 * and callers fall back to the NATIVE résumé path (R2 upload) — the freelance
 * marketplace keeps working, it just doesn't sync to hired.video.
 *
 * Notes on the live SDK contract:
 *  - `create` is idempotent on `externalUserId` (returns `alreadyExisted`).
 *  - `uploadResume` parses TEXT/JSON only; binary PDF/DOC/DOCX are rejected
 *    (`UNSUPPORTED_MEDIA_TYPE`) — callers must extract text first (we send
 *    `rawText` for text résumés and skip the call for binaries).
 *  - `getProfile` returns a typed `profile` extract (skills/experience) we use to
 *    prefill the freelancer's skills, plus a `resumeStatus`.
 *  - `getByExternalUserId` reconciles our user id → the hired.video account, so an
 *    account provisioned before the key was configured can be linked later.
 */
import { HiredClient, HiredApiError, type ProfilePayload } from '@seanhogg/hired-video-sdk';
import type { Env } from '../../env';

type HiredEnv = Pick<Env, 'HIRED_API_KEY' | 'HIRED_API_BASE_URL'>;

export function isHiredConfigured(env: HiredEnv): boolean {
  return typeof env.HIRED_API_KEY === 'string' && env.HIRED_API_KEY.length > 0;
}

/** Construct a client, or null when unconfigured (no key = native path). */
function client(env: HiredEnv): HiredClient | null {
  if (!isHiredConfigured(env)) return null;
  return new HiredClient({ apiKey: env.HIRED_API_KEY as string, baseUrl: env.HIRED_API_BASE_URL });
}

/** Log a hired.video failure without leaking it to the caller (native fallback). */
function warn(op: string, err: unknown): void {
  const code = HiredApiError.is(err) ? ` [${err.code}]` : '';
  console.warn(`[hiredVideo] ${op} failed${code}:`, (err as Error)?.message);
}

export interface ProvisionResult {
  configured: boolean;
  hiredVideoUserId?: string;
  connectionId?: string;
  claimUrl?: string;
  resumeId?: string;
  /** True when the account already existed (idempotent no-op). */
  alreadyExisted?: boolean;
}

/**
 * Provision (or find) a hired.video job-seeker for a freelancer. Idempotent — a
 * repeat call for the same externalUserId returns the existing account. Never
 * throws: a hired.video outage/misconfig returns `{ configured }` so registration
 * still succeeds on the native path.
 */
export async function provisionJobSeeker(
  env: HiredEnv,
  input: { email: string; name?: string; externalUserId: string; resumeText?: string },
): Promise<ProvisionResult> {
  const hired = client(env);
  if (!hired) return { configured: false };
  try {
    const created = await hired.jobSeekers.create({
      email: input.email,
      name: input.name || input.email.split('@')[0] || input.email,
      externalUserId: input.externalUserId,
      resume: input.resumeText ? { rawText: input.resumeText } : undefined,
    });
    return {
      configured: true,
      hiredVideoUserId: created.userId,
      connectionId: created.connectionId,
      claimUrl: created.claimUrl,
      resumeId: created.resumeId ?? undefined,
      alreadyExisted: created.alreadyExisted,
    };
  } catch (err) {
    // A duplicate hit is a success — reconcile to the existing account.
    if (HiredApiError.is(err) && err.isAlreadyExists) {
      const ref = await getByExternalUserId(env, input.externalUserId);
      if (ref.ref) return { configured: true, hiredVideoUserId: ref.ref.userId, connectionId: ref.ref.connectionId, alreadyExisted: true };
    }
    warn('provisionJobSeeker', err);
    return { configured: true };
  }
}

/** Reconcile our own user id → the hired.video account (find-or-reconcile). */
export async function getByExternalUserId(
  env: HiredEnv,
  externalUserId: string,
): Promise<{ configured: boolean; ref?: { userId: string; connectionId: string; status: string } }> {
  const hired = client(env);
  if (!hired) return { configured: false };
  try {
    const ref = await hired.jobSeekers.getByExternalUserId(externalUserId);
    return { configured: true, ref: { userId: ref.userId, connectionId: ref.connectionId, status: ref.status } };
  } catch (err) {
    if (!(HiredApiError.is(err) && err.code === 'NOT_FOUND')) warn('getByExternalUserId', err);
    return { configured: true };
  }
}

/** Upload/replace a résumé. TEXT ONLY — binary must be extracted first (the caller
 *  passes `rawText`; a call without it is skipped to avoid a guaranteed 415). */
export async function uploadResume(
  env: HiredEnv,
  hiredVideoUserId: string,
  input: { title?: string; rawText?: string },
): Promise<{ configured: boolean; resumeId?: string }> {
  const hired = client(env);
  if (!hired) return { configured: false };
  if (!input.rawText) return { configured: true }; // binary résumé: hired.video can't parse it
  try {
    const res = await hired.jobSeekers.uploadResume(hiredVideoUserId, { title: input.title, rawText: input.rawText });
    const resumeId = (res.resumeId ?? res.id) as string | undefined;
    return { configured: true, resumeId };
  } catch (err) {
    warn('uploadResume', err);
    return { configured: true };
  }
}

/** Typed extract from the active résumé — skills/summary + résumé status. */
export interface ProfileExtract {
  skills: string[];
  headline: string | null;
  summary: string | null;
  resumeStatus: 'ready' | 'parsing' | 'none';
  updatedAt: string | null;
  raw: ProfilePayload;
}

/** Fetch the live profile + a typed extract for skill-prefill / display. */
export async function getProfile(
  env: HiredEnv,
  hiredVideoUserId: string,
): Promise<{ configured: boolean; extract?: ProfileExtract }> {
  const hired = client(env);
  if (!hired) return { configured: false };
  try {
    const p = await hired.jobSeekers.getProfile(hiredVideoUserId);
    return {
      configured: true,
      extract: {
        skills: p.profile.skills ?? [],
        headline: p.profile.headline,
        summary: p.profile.summary,
        resumeStatus: p.resumeStatus,
        updatedAt: p.updatedAt,
        raw: p,
      },
    };
  } catch (err) {
    warn('getProfile', err);
    return { configured: true };
  }
}

/** Mint a short-lived (15 min) embed URL for the profile/résumé viewer. */
export async function createEmbedToken(
  env: HiredEnv,
  hiredVideoUserId: string,
  kind: 'profile' | 'resume' = 'profile',
  opts: { theme?: 'auto' | 'light' | 'dark'; locale?: string } = {},
): Promise<{ configured: boolean; embedUrl?: string; expiresAt?: string }> {
  const hired = client(env);
  if (!hired) return { configured: false };
  try {
    const tok = await hired.createEmbedToken({ userId: hiredVideoUserId, kind, theme: opts.theme, locale: opts.locale });
    return { configured: true, embedUrl: tok.embedUrl ?? undefined, expiresAt: tok.expiresAt };
  } catch (err) {
    warn('createEmbedToken', err);
    return { configured: true };
  }
}

/** Start the consent flow to CONNECT an existing hired.video account. */
export async function connectExisting(
  env: HiredEnv,
  input: { email: string; externalUserId: string; redirectUrl?: string },
): Promise<{ configured: boolean; consentUrl?: string }> {
  const hired = client(env);
  if (!hired) return { configured: false };
  try {
    const { consentUrl } = await hired.connect(input);
    return { configured: true, consentUrl };
  } catch (err) {
    warn('connect', err);
    return { configured: true };
  }
}
