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

import { getApiBaseUrl, apiRequestStream } from './apiClient';
import { getStoredTenantToken } from './auth';
import type { PcmAudio } from './captureAudio';
import { loadStudio } from './studioLoader';
import { encodeWavPcm16 } from '@builderforce/voice-provenance';
import {
  fetchServerClipProvenance,
  registerOnDeviceClip,
  type WithProvenance,
} from './voiceClipProvenance';

type VoiceModule = typeof import('@seanhogg/builderforce-voice');
type SpeakerEmbedding = import('@seanhogg/builderforce-voice').StudioSpeakerEmbedding;
type NarrationResult = import('@seanhogg/builderforce-voice').NarrationResult;

export type { SpeakerEmbedding, NarrationResult };

interface OnDeviceEngine {
  enroll(pcm: PcmAudio): SpeakerEmbedding;
  /** The studio engine instance, passed to VoiceClient as the client backend. */
  clientEngine: unknown;
}

/** The `model` recorded in an on-device clip's manifest. */
const ON_DEVICE_MODEL = 'ssm-webgpu';

let studioPromise: Promise<OnDeviceEngine | null> | null = null;

/** Lazily construct the on-device engine. Returns null on SSR, a missing studio
 *  package, or any load failure (caller falls back to the server path). */
export async function getOnDeviceEngine(): Promise<OnDeviceEngine | null> {
  if (typeof window === 'undefined') return null;
  if (!studioPromise) {
    studioPromise = (async () => {
      try {
        // The ONNX runtime resolves its ~21 MB `.wasm` relative to the bundle
        // unless told otherwise. That is right on the web (Next serves it from
        // the app's own static assets) but not in an editor webview, where
        // shipping it would put 21 MB of runtime into every VSIX download for a
        // feature most sessions never open. A host that serves the runtime
        // itself says so through the port, and it is fetched on first use. Studio's
        // `onnx-runtime-config` is the ONE configurer: the host hands it the base
        // (host copy, else same-origin `/ort/`) before the engine's first session.
        const studio = await loadStudio();
        const engine = new studio.VoiceCloneEngine();
        return {
          enroll: (pcm: PcmAudio) => engine.enroll(pcm) as SpeakerEmbedding,
          clientEngine: engine,
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
): Promise<NarrationResult & WithProvenance> {
  const voice = await loadVoice();
  const onDevice = speaker ? await getOnDeviceEngine() : null;
  const client = new voice.VoiceClient({
    apiKey: getStoredTenantToken() ?? '',
    baseUrl: getApiBaseUrl(),
    ...(onDevice ? { clientEngine: onDevice.clientEngine as never } : {}),
  });
  const result = await client.narrate(String(cloneId), { text }, speaker ? { speaker } : {});
  return withProvenance(cloneId, result);
}

/**
 * Every clip leaves here with provenance. An on-device clip is watermarked in its
 * PCM (before it can be played or saved) and registered for a server signature; a
 * server clip was marked and signed by the api, so its manifest is just fetched.
 * A named-voice fallback is not a clone of anyone and carries none.
 */
async function withProvenance(cloneId: number, result: NarrationResult): Promise<NarrationResult & WithProvenance> {
  if (!result.cloned) return result;
  if (result.pcm && result.sampleRate) {
    // The studio engine already watermarked this PCM; register it for a signature.
    const provenance = await registerOnDeviceClip(cloneId, result.pcm, result.sampleRate, ON_DEVICE_MODEL);
    return provenance ? { ...result, provenance } : result;
  }
  if (result.audioUrl) {
    const provenance = await fetchServerClipProvenance(result.audioUrl);
    return provenance ? { ...result, provenance } : result;
  }
  return result;
}

/** Turn a NarrationResult into a playable object URL. On-device results carry raw
 *  PCM (→ WAV here); server results carry an auth-protected URL (→ authed fetch
 *  → blob). One helper so the panel never branches on the engine. Caller revokes.
 *  The WAV is written by the provenance package's encoder so the file's PCM bytes
 *  are exactly the bytes whose hash was registered. */
export async function narrationResultToObjectUrl(result: NarrationResult): Promise<string> {
  if (result.pcm && result.sampleRate) {
    const wav = encodeWavPcm16([result.pcm], result.sampleRate);
    return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  }
  if (result.audioUrl) {
    const res = await apiRequestStream(result.audioUrl);
    if (!res.ok) throw new Error(`Audio fetch failed (${res.status})`);
    return URL.createObjectURL(await res.blob());
  }
  throw new Error('Narration result has no audio.');
}
