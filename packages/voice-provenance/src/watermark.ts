/**
 * SECURITY NOTE — THIS IS A DETECTION MARK, NOT AUTHENTICATION.
 * The embedding key is public (it is derived from nothing secret, and this module
 * ships to every client), so anyone can embed a chosen id into any audio (forge)
 * and anyone with the audio can degrade or strip the mark (remove). "A watermark
 * was found" means only "something carrying this id passed through"; it does NOT
 * prove the platform made the clip. Authenticity comes solely from the SIGNED
 * manifest (HMAC, server-side) matched against the audio hash. See README.md.
 *
 * Inaudible audio watermark — a 64-bit id carried by spread-spectrum noise in the
 * 4-8 kHz band, so provenance survives the clip leaving the platform.
 *
 * HOW IT WORKS
 *  - The clip is cut into 96 equal slots, one per coded bit: the 64-bit id then a
 *    CRC-32 of it (the CRC is what lets a detector say "no watermark" instead of
 *    returning 64 random bits).
 *  - Each slot has its own keyed pseudo-random direction: a +/-1 chip sequence
 *    band-passed to 4-8 kHz (windowed-sinc FIR), normalised to unit length.
 *  - A bit is the SIGN of the host audio's projection onto that direction.
 *    Embedding is informed (improved spread spectrum): the embedder KNOWS the
 *    host's projection `c`, so it adds exactly the amount that makes the
 *    projection land on +/-T, cancelling the host's own interference instead of
 *    out-shouting it. The cost is a watermark energy of about T^2 per slot.
 *  - T is 0.2 x the clip's RMS: 6x the standard deviation of white noise 30 dB
 *    below the signal, so additive noise at that level, 16-bit re-quantisation and
 *    any gain change leave every sign intact. Speech has little energy at 4-8 kHz,
 *    so the host term is small and the watermark sits 35-45 dB under the signal.
 *
 * WHAT IT DOES NOT SURVIVE: trimming or re-timing the clip (the slot grid is
 * anchored to the clip's start and length) and codecs that discard the 4-8 kHz
 * band. A broadband-noise host costs the informed term its full host energy, so
 * the 35 dB budget holds for speech-like material, not for white noise.
 */

const ID_BITS = 64;
const CRC_BITS = 32;
const TOTAL_BITS = ID_BITS + CRC_BITS;
/** Shortest slot that keeps the watermark ~35 dB under the signal. */
const MIN_SLOT_SAMPLES = 160;
/** Quieter than this (about -60 dBFS RMS) cannot carry a mark above quantisation. */
const MIN_RMS = 1e-3;
const TAPS = 97;
const BAND_LOW_HZ = 4000;
const BAND_HIGH_HZ = 8000;
/** Stay clear of Nyquist so the filter has a transition band. */
const BAND_HIGH_MAX_FRACTION = 0.46;
const MIN_BAND_HZ = 1500;
/** Target projection as a fraction of clip RMS (see header). */
const TARGET_REL = 0.2;
const KEY = 0x5f3759df;
const DECOY_VARIANT = 1;

export const WATERMARK_ID_HEX_LENGTH = ID_BITS / 4;
const ID_PATTERN = /^[0-9a-f]{16}$/;

export class WatermarkUnsupportedError extends Error {
  constructor(reason: string) {
    super(`Audio cannot carry a watermark: ${reason}`);
    this.name = 'WatermarkUnsupportedError';
  }
}

/** A fresh random 64-bit id as 16 lowercase hex chars. */
export function newWatermarkId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function crc32(bytes: number[]): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function idBytes(id: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < id.length; i += 2) out.push(parseInt(id.slice(i, i + 2), 16));
  return out;
}

function bitsFor(id: string): number[] {
  const bytes = idBytes(id);
  const bits: number[] = [];
  for (const b of bytes) for (let k = 7; k >= 0; k--) bits.push((b >> k) & 1);
  const crc = crc32(bytes);
  for (let k = CRC_BITS - 1; k >= 0; k--) bits.push((crc >>> k) & 1);
  return bits;
}

function idFromBits(bits: number[]): string | null {
  const bytes: number[] = [];
  for (let i = 0; i < ID_BITS; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]!;
    bytes.push(b);
  }
  let crc = 0;
  for (let k = 0; k < CRC_BITS; k++) crc = ((crc << 1) | bits[ID_BITS + k]!) >>> 0;
  if (crc32(bytes) !== crc) return null;
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** mulberry32 — integer-only, so every runtime draws the same chips. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bandHighHz(sampleRate: number): number {
  return Math.min(BAND_HIGH_HZ, sampleRate * BAND_HIGH_MAX_FRACTION);
}

interface Plan {
  slotLen: number;
  fir: Float64Array;
}

function plan(length: number, sampleRate: number): Plan | null {
  const hi = bandHighHz(sampleRate);
  if (!(sampleRate > 0) || hi - BAND_LOW_HZ < MIN_BAND_HZ) return null;
  const slotLen = Math.floor(length / TOTAL_BITS);
  if (slotLen < MIN_SLOT_SAMPLES) return null;
  return { slotLen, fir: bandpass(sampleRate, BAND_LOW_HZ, hi) };
}

function sinc(x: number): number {
  return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
}

function bandpass(sampleRate: number, lowHz: number, highHz: number): Float64Array {
  const h = new Float64Array(TAPS);
  const mid = (TAPS - 1) / 2;
  const fl = (2 * lowHz) / sampleRate;
  const fh = (2 * highHz) / sampleRate;
  for (let n = 0; n < TAPS; n++) {
    const k = n - mid;
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (TAPS - 1));
    h[n] = (fh * sinc(fh * k) - fl * sinc(fl * k)) * window;
  }
  return h;
}

/** The unit-length, band-limited direction for one slot. */
function direction(slot: number, slotLen: number, fir: Float64Array, variant: number): Float64Array {
  const rand = prng((Math.imul(slot + 1, 0x9e3779b1) ^ KEY ^ Math.imul(variant, 0x85ebca6b)) >>> 0);
  const chips = new Float64Array(slotLen + TAPS - 1);
  for (let i = 0; i < chips.length; i++) chips[i] = rand() < 0.5 ? -1 : 1;
  const w = new Float64Array(slotLen);
  let energy = 0;
  for (let i = 0; i < slotLen; i++) {
    let acc = 0;
    for (let j = 0; j < TAPS; j++) acc += fir[j]! * chips[i + TAPS - 1 - j]!;
    w[i] = acc;
    energy += acc * acc;
  }
  const norm = Math.sqrt(energy) || 1;
  for (let i = 0; i < slotLen; i++) w[i] = w[i]! / norm;
  return w;
}

function rmsOf(pcm: Float32Array): number {
  let e = 0;
  for (let i = 0; i < pcm.length; i++) e += pcm[i]! * pcm[i]!;
  return Math.sqrt(e / Math.max(1, pcm.length));
}

/** True when a clip of this length/rate is long and wide enough to carry the mark. */
export function canWatermark(length: number, sampleRate: number): boolean {
  return plan(length, sampleRate) !== null;
}

/**
 * Return a copy of `pcm` carrying `id` (16 lowercase hex chars). Throws
 * {@link WatermarkUnsupportedError} when the clip is too short, too quiet or its
 * sample rate leaves no 4-8 kHz band: an unmarked clip must never be passed off
 * as marked.
 */
export function embedWatermark(pcm: Float32Array, sampleRate: number, id: string): Float32Array {
  if (!ID_PATTERN.test(id)) throw new WatermarkUnsupportedError('id must be 16 lowercase hex characters');
  const p = plan(pcm.length, sampleRate);
  if (!p) throw new WatermarkUnsupportedError('clip is too short or its sample rate is too low');
  const rms = rmsOf(pcm);
  if (rms < MIN_RMS) throw new WatermarkUnsupportedError('clip is too quiet');

  const target = TARGET_REL * rms;
  const bits = bitsFor(id);
  const out = Float32Array.from(pcm);
  for (let s = 0; s < TOTAL_BITS; s++) {
    const w = direction(s, p.slotLen, p.fir, 0);
    const base = s * p.slotLen;
    let c = 0;
    for (let i = 0; i < p.slotLen; i++) c += out[base + i]! * w[i]!;
    const sign = bits[s] ? 1 : -1;
    if (sign * c >= target) continue;
    const add = sign * target - c;
    for (let i = 0; i < p.slotLen; i++) {
      out[base + i] = Math.max(-1, Math.min(1, out[base + i]! + add * w[i]!));
    }
  }
  return out;
}

export interface WatermarkDetection {
  /** The 64-bit id, 16 lowercase hex chars. */
  id: string;
  /** 0..1: the share of slots whose projection clears twice the decoy noise level. */
  confidence: number;
}

/** Read a watermark back, or null when none (or a damaged one) is present. */
export function detectWatermark(pcm: Float32Array, sampleRate: number): WatermarkDetection | null {
  const p = plan(pcm.length, sampleRate);
  if (!p) return null;

  const z = new Float64Array(TOTAL_BITS);
  const d = new Float64Array(TOTAL_BITS);
  for (let s = 0; s < TOTAL_BITS; s++) {
    const w = direction(s, p.slotLen, p.fir, 0);
    const x = direction(s, p.slotLen, p.fir, DECOY_VARIANT);
    const base = s * p.slotLen;
    let cz = 0;
    let cd = 0;
    for (let i = 0; i < p.slotLen; i++) {
      const v = pcm[base + i]!;
      cz += v * w[i]!;
      cd += v * x[i]!;
    }
    z[s] = cz;
    d[s] = cd;
  }

  const id = idFromBits(Array.from(z, (v) => (v >= 0 ? 1 : 0)));
  if (id === null) return null;

  let decoyEnergy = 0;
  for (const v of d) decoyEnergy += v * v;
  const decoyRms = Math.sqrt(decoyEnergy / TOTAL_BITS);
  let clear = 0;
  for (const v of z) if (Math.abs(v) > 2 * decoyRms) clear++;
  return { id, confidence: clear / TOTAL_BITS };
}
