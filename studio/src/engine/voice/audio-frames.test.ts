import { describe, it, expect } from 'vitest';
import {
  fftInPlace,
  ifftInPlace,
  melSpectrogram,
  melToWaveform,
  cosineSimilarity,
  l2Normalize,
  DEFAULT_SAMPLE_RATE,
} from './audio-frames';

/**
 * A voice-like fixture: a fundamental + two formant overtones. Deterministic,
 * so every DSP assertion below is reproducible across browser / Node / CI —
 * the studio's no-Math.random determinism contract applied to audio.
 */
function tone(seconds: number, f0: number, sampleRate = DEFAULT_SAMPLE_RATE): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    out[i] =
      0.6 * Math.sin(2 * Math.PI * f0 * t) +
      0.3 * Math.sin(2 * Math.PI * f0 * 2.4 * t) +
      0.1 * Math.sin(2 * Math.PI * f0 * 3.7 * t);
  }
  return out;
}

describe('fft / ifft (the DSP kernel both encoder and codec ride)', () => {
  it('round-trips a signal back to itself', () => {
    const n = 256;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((i / n) * 2 * Math.PI * 5);
    const original = Float32Array.from(re);

    fftInPlace(re, im);
    ifftInPlace(re, im);

    for (let i = 0; i < n; i++) expect(re[i]).toBeCloseTo(original[i], 4);
  });

  it('rejects non-power-of-two lengths (guards the radix-2 assumption)', () => {
    expect(() => fftInPlace(new Float32Array(100), new Float32Array(100))).toThrow(/power of two/);
  });
});

describe('melSpectrogram', () => {
  it('produces one numMels-length frame per hop', () => {
    const mel = melSpectrogram(tone(0.2, 150));
    expect(mel.numMels).toBe(80);
    expect(mel.frames.length).toBeGreaterThan(0);
    for (const frame of mel.frames) expect(frame.length).toBe(80);
  });

  it('different pitches yield distinguishable spectra', () => {
    const a = melSpectrogram(tone(0.2, 120)).frames[2];
    const b = melSpectrogram(tone(0.2, 320)).frames[2];
    expect(cosineSimilarity(a, b)).toBeLessThan(0.999);
  });

  it('empty input yields no frames (not a throw)', () => {
    expect(melSpectrogram(new Float32Array(0)).frames.length).toBe(0);
  });
});

describe('melToWaveform (vocoder inversion)', () => {
  it('reconstructs audio of the expected length and finite samples', () => {
    const pcm = tone(0.25, 180);
    const mel = melSpectrogram(pcm);
    const recon = melToWaveform(mel);
    // (frames-1)*hop + frameLength
    const expected = (mel.frames.length - 1) * mel.hopLength + mel.frameLength;
    expect(recon.length).toBe(expected);
    for (let i = 0; i < recon.length; i += 257) expect(Number.isFinite(recon[i])).toBe(true);
  });

  it('preserves coarse spectral structure through the round-trip', () => {
    // Re-analysing the reconstruction should land near the original mel, since
    // melToWaveform is the inverse of melSpectrogram (band-limited, phase-naive).
    const pcm = tone(0.3, 200);
    const mel1 = melSpectrogram(pcm);
    const recon = melToWaveform(mel1);
    const mel2 = melSpectrogram(recon);
    const k = Math.min(mel1.frames.length, mel2.frames.length) >> 1;
    expect(cosineSimilarity(mel1.frames[k], mel2.frames[k])).toBeGreaterThan(0.6);
  });
});

describe('vector helpers', () => {
  it('l2Normalize makes a unit vector', () => {
    const v = l2Normalize(Float32Array.from([3, 4]));
    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1, 6);
  });

  it('cosineSimilarity is 1 for identical, throws on mismatch', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/mismatch/);
  });
});
