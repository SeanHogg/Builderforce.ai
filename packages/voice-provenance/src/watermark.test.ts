import { describe, expect, it } from 'vitest';
import { canWatermark, detectWatermark, embedWatermark, newWatermarkId, WatermarkUnsupportedError } from './watermark';
import { decodeWav, encodeWavPcm16 } from './pcm';

const SR = 16000;
const ID = '0123456789abcdef';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

/** Voiced-speech-like: harmonics of a wandering pitch under 3 kHz, syllabic
 *  amplitude envelope, and a faint broadband floor (-40 dB) so 4-8 kHz is not empty. */
function speechLike(seconds: number, seed = 1): Float32Array {
  const n = Math.floor(seconds * SR);
  const r = rng(seed);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f0 = 120 + 25 * Math.sin(2 * Math.PI * 0.7 * t);
    phase += (2 * Math.PI * f0) / SR;
    let v = 0;
    for (let h = 1; h <= 20; h++) v += Math.sin(h * phase) / (h * h);
    const env = 0.55 + 0.45 * Math.sin(2 * Math.PI * 3 * t);
    out[i] = 0.3 * env * v + 0.003 * gaussian(r);
  }
  return out;
}

function rms(x: Float32Array): number {
  let e = 0;
  for (const v of x) e += v * v;
  return Math.sqrt(e / x.length);
}

function snrDb(signal: Float32Array, marked: Float32Array): number {
  let s = 0;
  let d = 0;
  for (let i = 0; i < signal.length; i++) {
    s += signal[i]! * signal[i]!;
    d += (marked[i]! - signal[i]!) ** 2;
  }
  return 10 * Math.log10(s / d);
}

describe('watermark', () => {
  const host = speechLike(3);
  const marked = embedWatermark(host, SR, ID);

  it('round-trips the id', () => {
    const found = detectWatermark(marked, SR);
    expect(found?.id).toBe(ID);
    expect(found!.confidence).toBeGreaterThan(0.9);
  });

  it('stays inaudible: watermark at least 35 dB under the signal', () => {
    expect(snrDb(host, marked)).toBeGreaterThan(35);
  });

  it('survives 16-bit quantisation', () => {
    const q = Float32Array.from(marked, (v) => Math.round(v * 32767) / 32767);
    expect(detectWatermark(q, SR)?.id).toBe(ID);
  });

  it('survives a gain change', () => {
    expect(detectWatermark(Float32Array.from(marked, (v) => v * 0.6), SR)?.id).toBe(ID);
    expect(detectWatermark(Float32Array.from(marked, (v) => v * 1.4), SR)?.id).toBe(ID);
  });

  it('survives additive noise at 30 dB SNR', () => {
    const r = rng(99);
    const sigma = rms(marked) * Math.pow(10, -30 / 20);
    const noisy = Float32Array.from(marked, (v) => v + sigma * gaussian(r));
    expect(detectWatermark(noisy, SR)?.id).toBe(ID);
  });

  it('survives a WAV encode/decode', () => {
    const wav = decodeWav(encodeWavPcm16([marked], SR));
    expect(wav?.sampleRate).toBe(SR);
    expect(detectWatermark(wav!.channels[0]!, SR)?.id).toBe(ID);
  });

  it('finds nothing in unmarked audio', () => {
    expect(detectWatermark(host, SR)).toBeNull();
    const r = rng(5);
    expect(detectWatermark(Float32Array.from({ length: 48000 }, () => 0.1 * gaussian(r)), SR)).toBeNull();
  });

  it('does not report a mark under a different clip length', () => {
    expect(detectWatermark(marked.subarray(1000), SR)).toBeNull();
  });

  it('refuses audio it cannot carry rather than returning it unmarked', () => {
    expect(canWatermark(100, SR)).toBe(false);
    expect(() => embedWatermark(new Float32Array(100), SR, ID)).toThrow(WatermarkUnsupportedError);
    expect(() => embedWatermark(host, 8000, ID)).toThrow(WatermarkUnsupportedError);
    expect(() => embedWatermark(new Float32Array(48000), SR, ID)).toThrow(WatermarkUnsupportedError);
    expect(() => embedWatermark(host, SR, 'nothex')).toThrow(WatermarkUnsupportedError);
  });

  it('newWatermarkId is 16 lowercase hex chars', () => {
    expect(newWatermarkId()).toMatch(/^[0-9a-f]{16}$/);
  });
});
