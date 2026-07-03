/**
 * hired.video provider seam.
 *
 * Wraps the official partner SDK (`@seanhogg/hired-video-sdk`) so the rest of the
 * app depends on a small, stable surface instead of the SDK directly. Every call
 * is gated on `HIRED_API_KEY`: when the key is absent the provider reports
 * `configured=false` and callers fall back to the NATIVE resume path (R2 upload)
 * — the freelance marketplace keeps working, it just doesn't sync to hired.video.
 *
 * The SDK is imported lazily (dynamic import) so a missing/unbuilt dependency can
 * never take the Worker bundle down at module-eval time — an unconfigured or
 * unavailable hired.video degrades to the native path at the call site.
 */
import type { Env } from '../../env';

// ---- Minimal local mirror of the SDK surface we use (avoids a hard type dep) --
interface HiredClientOpts { apiKey: string; baseUrl?: string }
interface JobSeekerCreateInput {
  email: string;
  name?: string;
  externalUserId?: string;
  resume?: { rawText?: string; content?: unknown };
}
interface JobSeekerCreated {
  userId: string;
  connectionId?: string;
  status?: string;
  claimUrl?: string;
  resumeId?: string;
}
interface EmbedTokenInput { userId: string; kind: 'profile' | 'resume' }
interface HiredClientLike {
  me(): Promise<unknown>;
  jobSeekers: {
    create(input: JobSeekerCreateInput): Promise<JobSeekerCreated>;
    uploadResume(userId: string, input: { title?: string; rawText?: string; content?: unknown }): Promise<{ resumeId: string }>;
    getProfile(userId: string): Promise<unknown>;
  };
  connect(input: { email: string; externalUserId?: string; redirectUrl?: string }): Promise<{ consentUrl: string }>;
  connections: { list(): Promise<unknown>; revoke(userId: string): Promise<unknown> };
  createEmbedToken(input: EmbedTokenInput): Promise<{ embedUrl: string }>;
}

export function isHiredConfigured(env: Pick<Env, 'HIRED_API_KEY'>): boolean {
  return typeof env.HIRED_API_KEY === 'string' && env.HIRED_API_KEY.length > 0;
}

/** Lazily construct a client, or null when unconfigured. */
async function getClient(env: Pick<Env, 'HIRED_API_KEY' | 'HIRED_API_BASE_URL'>): Promise<HiredClientLike | null> {
  if (!isHiredConfigured(env)) return null;
  // Dynamic import keeps a missing/uninstalled SDK from breaking the bundle eval.
  // @ts-ignore optional partner SDK — its types resolve once `pnpm install` runs.
  const mod = (await import('@seanhogg/hired-video-sdk')) as unknown as {
    HiredClient: new (opts: HiredClientOpts) => HiredClientLike;
  };
  const opts: HiredClientOpts = { apiKey: env.HIRED_API_KEY as string };
  if (env.HIRED_API_BASE_URL) opts.baseUrl = env.HIRED_API_BASE_URL;
  return new mod.HiredClient(opts);
}

export interface ProvisionResult {
  configured: boolean;
  hiredVideoUserId?: string;
  connectionId?: string;
  claimUrl?: string;
  resumeId?: string;
}

/**
 * Provision (or find) a hired.video job-seeker account for a freelancer. Called on
 * freelancer registration and when a resume is first uploaded. Never throws to the
 * caller — a hired.video outage/misconfig returns `{ configured }` so registration
 * still succeeds on the native path.
 */
export async function provisionJobSeeker(
  env: Pick<Env, 'HIRED_API_KEY' | 'HIRED_API_BASE_URL'>,
  input: { email: string; name?: string; externalUserId: string; resumeText?: string },
): Promise<ProvisionResult> {
  const client = await getClient(env);
  if (!client) return { configured: false };
  try {
    const created = await client.jobSeekers.create({
      email: input.email,
      name: input.name,
      externalUserId: input.externalUserId,
      resume: input.resumeText ? { rawText: input.resumeText } : undefined,
    });
    return {
      configured: true,
      hiredVideoUserId: created.userId,
      connectionId: created.connectionId,
      claimUrl: created.claimUrl,
      resumeId: created.resumeId,
    };
  } catch (err) {
    console.warn('[hiredVideo] provisionJobSeeker failed:', (err as Error)?.message);
    return { configured: true };
  }
}

/** Upload/replace a resume for an already-provisioned hired.video user. */
export async function uploadResume(
  env: Pick<Env, 'HIRED_API_KEY' | 'HIRED_API_BASE_URL'>,
  hiredVideoUserId: string,
  input: { title?: string; rawText?: string },
): Promise<{ configured: boolean; resumeId?: string }> {
  const client = await getClient(env);
  if (!client) return { configured: false };
  try {
    const res = await client.jobSeekers.uploadResume(hiredVideoUserId, { title: input.title, rawText: input.rawText });
    return { configured: true, resumeId: res.resumeId };
  } catch (err) {
    console.warn('[hiredVideo] uploadResume failed:', (err as Error)?.message);
    return { configured: true };
  }
}

/** Fetch the live profile + active resume (skills/experience) for prefill/display. */
export async function getProfile(
  env: Pick<Env, 'HIRED_API_KEY' | 'HIRED_API_BASE_URL'>,
  hiredVideoUserId: string,
): Promise<{ configured: boolean; profile?: unknown }> {
  const client = await getClient(env);
  if (!client) return { configured: false };
  try {
    const profile = await client.jobSeekers.getProfile(hiredVideoUserId);
    return { configured: true, profile };
  } catch (err) {
    console.warn('[hiredVideo] getProfile failed:', (err as Error)?.message);
    return { configured: true };
  }
}

/** Mint a short-lived embed URL for the embedded profile/resume viewer. */
export async function createEmbedToken(
  env: Pick<Env, 'HIRED_API_KEY' | 'HIRED_API_BASE_URL'>,
  hiredVideoUserId: string,
  kind: 'profile' | 'resume' = 'profile',
): Promise<{ configured: boolean; embedUrl?: string }> {
  const client = await getClient(env);
  if (!client) return { configured: false };
  try {
    const { embedUrl } = await client.createEmbedToken({ userId: hiredVideoUserId, kind });
    return { configured: true, embedUrl };
  } catch (err) {
    console.warn('[hiredVideo] createEmbedToken failed:', (err as Error)?.message);
    return { configured: true };
  }
}

/** Start the consent flow to CONNECT an existing hired.video account. */
export async function connectExisting(
  env: Pick<Env, 'HIRED_API_KEY' | 'HIRED_API_BASE_URL'>,
  input: { email: string; externalUserId: string; redirectUrl?: string },
): Promise<{ configured: boolean; consentUrl?: string }> {
  const client = await getClient(env);
  if (!client) return { configured: false };
  try {
    const { consentUrl } = await client.connect(input);
    return { configured: true, consentUrl };
  } catch (err) {
    console.warn('[hiredVideo] connect failed:', (err as Error)?.message);
    return { configured: true };
  }
}
