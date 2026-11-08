/**
 * Voice-clip provenance on the web client.
 *
 * Every clip carries (a) an inaudible watermark and (b) a server-signed
 * manifest. Server-synthesized clips are marked and signed by the api before
 * they are stored, so the client only fetches the manifest. A clip made ON THIS
 * DEVICE is marked by the studio engine itself; the client then reports the
 * clip's hash + watermark id and the server signs them after the same access and
 * consent gates as server synthesis.
 */

import {
  detectWatermark,
  floatToPcm16,
  pcm16Bytes,
  type VoiceProvenanceManifest,
} from '@builderforce/voice-provenance';
import { apiRequest } from './apiClient';

/** What the server hands back for a clip, and what the badge renders. */
export interface VoiceClipProvenance {
  manifest: VoiceProvenanceManifest;
  signature: string;
  /** False when the audio could not be marked (a codec the server cannot decode). */
  watermarked: boolean;
}

/** The result of a narration, optionally carrying its provenance. `NarrationResult`
 *  stays assignable to this: the field is optional. */
export interface WithProvenance {
  provenance?: VoiceClipProvenance;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Register an on-device clip for a server signature. The studio engine already
 * embedded the watermark when it synthesized the clip (the ONE place marking
 * happens); this reads the id back out of the PCM, hashes the PCM16 bytes and
 * reports id, hash, engine and model. Returns `null` when the clip carries no
 * watermark (too short or quiet) so no badge claims one. A rejected registration
 * (no consent, wrong tenant) throws: an unregistered watermark verifies as nothing.
 */
export async function registerOnDeviceClip(
  cloneId: number,
  pcm: Float32Array,
  sampleRate: number,
  model: string,
): Promise<VoiceClipProvenance | null> {
  const found = detectWatermark(pcm, sampleRate);
  if (!found) return null;
  const audioSha256 = await sha256Hex(pcm16Bytes(floatToPcm16([pcm])));
  return apiRequest<VoiceClipProvenance>(`/api/studio/voice-clones/${cloneId}/provenance`, {
    method: 'POST',
    body: JSON.stringify({ watermarkId: found.id, audioSha256, engine: 'clone-client', model }),
  });
}

/** The signed provenance of a server-synthesized clip, from its audio URL, or
 *  null for a clip that predates provenance. */
export async function fetchServerClipProvenance(audioUrl: string): Promise<VoiceClipProvenance | null> {
  if (!audioUrl.endsWith('/audio')) return null;
  try {
    return await apiRequest<VoiceClipProvenance>(`${audioUrl.slice(0, -'/audio'.length)}/provenance`, {
      expectedErrors: [403, 404],
    });
  } catch {
    return null;
  }
}

/** The public verify page (no sign-in), pre-filled with this clip's watermark id.
 *  Locale-less: render it through the app's locale-aware `Link`. */
export function verifyPagePath(provenance: VoiceClipProvenance): string {
  return `/voice/verify?watermarkId=${encodeURIComponent(provenance.manifest.watermarkId)}`;
}
