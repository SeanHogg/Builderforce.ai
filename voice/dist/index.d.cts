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
type NarrationEngineId = 'clone-client' | 'clone-server' | 'fallback';
/** One word's playback span — mirrors the studio engine + `studio_voiceovers`. */
interface WordTimestamp {
    word: string;
    startMs: number;
    endMs: number;
}
interface SynthesizeRequest {
    /** Text to speak (the LLM-generated words). */
    text: string;
    /** Speed multiplier (1 = natural). */
    speed?: number;
    /** BCP-47 language hint for the dubbing flows. */
    language?: string;
    signal?: AbortSignal;
}
interface NarrationResult {
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
interface NarrationProvider {
    readonly id: NarrationEngineId;
    /** Can this backend run for `voiceId` right now? */
    isAvailable(): Promise<boolean>;
    /** Reason it can't (shown before any silent fallback). Null when available. */
    unavailableReason(): Promise<string | null>;
    synthesize(req: SynthesizeRequest): Promise<NarrationResult>;
}
/** A ready-to-use narration engine: the resolved provider plus the honesty
 *  metadata, returned by {@link resolveNarrationEngine}. */
interface NarrationEngine {
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

/**
 * client-provider — Option A: on-device synthesis via the studio SSM clone
 * engine (WebGPU when present, CPU fallback otherwise). $0 marginal infra — the
 * model runs on the user's GPU, nothing is billed.
 *
 * Structurally typed against the studio engine (not a hard import) so
 * @seanhogg/builderforce-studio stays an OPTIONAL peer: a consumer that only
 * uses the server path never has to install it. The shapes below match
 * VoiceCloneEngine.synthesize / SpeakerEmbedding exactly.
 */

/** Minimal view of @seanhogg/builderforce-studio's SpeakerEmbedding. */
interface StudioSpeakerEmbedding {
    data: number[];
    dim: number;
    sampleRate: number;
}
/** Minimal view of @seanhogg/builderforce-studio's VoiceCloneEngine / provider. */
interface StudioCloneEngine {
    synthesize(opts: {
        text: string;
        speaker: StudioSpeakerEmbedding;
        speed?: number;
        signal?: AbortSignal;
    }): Promise<{
        pcm: Float32Array;
        sampleRate: number;
        durationMs: number;
        wordTimestamps: WordTimestamp[];
    }>;
}
interface ClientProviderOptions {
    /** A constructed studio clone engine (e.g. `new VoiceCloneEngine()` or
     *  `new SSMVoiceProvider().cloneEngine`). */
    engine: StudioCloneEngine;
    /** The enrolled speaker embedding for the voice being cloned. Enrol once
     *  (`engine.enroll(referencePcm)`) and persist it — it's just numbers. */
    speaker: StudioSpeakerEmbedding;
}
declare class ClientCloneProvider implements NarrationProvider {
    readonly id: "clone-client";
    private readonly engine;
    private readonly speaker;
    constructor(opts: ClientProviderOptions);
    isAvailable(): Promise<boolean>;
    unavailableReason(): Promise<string | null>;
    synthesize(req: SynthesizeRequest): Promise<NarrationResult>;
}

/**
 * fallback-provider — the honest non-cloned voice.
 *
 * When neither clone backend can run, the resolver falls back HERE — a named,
 * non-cloned voice (the consumer's existing Kokoro / Piper / Web Speech). The
 * point of the type is the contract: results are flagged `cloned: false` and the
 * resolver carries a human reason, so the UI says "Cloning unavailable — using
 * <name>" instead of silently swapping (PRD §7).
 *
 * It delegates to a consumer-supplied `synthesize`; with none provided it is
 * "unavailable" (with a reason) rather than pretending — the resolver then
 * exposes the reason and throws on use, never emitting fake audio.
 */

interface FallbackProviderOptions {
    /** Display name of the fallback voice, e.g. "Narrator (Kokoro)". */
    voiceName: string;
    /** The consumer's named-voice synthesizer. Omit to mark the fallback
     *  unavailable (resolver surfaces the reason instead of guessing). */
    synthesize?: (req: SynthesizeRequest) => Promise<Omit<NarrationResult, 'engineId' | 'cloned'>>;
}
declare class FallbackVoiceProvider implements NarrationProvider {
    readonly id: "fallback";
    readonly voiceName: string;
    private readonly delegate?;
    constructor(opts: FallbackProviderOptions);
    isAvailable(): Promise<boolean>;
    unavailableReason(): Promise<string | null>;
    synthesize(req: SynthesizeRequest): Promise<NarrationResult>;
}

/**
 * VoiceClient — the ergonomic entry point hired.video Studio constructs once and
 * reuses. It assembles the right providers for a `voiceId` (server always; the
 * on-device clone engine when one is supplied) and resolves them through the
 * shared seam, so callers write `client.narrate(voiceId, { text })` and get the
 * best available path with the honesty contract intact.
 */

interface VoiceClientOptions {
    /** Builderforce gateway API key. */
    apiKey: string;
    /** Gateway base URL. Defaults to https://api.builderforce.ai. */
    baseUrl?: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
    /** Optional on-device clone engine (`@seanhogg/builderforce-studio`'s
     *  VoiceCloneEngine). When provided AND a speaker embedding is supplied per
     *  resolve, the free WebGPU path is preferred over the metered server. */
    clientEngine?: StudioCloneEngine;
    /** Optional named non-cloned voice used when no clone backend is available. */
    fallback?: FallbackVoiceProvider;
}
interface ResolveOptions {
    /** Skip cloning and use the fallback voice (e.g. free tier). Default true. */
    preferClone?: boolean;
    /** Enrolled speaker embedding — enables the on-device path for this voice. */
    speaker?: StudioSpeakerEmbedding;
}
declare class VoiceClient {
    private readonly options;
    constructor(options: VoiceClientOptions);
    /** Build the candidate providers for a voice + resolve the best available. */
    resolve(voiceId: string, opts?: ResolveOptions): Promise<NarrationEngine>;
    /** One-shot: resolve then synthesize. The convenience the LLM flows call. */
    narrate(voiceId: string, req: SynthesizeRequest, opts?: ResolveOptions): Promise<NarrationResult>;
}

/**
 * resolve — the one seam every studio LLM flow routes text→speech through.
 *
 * `resolveNarrationEngine` takes a `voiceId` and a set of candidate providers,
 * picks the best AVAILABLE clone backend (on-device first — free + private —
 * then the metered server), and returns a ready engine. When no clone backend
 * can run it returns a fallback engine flagged `cloned: false` carrying the
 * reason, so callers badge "Cloning unavailable — using <voice>" and never swap
 * silently (PRD §7). `getEngineUnavailableReason` is the shared source of truth
 * for that message — the picker, the dubbing panel header, and the pitch button
 * all read it instead of each recomputing "can I clone right now."
 */

interface ResolveNarrationOptions {
    /** The `studio_voice_clones.id` to speak in. */
    voiceId: string;
    /** Candidate clone backends (e.g. [clientProvider, serverProvider]). Ranked
     *  internally — on-device before server — so callers pass them in any order. */
    providers: NarrationProvider[];
    /** Named non-cloned voice used when no clone backend is available. */
    fallback?: NarrationProvider;
    /** When false, skip cloning entirely and go straight to the fallback voice
     *  (e.g. a free-tier user). Default true. */
    preferClone?: boolean;
}
/**
 * The shared "can I clone right now?" check. Returns null when at least one clone
 * provider is available, otherwise the aggregated reason string. This is the
 * single source of truth the UI reads — do not re-derive availability elsewhere.
 */
declare function getEngineUnavailableReason(providers: NarrationProvider[]): Promise<string | null>;
/** Resolve a ready-to-use narration engine for `voiceId`. Always returns an
 *  engine (never throws here); failures surface at `synthesize` time or via
 *  `fallbackReason`, so the caller can render an honest UI state up front. */
declare function resolveNarrationEngine(options: ResolveNarrationOptions): Promise<NarrationEngine>;

/**
 * http — a minimal bearer-auth fetch wrapper for the gateway synthesize call.
 *
 * Deliberately tiny (one POST shape) rather than re-pulling the full
 * @seanhogg/builderforce-sdk HttpClient: this package has exactly one server
 * endpoint to hit. Same auth + timeout + typed-error conventions as the SDK so
 * behaviour is familiar.
 */
declare class VoiceApiError extends Error {
    readonly status: number;
    readonly code?: string | undefined;
    constructor(message: string, status: number, code?: string | undefined);
}

/**
 * server-provider — Option B: synthesis through the metered gateway endpoint.
 *
 * Calls `POST /api/studio/voice-clones/:id/synthesize`, which loads the
 * license-checked reference sample, runs the clone, persists to
 * `studio_voiceovers`, bills the token ledger (`voice_clone_synthesis`), and is
 * read-through cached on sha256(cloneId + text + speed + lang). This is the path
 * that makes cloning audible on every device — including mobile / Safari with no
 * WebGPU — which is why the PRD ships it first.
 *
 * "Available" = a client is configured. The server is the authority on licensing
 * and entitlement; it returns 402/403 if the caller can't use this voice, surfaced
 * as a VoiceApiError the resolver turns into a fallback reason.
 */

interface ServerProviderOptions {
    apiKey: string;
    voiceId: string;
    baseUrl?: string;
    fetchFn?: typeof fetch;
    timeoutMs?: number;
}
declare class ServerCloneProvider implements NarrationProvider {
    readonly id: "clone-server";
    private readonly http;
    private readonly voiceId;
    constructor(opts: ServerProviderOptions);
    isAvailable(): Promise<boolean>;
    unavailableReason(): Promise<string | null>;
    synthesize(req: SynthesizeRequest): Promise<NarrationResult>;
}
/** Narrow helper: is this error a licensing/entitlement denial (vs. transient)?
 *  The resolver uses it to phrase the fallback reason. */
declare function isEntitlementError(err: unknown): err is VoiceApiError;

export { ClientCloneProvider, type ClientProviderOptions, type FallbackProviderOptions, FallbackVoiceProvider, type NarrationEngine, type NarrationEngineId, type NarrationProvider, type NarrationResult, type ResolveNarrationOptions, type ResolveOptions, ServerCloneProvider, type ServerProviderOptions, type StudioCloneEngine, type StudioSpeakerEmbedding, type SynthesizeRequest, VoiceApiError, VoiceClient, type VoiceClientOptions, type WordTimestamp, getEngineUnavailableReason, isEntitlementError, resolveNarrationEngine };
