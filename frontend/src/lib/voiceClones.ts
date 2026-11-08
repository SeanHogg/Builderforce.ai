/**
 * Voice-clone CRUD client (Voice PRD #1994 frontend seam).
 *
 * Covers create / list / delete of clones — the bits the
 * @seanhogg/builderforce-voice package does NOT own. Synthesis goes through that
 * package's `VoiceClient` seam (see voiceEngine.ts), so there is exactly one
 * synthesis path (on-device → server) and the frontend never re-implements it.
 * Reuses the shared auth/base-URL helpers in apiClient (no token re-derivation).
 */

import { apiRequest } from './apiClient';

export interface VoiceClone {
  id: number;
  name: string;
  description: string | null;
  provider: string;
  visibility: 'private' | 'unlisted' | 'marketplace';
  status: 'draft' | 'ready' | 'published';
  priceMillicents: number;
  consentAttested: boolean;
  hasReference: boolean;
  /** The Voice IDE project this clone belongs to (0224), or null = tenant-wide. */
  ideProjectId: number | null;
  createdAt: string;
}

const BASE = '/api/studio/voice-clones';

/** Clones the caller owns or has licensed. Pass `ideProjectId` to scope to one
 *  Voice IDE project (its custom voices). */
export async function listVoiceClones(ideProjectId?: number): Promise<VoiceClone[]> {
  const qs = ideProjectId != null ? `?ideProjectId=${ideProjectId}` : '';
  const res = await apiRequest<{ clones: VoiceClone[] }>(`${BASE}${qs}`);
  return res.clones ?? [];
}

/** Published voices in the marketplace (the public, no-leak projection). */
export async function listMarketplaceVoices(): Promise<VoiceClone[]> {
  const res = await apiRequest<{ clones: VoiceClone[] }>(`${BASE}/marketplace`);
  return res.clones ?? [];
}

/** Acquire a marketplace voice. A FREE one is licensed at once (`{ licensed: true }`);
 *  a PRICED one answers with the platform's hosted `checkoutUrl` to pay at. `returnUrl`
 *  is where the processor sends the buyer back (its `?checkout=…&voice=…` is appended). */
export async function acquireMarketplaceVoice(
  cloneId: number,
  returnUrl: string,
): Promise<{ licensed: true } | { checkoutUrl: string } | { status: 'revoked' }> {
  const res = await orRevoked(() =>
    apiRequest<{ checkoutUrl?: string }>(`${BASE}/marketplace/${cloneId}/license`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnUrl }),
      expectedErrors: [409],
    }),
  );
  if (res && 'status' in res) return res;
  return res?.checkoutUrl ? { checkoutUrl: res.checkoutUrl } : { licensed: true };
}

/** 409 `license_revoked` = the buyer's licence was revoked (refund/dispute): a terminal state, not a failure to retry. */
async function orRevoked<T>(call: () => Promise<T>): Promise<T | { status: 'revoked' }> {
  try {
    return await call();
  } catch (e) {
    if ((e as { status?: number } | null)?.status === 409) return { status: 'revoked' };
    throw e;
  }
}

/** Finish a paid acquisition after the processor's redirect; the server re-reads the session. */
export async function completeMarketplaceVoiceCheckout(
  cloneId: number,
  checkoutSessionId: string,
): Promise<{ status: 'purchased' } | { status: 'revoked' }> {
  return orRevoked(async () => {
    await apiRequest(`${BASE}/marketplace/${cloneId}/checkout/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkoutSessionId }),
      expectedErrors: [409],
      raw: true,
    });
    return { status: 'purchased' as const };
  });
}

/** Create (enrol) a clone. `consentAttested` MUST be true (server gates on it).
 *  `reference` is the voice sample (server path); `embedding` is the optional
 *  on-device identity captured client-side. */
export async function createVoiceClone(input: {
  name: string;
  description?: string;
  consentAttested: boolean;
  reference?: File | null;
  embedding?: number[] | null;
  /** Sample rate the embedding was enrolled at (sealed with it server-side). */
  embeddingSampleRate?: number | null;
  visibility?: VoiceClone['visibility'];
  provider?: string;
  /** Bind the clone to a Voice IDE project (0224). */
  ideProjectId?: number | null;
}): Promise<VoiceClone> {
  const form = new FormData();
  form.append('name', input.name);
  form.append('consentAttested', String(input.consentAttested));
  if (input.ideProjectId != null) form.append('ideProjectId', String(input.ideProjectId));
  if (input.description) form.append('description', input.description);
  if (input.visibility) form.append('visibility', input.visibility);
  if (input.provider) form.append('provider', input.provider);
  if (input.embedding) form.append('embedding', JSON.stringify(input.embedding));
  if (input.embedding && input.embeddingSampleRate) form.append('embeddingSampleRate', String(input.embeddingSampleRate));
  if (input.reference) form.append('reference', input.reference, input.reference.name);

  // apiRequest leaves Content-Type unset for FormData so the multipart boundary
  // survives — no header surgery needed.
  return apiRequest<VoiceClone>(BASE, { method: 'POST', body: form });
}

export async function deleteVoiceClone(cloneId: number): Promise<void> {
  await apiRequest(`${BASE}/${cloneId}`, { method: 'DELETE', raw: true });
}

/** The owner's own speaker embedding (owner-only; 403/404 for anyone else or when
 *  none is stored). Returns null on those expected refusals. */
export async function fetchCloneEmbedding(
  cloneId: number,
): Promise<{ embedding: number[]; sampleRate: number | null } | null> {
  try {
    const res = await apiRequest<{ embedding: number[]; sampleRate: number | null }>(
      `${BASE}/${cloneId}/embedding`,
      { expectedErrors: [403, 404] },
    );
    return Array.isArray(res.embedding) ? { embedding: res.embedding, sampleRate: res.sampleRate ?? null } : null;
  } catch {
    return null;
  }
}

/** Upload a locally-held embedding when the server lacks one (owner-only).
 *  'done' = the server holds it now; 'refused' = the clone is gone (404 —
 *  nothing worth keeping); 'forbidden' = 403, not this user's clone (keep the local
 *  copy: it may be another account's only one); 'retry' = transient failure, keep the local copy. */
export async function uploadCloneEmbedding(
  cloneId: number,
  embedding: number[],
  sampleRate: number | null,
): Promise<'done' | 'refused' | 'forbidden' | 'retry'> {
  try {
    await apiRequest(`${BASE}/${cloneId}/embedding`, {
      method: 'PUT',
      body: JSON.stringify({ embedding, sampleRate }),
      headers: { 'Content-Type': 'application/json' },
      expectedErrors: [403, 404],
      raw: true,
    });
    return 'done';
  } catch (e) {
    const status = (e as { status?: number } | null)?.status;
    if (status === 404) return 'refused';
    // 403 = not this user's clone: another account's only copy may be this key.
    return status === 403 ? 'forbidden' : 'retry';
  }
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? null;
  } catch {
    return null;
  }
}
