/**
 * Check a voice clip against the platform — entirely from the audio the person
 * holds. The file is decoded in the browser, the watermark is read back out of
 * it, and only the id (or, for a WAV with no mark, the hash) is sent to the
 * public verify endpoint; the audio itself never leaves the device.
 */

import { decodeWav, detectWatermark, wavPcm16DataBytes } from '@builderforce/voice-provenance';
import { ApiRequestError, apiRequest } from './apiClient';
import { sha256Hex } from './voiceClipProvenance';
import type { VoiceTrust } from './voiceTrust';

/** What the public endpoint says about a genuine clip (no owner, no workspace). */
export interface PublicVoiceProvenanceView {
  valid: true;
  clipId: string;
  watermarked: boolean;
  /** Null unless the voice is published to the marketplace; omitted for self-reported records. */
  voiceName?: string | null;
  /** True when the voice the clip was made with no longer exists. */
  voiceDeleted?: boolean;
  /** Server-computed trust; absent on older servers — see {@link voiceTrustOf}. */
  trust?: VoiceTrust;
  engine: string;
  model: string;
  consentTextVersion: string;
  createdAt: string;
  /** Present when the caller sent `audioSha256`: true only when that hash equals the signed one. */
  audioMatchesSignedHash?: boolean;
  /** True when the record's facts were reported by the creator's own device, not the server. */
  selfReported?: boolean;
}

export type VerifyOutcome =
  /** `detected`: how the record was found — a watermark read from the audio is a DETECTION
   *  (the mark names a clip), not proof this exact audio was made on Builderforce. */
  | { kind: 'verified'; view: PublicVoiceProvenanceView; detected: 'watermark' | 'hash' }
  | { kind: 'noWatermark' }
  | { kind: 'invalid' }
  | { kind: 'unreadable' };

/** Sample rates the platform's synthesizers emit. `decodeAudioData` resamples to
 *  its context's rate, and the watermark's slot grid is anchored to the clip's
 *  original length, so a compressed file is decoded once per candidate rate. */
const CANDIDATE_RATES = [24000, 16000, 22050, 32000, 44100, 48000];

type Lookup = { watermarkId: string; audioSha256?: string } | { audioSha256: string };

async function lookup(by: Lookup): Promise<PublicVoiceProvenanceView | 'missing' | 'invalid'> {
  const params = new URLSearchParams();
  if ('watermarkId' in by) params.set('watermarkId', by.watermarkId);
  if (by.audioSha256) params.set('audioSha256', by.audioSha256);
  const query = params.toString();
  try {
    return await apiRequest<PublicVoiceProvenanceView>(`/api/voice/provenance/verify?${query}`, {
      auth: 'none',
      expectedErrors: [404, 422],
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return 'missing';
    if (error instanceof ApiRequestError && error.status === 422) return 'invalid';
    throw error;
  }
}

/** Look a watermark id up directly (the badge link pre-fills it). */
export async function verifyWatermarkId(watermarkId: string, audioSha256?: string): Promise<VerifyOutcome> {
  const found = await lookup(audioSha256 ? { watermarkId, audioSha256 } : { watermarkId });
  return found === 'missing' || found === 'invalid'
    ? { kind: 'invalid' }
    : { kind: 'verified', view: found, detected: 'watermark' };
}

async function detectViaAudioContext(bytes: ArrayBuffer): Promise<{ id: string | null; decoded: boolean }> {
  let decoded = false;
  for (const sampleRate of CANDIDATE_RATES) {
    const ctx = new AudioContext({ sampleRate });
    try {
      const buffer = await ctx.decodeAudioData(bytes.slice(0));
      decoded = true;
      const found = detectWatermark(buffer.getChannelData(0), buffer.sampleRate);
      if (found) return { id: found.id, decoded };
    } catch {
      /* this codec/rate did not decode — try the next */
    } finally {
      void ctx.close();
    }
  }
  return { id: null, decoded };
}

export async function verifyAudioFile(file: File): Promise<VerifyOutcome> {
  const bytes = await file.arrayBuffer();
  const wav = decodeWav(bytes);
  const pcmBytes = wavPcm16DataBytes(bytes);

  let watermarkId: string | null;
  if (wav) {
    watermarkId = detectWatermark(wav.channels[0]!, wav.sampleRate)?.id ?? null;
  } else {
    const result = await detectViaAudioContext(bytes);
    if (!result.decoded) return { kind: 'unreadable' };
    watermarkId = result.id;
  }

  // For a WAV the PCM16 hash goes along with the lookup, so the server can say whether THIS
  // audio is the signed audio (`audioMatchesSignedHash`) rather than merely carrying a mark.
  const audioSha256 = pcmBytes ? await sha256Hex(pcmBytes) : undefined;
  if (watermarkId) return verifyWatermarkId(watermarkId, audioSha256);

  // No mark in the audio — an unmodified WAV can still be matched by its hash.
  if (audioSha256) {
    const found = await lookup({ audioSha256 });
    if (found !== 'missing' && found !== 'invalid') return { kind: 'verified', view: found, detected: 'hash' };
  }
  return { kind: 'noWatermark' };
}
