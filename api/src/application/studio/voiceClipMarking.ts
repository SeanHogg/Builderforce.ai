/**
 * Mark server-synthesized audio before it is stored: decode the vendor's WAV,
 * embed a fresh watermark id in the PCM, re-encode, and hash what was written.
 *
 * When the vendor returns something the Worker cannot decode to PCM (a
 * compressed codec, 24-bit), the audio is stored as it came and the result says
 * `watermarked: false` — recorded on the provenance row, never implied. The
 * manifest is still signed over the stored bytes.
 */

import {
  canWatermark,
  decodeWav,
  embedWatermark,
  encodeWavPcm16,
  floatToPcm16,
  newWatermarkId,
  pcm16Bytes,
  WatermarkUnsupportedError,
} from '@builderforce/voice-provenance';
import { sha256HexBytes } from '../../domain/shared/hash';

export interface MarkedClip {
  audio: ArrayBuffer;
  contentType: string;
  /** sha256 of the stored clip: its PCM16 sample bytes when marked, else the raw bytes. */
  audioSha256: string;
  watermarkId: string;
  watermarked: boolean;
}

export async function markServerClip(audio: ArrayBuffer, contentType: string): Promise<MarkedClip> {
  const watermarkId = newWatermarkId();
  const decoded = decodeWav(audio);
  if (decoded && canWatermark(decoded.channels[0]!.length, decoded.sampleRate)) {
    try {
      const channels = decoded.channels.map((ch) => embedWatermark(ch, decoded.sampleRate, watermarkId));
      const pcmBytes = pcm16Bytes(floatToPcm16(channels));
      return {
        audio: encodeWavPcm16(channels, decoded.sampleRate),
        contentType: 'audio/wav',
        audioSha256: await sha256HexBytes(pcmBytes),
        watermarkId,
        watermarked: true,
      };
    } catch (error) {
      if (!(error instanceof WatermarkUnsupportedError)) throw error;
    }
  }
  return { audio, contentType, audioSha256: await sha256HexBytes(audio), watermarkId, watermarked: false };
}
