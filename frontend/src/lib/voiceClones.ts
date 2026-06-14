/**
 * Voice-clone CRUD client (Voice PRD #1994 frontend seam).
 *
 * Covers create / list / delete of clones — the bits the
 * @seanhogg/builderforce-voice package does NOT own. Synthesis goes through that
 * package's `VoiceClient` seam (see voiceEngine.ts), so there is exactly one
 * synthesis path (on-device → server) and the frontend never re-implements it.
 * Reuses the shared auth/base-URL helpers in apiClient (no token re-derivation).
 */

import { apiRequest, getApiBaseUrl, getAuthHeaders } from './apiClient';

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
  createdAt: string;
}

const BASE = '/api/studio/voice-clones';

/** Clones the caller owns or has licensed. */
export async function listVoiceClones(): Promise<VoiceClone[]> {
  const res = await apiRequest<{ clones: VoiceClone[] }>(BASE);
  return res.clones ?? [];
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
  visibility?: VoiceClone['visibility'];
  provider?: string;
}): Promise<VoiceClone> {
  const form = new FormData();
  form.append('name', input.name);
  form.append('consentAttested', String(input.consentAttested));
  if (input.description) form.append('description', input.description);
  if (input.visibility) form.append('visibility', input.visibility);
  if (input.provider) form.append('provider', input.provider);
  if (input.embedding) form.append('embedding', JSON.stringify(input.embedding));
  if (input.reference) form.append('reference', input.reference, input.reference.name);

  // Multipart — let FormData set its own Content-Type boundary (mirrors publishSite).
  const headers = { ...getAuthHeaders() } as Record<string, string>;
  delete headers['Content-Type'];
  const res = await fetch(`${getApiBaseUrl()}${BASE}`, { method: 'POST', headers, body: form });
  if (!res.ok) throw new Error((await safeError(res)) ?? `Create failed (${res.status})`);
  return (await res.json()) as VoiceClone;
}

export async function deleteVoiceClone(cloneId: number): Promise<void> {
  await apiRequest(`${BASE}/${cloneId}`, { method: 'DELETE', raw: true });
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? null;
  } catch {
    return null;
  }
}
