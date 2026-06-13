/**
 * wav — encode mono Float32 PCM to a 16-bit WAV container.
 *
 * The clone engine emits raw Float32 samples (the studio's in-memory contract);
 * consumers that need a file/Blob — download, R2 upload, <audio src> — get a
 * standard 16-bit PCM WAV here. Kept dependency-free and browser/Node-portable
 * (returns an ArrayBuffer; `encodeWavBlob` wraps it as a Blob only where the DOM
 * type exists).
 */

import type { PcmAudio } from './types';

/** Float32 PCM [-1, 1] → 16-bit little-endian WAV bytes. */
export function encodeWav(audio: PcmAudio): ArrayBuffer {
  const { samples, sampleRate } = audio;
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = 1 (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

/** Same as {@link encodeWav} but wrapped as a `Blob` (browser/worker only). */
export function encodeWavBlob(audio: PcmAudio): Blob {
  return new Blob([encodeWav(audio)], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}
