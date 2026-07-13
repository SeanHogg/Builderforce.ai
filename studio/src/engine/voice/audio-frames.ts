/**
 * audio-frames — the shared DSP foundation for the voice-cloning stack.
 *
 * Both the speaker encoder (Phase 1) and the neural codec (Phase 1) reduce a raw
 * PCM waveform to a log-mel spectrogram before doing anything model-specific, and
 * the acoustic model's vocoder (Phase 2) inverts a mel spectrogram back to a
 * waveform. Rather than let three modules each carry their own framing / FFT /
 * filterbank, the entire signal→mel→signal path lives here once (DRY: the shared
 * kernel owns the transform; callers pass audio, never re-derive the math).
 *
 * Everything is a pure Float32 function with no model weights, no I/O, and no
 * platform dependency, so it runs identically in the browser (WebGPU studio),
 * Node (tests / server fallback), and a worker. A trained codec/vocoder later
 * swaps the *weights* it operates on — the transform contract here stays fixed.
 */

/** Default analysis configuration. 24 kHz mono mirrors the OpenAI/ElevenLabs PCM
 *  contract the agent-runtime TTS layer already emits, so cloned audio muxes into
 *  the same pipeline with no resample. */
export const DEFAULT_SAMPLE_RATE = 24_000;
/** FFT size — power of two so the radix-2 transform below applies. 1024 @ 24 kHz
 *  ≈ 43 ms windows, the usual TTS analysis frame. */
export const DEFAULT_FRAME_LENGTH = 1024;
/** Hop = frame/4 (75 % overlap) — standard for artifact-free overlap-add resynth. */
export const DEFAULT_HOP_LENGTH = 256;
/** Mel band count. 80 is the de-facto TTS mel resolution (Tacotron/FastSpeech/HiFi-GAN). */
export const DEFAULT_NUM_MELS = 80;

export interface MelConfig {
  sampleRate: number;
  frameLength: number;
  hopLength: number;
  numMels: number;
}

/** Canonical analysis config used everywhere unless a caller overrides it. */
export function defaultMelConfig(overrides: Partial<MelConfig> = {}): MelConfig {
  return {
    sampleRate: overrides.sampleRate ?? DEFAULT_SAMPLE_RATE,
    frameLength: overrides.frameLength ?? DEFAULT_FRAME_LENGTH,
    hopLength: overrides.hopLength ?? DEFAULT_HOP_LENGTH,
    numMels: overrides.numMels ?? DEFAULT_NUM_MELS,
  };
}

/** Periodic Hann window — used both for analysis (pre-FFT) and synthesis
 *  (overlap-add). Cached per length because the studio re-analyses many clips. */
const hannCache = new Map<number, Float32Array>();
export function hannWindow(n: number): Float32Array {
  const cached = hannCache.get(n);
  if (cached) return cached;
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  }
  hannCache.set(n, w);
  return w;
}

/**
 * Split a signal into overlapping frames of `frameLength`, advancing `hopLength`
 * each step. The tail is zero-padded to a whole frame so short clips (and the
 * last hop of any clip) still produce a frame instead of being dropped — the
 * decode path relies on frame count being `ceil`, not `floor`.
 */
export function frameSignal(
  signal: Float32Array,
  frameLength: number,
  hopLength: number,
): Float32Array[] {
  if (signal.length === 0) return [];
  const frames: Float32Array[] = [];
  for (let start = 0; start < signal.length; start += hopLength) {
    const frame = new Float32Array(frameLength);
    const end = Math.min(start + frameLength, signal.length);
    frame.set(signal.subarray(start, end));
    frames.push(frame);
    if (end >= signal.length) break;
  }
  return frames;
}

/**
 * In-place iterative radix-2 Cooley–Tukey FFT. `re`/`im` must be power-of-two
 * length. Real-input callers pass `im` all-zero. O(N log N) — fast enough to
 * analyse seconds of audio in a unit test without a native dependency.
 */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) {
    throw new Error(`fftInPlace: length ${n} is not a power of two`);
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  // Butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len >> 1; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + (len >> 1)] * curRe - im[i + k + (len >> 1)] * curIm;
        const bIm = re[i + k + (len >> 1)] * curIm + im[i + k + (len >> 1)] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + (len >> 1)] = aRe - bRe;
        im[i + k + (len >> 1)] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Inverse FFT via conjugation: ifft(x) = conj(fft(conj(x))) / N. */
export function ifftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fftInPlace(re, im);
  const inv = 1 / n;
  for (let i = 0; i < n; i++) {
    re[i] *= inv;
    im[i] = -im[i] * inv;
  }
}

/** Magnitude spectrum (first N/2+1 bins) of a single windowed frame. */
export function magnitudeSpectrum(frame: Float32Array): Float32Array {
  const n = frame.length;
  const re = new Float32Array(frame);
  const im = new Float32Array(n);
  fftInPlace(re, im);
  const bins = n / 2 + 1;
  const mag = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    mag[b] = Math.hypot(re[b], im[b]);
  }
  return mag;
}

const hzToMel = (hz: number): number => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number): number => 700 * (10 ** (mel / 2595) - 1);

/**
 * Triangular mel filterbank: `numMels` filters spanning 0…Nyquist, each a row of
 * `(frameLength/2 + 1)` linear-bin weights. Cached by config because every clip
 * the studio analyses reuses the same filters (recomputing per call is the exact
 * N+1-style waste the perf rule rejects).
 */
const filterbankCache = new Map<string, Float32Array[]>();
export function melFilterbank(config: MelConfig): Float32Array[] {
  const key = `${config.sampleRate}:${config.frameLength}:${config.numMels}`;
  const cached = filterbankCache.get(key);
  if (cached) return cached;

  const bins = config.frameLength / 2 + 1;
  const melMin = hzToMel(0);
  const melMax = hzToMel(config.sampleRate / 2);
  const points = new Float32Array(config.numMels + 2);
  for (let i = 0; i < points.length; i++) {
    const mel = melMin + ((melMax - melMin) * i) / (config.numMels + 1);
    points[i] = (melToHz(mel) / (config.sampleRate / 2)) * (bins - 1);
  }

  const filters: Float32Array[] = [];
  for (let m = 1; m <= config.numMels; m++) {
    const row = new Float32Array(bins);
    const left = points[m - 1];
    const center = points[m];
    const right = points[m + 1];
    for (let b = 0; b < bins; b++) {
      let w = 0;
      if (b >= left && b <= center && center > left) w = (b - left) / (center - left);
      else if (b > center && b <= right && right > center) w = (right - b) / (right - center);
      row[b] = w;
    }
    filters.push(row);
  }
  filterbankCache.set(key, filters);
  return filters;
}

export interface MelSpectrogram {
  /** One log-mel vector (length `numMels`) per analysis frame. */
  frames: Float32Array[];
  numMels: number;
  hopLength: number;
  frameLength: number;
  sampleRate: number;
}

/** Natural-log floor so silent bins map to a finite, stable value (matches the
 *  log-mel convention used by every mel-input vocoder). */
const LOG_FLOOR = 1e-5;

/** PCM waveform → log-mel spectrogram. The single entry point both the speaker
 *  encoder and the codec analysis path call. */
export function melSpectrogram(
  pcm: Float32Array,
  overrides: Partial<MelConfig> = {},
): MelSpectrogram {
  const config = defaultMelConfig(overrides);
  const window = hannWindow(config.frameLength);
  const filters = melFilterbank(config);
  const frames = frameSignal(pcm, config.frameLength, config.hopLength);

  const melFrames: Float32Array[] = frames.map((frame) => {
    const windowed = new Float32Array(config.frameLength);
    for (let i = 0; i < config.frameLength; i++) windowed[i] = frame[i] * window[i];
    const mag = magnitudeSpectrum(windowed);
    const mel = new Float32Array(config.numMels);
    for (let m = 0; m < config.numMels; m++) {
      const row = filters[m];
      let energy = 0;
      for (let b = 0; b < row.length; b++) energy += row[b] * mag[b];
      mel[m] = Math.log(Math.max(energy, LOG_FLOOR));
    }
    return mel;
  });

  return {
    frames: melFrames,
    numMels: config.numMels,
    hopLength: config.hopLength,
    frameLength: config.frameLength,
    sampleRate: config.sampleRate,
  };
}

/**
 * Mel spectrogram → PCM waveform (the vocoder inversion the acoustic model's
 * output rides through).
 *
 * This is an honest, deterministic, weight-free inversion — NOT a trained neural
 * vocoder. Steps: undo the log; map mel energies back to a linear magnitude
 * spectrum through the transposed filterbank; pair the magnitude with a
 * zero-phase spectrum; inverse-FFT each frame; overlap-add with the synthesis
 * window. It reconstructs pitch/formant structure (so a cloned timbre is
 * audibly present and round-trips in tests) but is band-limited and phase-naive
 * compared to a trained HiFi-GAN. Phase 2's training pipeline replaces this body
 * with learned vocoder weights behind the same signature — logged in the Gap
 * Register, not hidden.
 */
export function melToWaveform(mel: MelSpectrogram): Float32Array {
  const { frames, hopLength, frameLength, numMels, sampleRate } = mel;
  if (frames.length === 0) return new Float32Array(0);

  const filters = melFilterbank({ sampleRate, frameLength, hopLength, numMels });
  const window = hannWindow(frameLength);
  const bins = frameLength / 2 + 1;

  // Per-linear-bin normaliser for the transposed (pseudo-inverse) mel map.
  const binWeight = new Float32Array(bins);
  for (let m = 0; m < numMels; m++) {
    const row = filters[m];
    for (let b = 0; b < bins; b++) binWeight[b] += row[b];
  }

  const outLength = (frames.length - 1) * hopLength + frameLength;
  const out = new Float32Array(outLength);
  const norm = new Float32Array(outLength);

  for (let f = 0; f < frames.length; f++) {
    const melVec = frames[f];

    // mel (log energies) → linear magnitude spectrum via transposed filterbank.
    const mag = new Float32Array(bins);
    for (let m = 0; m < numMels; m++) {
      const energy = Math.exp(melVec[m]);
      const row = filters[m];
      for (let b = 0; b < bins; b++) mag[b] += row[b] * energy;
    }
    for (let b = 0; b < bins; b++) {
      if (binWeight[b] > 0) mag[b] /= binWeight[b];
    }

    // Hermitian-symmetric, zero-phase spectrum → real frame via inverse FFT.
    const re = new Float32Array(frameLength);
    const im = new Float32Array(frameLength);
    for (let b = 0; b < bins; b++) {
      re[b] = mag[b];
      if (b > 0 && b < bins - 1) re[frameLength - b] = mag[b];
    }
    ifftInPlace(re, im);

    const base = f * hopLength;
    for (let i = 0; i < frameLength; i++) {
      out[base + i] += re[i] * window[i];
      norm[base + i] += window[i] * window[i];
    }
  }

  for (let i = 0; i < outLength; i++) {
    if (norm[i] > 1e-8) out[i] /= norm[i];
  }
  return out;
}

/** Deterministic, seedable PRNG (mulberry32). Used to initialise weight-free
 *  codebooks / projections so output is identical across browser, Node, and CI —
 *  the studio's whole "no Math.random in the engine" determinism contract. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** L2-normalise in place and return the same array (identity vectors compare by
 *  cosine, so they must be unit length). */
export function l2Normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

/** Cosine similarity of two equal-length vectors. Shared by speaker-identity
 *  verification and codebook nearest-neighbour search. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}
