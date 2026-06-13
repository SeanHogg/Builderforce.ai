/**
 * Public types for @seanhogg/builderforce-voice.
 *
 * The package's job is one seam — `resolveNarrationEngine` — that turns a
 * `voiceId` (a `studio_voice_clones.id`) + text into audio, choosing the best
 * available backend and degrading honestly. Every studio LLM flow (AI script →
 * narration, dubbing, the value-prop/pitch builder) routes through it, so none
 * of them re-implements provider selection or the license/fallback logic.
 */

/** Which backend actually produced (or would produce) the audio. */
export type NarrationEngineId = 'clone-client' | 'clone-server' | 'fallback';

/** One word's playback span — mirrors the studio engine + `studio_voiceovers`. */
export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
}

export interface SynthesizeRequest {
  /** Text to speak (the LLM-generated words). */
  text: string;
  /** Speed multiplier (1 = natural). */
  speed?: number;
  /** BCP-47 language hint for the dubbing flows. */
  language?: string;
  signal?: AbortSignal;
}

export interface NarrationResult {
  /** Engine that produced this audio. */
  engineId: NarrationEngineId;
  /** True when the audio is in the requested cloned voice; false when this is a
   *  named-voice fallback (the honesty contract — callers can badge it). */
  cloned: boolean;
  /** Server path: a fetchable URL to the synthesized audio (R2-backed). */
  audioUrl?: string;
  /** Server path: the R2 object key, for persistence/caching. */
  audioKey?: string;
  /** Client path: raw mono PCM in [-1, 1]. */
  pcm?: Float32Array;
  /** Sample rate when `pcm` is present. */
  sampleRate?: number;
  durationMs: number;
  wordTimestamps: WordTimestamp[];
}

/** A swappable narration backend. The package ships server + fallback; the
 *  on-device clone provider is wired when a studio engine is supplied. Resolution
 *  picks one; consumers never branch on `id`. */
export interface NarrationProvider {
  readonly id: NarrationEngineId;
  /** Can this backend run for `voiceId` right now? */
  isAvailable(): Promise<boolean>;
  /** Reason it can't (shown before any silent fallback). Null when available. */
  unavailableReason(): Promise<string | null>;
  synthesize(req: SynthesizeRequest): Promise<NarrationResult>;
}

/** A ready-to-use narration engine: the resolved provider plus the honesty
 *  metadata, returned by {@link resolveNarrationEngine}. */
export interface NarrationEngine {
  engineId: NarrationEngineId;
  /** True when the resolved engine clones the voice; false when it's a fallback. */
  cloned: boolean;
  /** Present (and non-null) ONLY when `cloned` is false: the human-readable
   *  reason cloning was unavailable, e.g. "Cloning unavailable — using Narrator".
   *  The single source of truth for the UI's "can I clone right now" message. */
  fallbackReason: string | null;
  /** The voice this engine speaks in. */
  voiceId: string;
  synthesize(req: SynthesizeRequest): Promise<NarrationResult>;
}
