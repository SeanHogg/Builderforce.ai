/**
 * voiceEngine — the IDE's bridge to the on-device clone path (closes the
 * server-only IDE gap). Lazily loads the studio SSM engine + the
 * @seanhogg/builderforce-voice `VoiceClient` seam, so the heavy WebGPU engine is
 * only pulled when the user actually clones — and a missing dep / no-WebGPU
 * device degrades to the server path instead of breaking the page.
 *
 * Synthesis goes through the package's `VoiceClient.narrate` (NOT a bespoke
 * frontend resolver) so the IDE dogfoods the exact contract hired.video consumes:
 * on-device when an enrolled embedding + engine exist, else the metered server,
 * with the same honesty/fallback semantics. This is the DRY seam — the panel
 * passes a `voiceId` (+ optional speaker), never branches on provider itself.
 */

import { getApiBaseUrl, getAuthHeaders } from './apiClient';
import { getStoredTenantToken } from './auth';
import type { PcmAudio } from './captureAudio';

type StudioModule = typeof import('@seanhogg/builderforce-studio');
type VoiceModule = typeof import('@seanhogg/builderforce-voice');
type SpeakerEmbedding = import('@seanhogg/builderforce-voice').StudioSpeakerEmbedding;
type NarrationResult = import('@seanhogg/builderforce-voice').NarrationResult;

export type { SpeakerEmbedding, NarrationResult };

/** True when the browser can run the on-device engine on the GPU (it also works
 *  on CPU, but WebGPU is the "free + fast" story we badge). */
export function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

interface OnDeviceEngine {
  enroll(pcm: PcmAudio): SpeakerEmbedding;
  /** The studio engine instance, passed to VoiceClient as the client backend. */
  clientEngine: unknown;
  encodeWav(audio: { samples: Float32Array; sampleRate: number }): ArrayBuffer;
}

let studioPromise: Promise<OnDeviceEngine | null> | null = null;

/** Lazily construct the on-device engine. Returns null on SSR, a missing studio
 *  package, or any load failure (caller falls back to the server path). */
export async function getOnDeviceEngine(): Promise<OnDeviceEngine | null> {
  if (typeof window === 'undefined') return null;
  if (!studioPromise) {
    studioPromise = (async () => {
      try {
        const studio: StudioModule = await import('@seanhogg/builderforce-studio');
        const engine = new studio.VoiceCloneEngine();
        return {
          enroll: (pcm: PcmAudio) => engine.enroll(pcm) as SpeakerEmbedding,
          clientEngine: engine,
          encodeWav: studio.encodeWav,
        };
      } catch {
        return null;
      }
    })();
  }
  return studioPromise;
}

let voicePromise: Promise<VoiceModule> | null = null;
function loadVoice(): Promise<VoiceModule> {
  if (!voicePromise) voicePromise = import('@seanhogg/builderforce-voice');
  return voicePromise;
}

/**
 * Narrate `text` in voice `cloneId`. When `speaker` (a locally-enrolled
 * embedding) and the on-device engine are present, the VoiceClient prefers the
 * free WebGPU path; otherwise it routes to the metered server endpoint — same
 * bearer (the tenant JWT) the rest of the app uses.
 */
export async function narrate(
  cloneId: number,
  text: string,
  speaker?: SpeakerEmbedding | null,
): Promise<NarrationResult> {
  const voice = await loadVoice();
  const onDevice = speaker ? await getOnDeviceEngine() : null;
  const client = new voice.VoiceClient({
    apiKey: getStoredTenantToken() ?? '',
    baseUrl: getApiBaseUrl(),
    ...(onDevice ? { clientEngine: onDevice.clientEngine as never } : {}),
  });
  return client.narrate(String(cloneId), { text }, speaker ? { speaker } : {});
}

/** Turn a NarrationResult into a playable object URL. On-device results carry raw
 *  PCM (→ WAV here); server results carry an auth-protected URL (→ authed fetch
 *  → blob). One helper so the panel never branches on the engine. Caller revokes. */
export async function narrationResultToObjectUrl(result: NarrationResult): Promise<string> {
  if (result.pcm && result.sampleRate) {
    const engine = await getOnDeviceEngine();
    if (!engine) throw new Error('On-device engine unavailable to encode PCM.');
    const wav = engine.encodeWav({ samples: result.pcm, sampleRate: result.sampleRate });
    return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  }
  if (result.audioUrl) {
    const res = await fetch(`${getApiBaseUrl()}${result.audioUrl}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`Audio fetch failed (${res.status})`);
    return URL.createObjectURL(await res.blob());
  }
  throw new Error('Narration result has no audio.');
}

// ── Local embedding store ───────────────────────────────────────────────────
// On-device enrolment yields an embedding that the server intentionally never
// echoes back (no-leak contract). Cache it per clone id in localStorage so the
// free on-device synthesis path keeps working across reloads on this device.

const EMB_PREFIX = 'bf_voice_emb_';

export function saveEmbedding(cloneId: number, embedding: SpeakerEmbedding): void {
  try {
    localStorage.setItem(`${EMB_PREFIX}${cloneId}`, JSON.stringify(embedding));
  } catch { /* storage full / disabled — on-device just won't persist */ }
}

export function loadEmbedding(cloneId: number): SpeakerEmbedding | null {
  try {
    const raw = localStorage.getItem(`${EMB_PREFIX}${cloneId}`);
    return raw ? (JSON.parse(raw) as SpeakerEmbedding) : null;
  } catch {
    return null;
  }
}

export function deleteEmbedding(cloneId: number): void {
  try {
    localStorage.removeItem(`${EMB_PREFIX}${cloneId}`);
  } catch { /* ignore */ }
}
