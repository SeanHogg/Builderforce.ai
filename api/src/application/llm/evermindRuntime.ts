/**
 * Evermind generation runtime — the gateway's OWN LLM backend.
 *
 * This is what makes "use our own LLM" actually true: instead of every chat
 * request going to an external frontier vendor, a request pinned to a published
 * Evermind model is served HERE, by loading the tenant's packaged `.evermind`
 * artifact from R2 and running the builderforce-memory EvermindLM on-CPU inside
 * the Worker (the model is zero-dependency pure TS). It is the generation half
 * of the Evermind story; the SSM is no longer memory-only.
 *
 * The same helpers back both consumers (DRY): the `evermind` vendor module
 * (gateway `/v1/chat/completions`) and the Studio publish/test routes.
 *
 * Artifact layout in R2 (UPLOADS), written by the publish flow:
 *   <ref>/model.evermind   — EvermindModelPackage.toBlob()
 *   <ref>/tokenizer.json   — { vocab, merges } for text I/O
 * `<ref>` is versioned at publish time, so it is immutable — which is why the
 * per-isolate loaded-model cache below is safe (a re-publish gets a new ref).
 */

import {
  EvermindModelPackage,
  EvermindLM,
  BPETokenizer,
  benchmarkText,
  exportEvermind,
  generateVideo,
  EXPORT_FORMATS,
  type ExportFormat,
  type ExportResult,
  type VideoRVQCodec,
  type EvermindModality,
} from '@seanhogg/builderforce-memory-engine';

export { EXPORT_FORMATS };
export type { ExportFormat, ExportResult };

/** R2 key prefix under which published Evermind models live. */
export const EVERMIND_MODEL_ROOT = 'evermind-models';

export interface EvermindGenerateOptions {
  maxTokens?: number;
  temperature?: number;
  seed?: number;
}

export interface EvermindGeneration {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface LoadedModel {
  lm: EvermindLM;
  tok: BPETokenizer;
}

/**
 * Per-isolate memo of loaded models, keyed by their IMMUTABLE versioned ref. A
 * loaded model is a deserialized object graph (weights + tokenizer) that cannot
 * be serialized into KV, so this is the legitimate exception to the shared
 * read-through cache: it is per-isolate compute-memoization, not cross-isolate
 * data. Re-publishing a model produces a new ref, so a stale entry can never be
 * served. Bounded by the number of distinct models an isolate touches.
 */
const MODEL_CACHE = new Map<string, LoadedModel>();

/** Minimal slice of the R2 binding we use (so this stays test-mockable). */
export interface ArtifactStore {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> } | null>;
}

/** Load (and cache) a published model + tokenizer from R2 by its ref. */
export async function loadEvermindModel(store: ArtifactStore, ref: string): Promise<LoadedModel> {
  const cached = MODEL_CACHE.get(ref);
  if (cached) return cached;

  const modelObj = await store.get(`${ref}/model.evermind`);
  if (!modelObj) throw new Error(`Evermind model artifact not found at ${ref}/model.evermind`);
  const pkg = EvermindModelPackage.fromBlob(await modelObj.arrayBuffer());
  const verdict = pkg.validate();
  if (!verdict.ok) throw new Error(`invalid .evermind artifact: ${verdict.errors.join('; ')}`);
  const modality = pkg.manifest.modality ?? 'text';
  if (modality !== 'text') {
    throw new Error(`Evermind artifact at ${ref} is a '${modality}' model — use the media generation endpoint, not text chat`);
  }
  const lm = pkg.loadLM();

  const tokObj = await store.get(`${ref}/tokenizer.json`);
  if (!tokObj) throw new Error(`Evermind tokenizer not found at ${ref}/tokenizer.json`);
  const tokDesc = JSON.parse(await tokObj.text()) as { vocab: Record<string, number>; merges: string[] };
  const tok = new BPETokenizer();
  tok.loadFromObjects(tokDesc.vocab, tokDesc.merges);

  const loaded: LoadedModel = { lm, tok };
  MODEL_CACHE.set(ref, loaded);
  return loaded;
}

/** Flatten chat messages into a single continuation prompt for the LM. */
export function messagesToPrompt(messages: Array<{ role?: unknown; content?: unknown }>): string {
  const lines = messages
    .map((m) => {
      const role = typeof m.role === 'string' ? m.role : 'user';
      const content = typeof m.content === 'string' ? m.content : '';
      return content ? `${role}: ${content}` : '';
    })
    .filter(Boolean);
  return `${lines.join('\n')}\nassistant:`;
}

/** Run generation for a published Evermind model and return text + token usage. */
export async function evermindGenerate(
  store: ArtifactStore,
  ref: string,
  messages: Array<{ role?: unknown; content?: unknown }>,
  opts: EvermindGenerateOptions = {},
): Promise<EvermindGeneration> {
  const { lm, tok } = await loadEvermindModel(store, ref);
  const prompt = messagesToPrompt(messages);
  const content = lm.generateText(prompt, tok, {
    maxNewTokens: opts.maxTokens ?? 256,
    temperature: opts.temperature ?? 0.7,
    ...(opts.seed != null ? { seed: opts.seed } : {}),
  });
  const prompt_tokens = tok.encode(prompt).length;
  const completion_tokens = content ? tok.encode(content).length : 0;
  return { content, usage: { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens } };
}

/** Scorecard for a PUBLISHED Evermind model, scored against held-out text. */
export interface EvermindBenchmarkResult {
  /** Total tokens scored across the held-out corpus. */
  tokens: number;
  /** Held-out perplexity (lower is better). */
  perplexity: number;
  /** Bits per token (lower is better). */
  bitsPerToken: number;
  /** Next-token top-1 accuracy (0..1). */
  top1Accuracy: number;
  /** Next-token top-k accuracy (0..1). */
  topKAccuracy: number;
  /** The k used for {@link topKAccuracy}. */
  topK: number;
  /** Forward throughput (tokens/sec). */
  tokensPerSecond?: number;
  /** The model's tokenizer vocabulary size (baseline for the verdict). */
  vocabSize: number;
  /** A short qualitative generation sample from the model. */
  sample: string;
}

/**
 * Benchmark a PUBLISHED `.evermind` model against a held-out corpus, on the
 * server, by reusing the same R2 loader the gateway/test paths use (DRY). This
 * scores the user's ACTUAL trained artifact — tokenized with the model's OWN
 * persisted tokenizer, so the token ids are coherent with the weights — rather
 * than a freshly-trained throwaway model. CPU-only, zero-dep; the loaded-model
 * memo means repeated scoring of the same ref pays the deserialize cost once.
 */
export async function benchmarkEvermind(
  store: ArtifactStore,
  ref: string,
  corpus: string,
  opts: { topK?: number; samplePrompt?: string } = {},
): Promise<EvermindBenchmarkResult> {
  const { lm, tok } = await loadEvermindModel(store, ref);
  const report = benchmarkText(lm, tok, corpus, { topK: opts.topK ?? 5, measureLatency: true });
  const sample = lm.generateText(opts.samplePrompt ?? 'The', tok, {
    maxNewTokens: 24,
    temperature: 0.7,
    seed: 1,
  });
  return {
    tokens: report.tokens,
    perplexity: report.perplexity,
    bitsPerToken: report.bitsPerToken,
    top1Accuracy: report.top1Accuracy,
    topKAccuracy: report.topKAccuracy,
    topK: report.topK,
    ...(report.tokensPerSecond != null ? { tokensPerSecond: report.tokensPerSecond } : {}),
    vocabSize: tok.vocabSize,
    sample,
  };
}

/**
 * Export a PUBLISHED `.evermind` model to a portable format (safetensors / ONNX /
 * GGUF, or a full Hugging Face repo bundle), reusing the same R2 loader the
 * gateway/test/benchmark paths use (DRY). The engine's export subsystem reads the
 * model through its public surface only and emits the file set; no external
 * credential is involved (pushing the bundle to a hub is a separate step). The
 * tokenizer is passed so the "huggingface" bundle can emit a real `tokenizer.json`.
 */
export async function exportEvermindArtifact(
  store: ArtifactStore,
  ref: string,
  format: ExportFormat,
  opts: { fp16?: boolean; name?: string; license?: string } = {},
): Promise<ExportResult> {
  const { lm, tok } = await loadEvermindModel(store, ref);
  return exportEvermind(
    lm,
    format,
    {
      ...(opts.fp16 != null ? { fp16: opts.fp16 } : {}),
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.license ? { license: opts.license } : {}),
    },
    tok,
  );
}

/** Build an OpenAI-compatible chat-completion object from a generation result. */
export function buildEvermindCompletion(
  gen: EvermindGeneration,
  model: string,
  now: number = Date.now(),
): Record<string, unknown> {
  return {
    id: `evermind-${now}`,
    object: 'chat.completion',
    created: Math.floor(now / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: gen.content }, finish_reason: 'stop' }],
    usage: gen.usage,
  };
}

// ── Media (video / image) generation ──────────────────────────────────────────
//
// Text and media share ONE generator (EvermindLM). A media `.evermind` bundles a
// VideoRVQCodec inside the artifact, so serving is: load package → loadMediaLM()
// → run the generator → decode tokens back to frames. Reuses the same R2 loader
// and per-isolate memo pattern as the text path (DRY).

/** Upper bound on frames returned per request (keeps the response payload bounded). */
const MAX_MEDIA_FRAMES = 64;

export interface EvermindMediaGenerateOptions {
  /** Text conditioning (only used when the model has a text region + tokenizer). */
  prompt?: string;
  /** Cap on frames to return. Default 1 (image) / 16 (video), hard-capped at 64. */
  maxFrames?: number;
  /** Cap on generated tokens. Default sizes to `maxFrames` worth of tokens. */
  maxTokens?: number;
  temperature?: number;
  seed?: number;
}

export interface EvermindMediaGeneration {
  modality: 'video' | 'image';
  width: number;
  height: number;
  channels: number;
  frameCount: number;
  /** Base64 of each frame's bytes, row-major `((y·W)+x)·C+ch`, 0–255. */
  frames: string[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface LoadedMediaModel {
  lm: EvermindLM;
  codec: VideoRVQCodec;
  modality: EvermindModality;
  /** Present only for text-conditioned media models (textVocabSize > 0). */
  tok?: BPETokenizer;
}

/** Per-isolate memo of loaded media models, keyed by immutable versioned ref (see {@link MODEL_CACHE}). */
const MEDIA_CACHE = new Map<string, LoadedMediaModel>();

/** Load (and cache) a published video/image model + its bundled codec from R2. */
export async function loadEvermindMediaModel(store: ArtifactStore, ref: string): Promise<LoadedMediaModel> {
  const cached = MEDIA_CACHE.get(ref);
  if (cached) return cached;

  const modelObj = await store.get(`${ref}/model.evermind`);
  if (!modelObj) throw new Error(`Evermind model artifact not found at ${ref}/model.evermind`);
  const pkg = EvermindModelPackage.fromBlob(await modelObj.arrayBuffer());
  const verdict = pkg.validate();
  if (!verdict.ok) throw new Error(`invalid .evermind artifact: ${verdict.errors.join('; ')}`);
  const modality = pkg.manifest.modality ?? 'text';
  if (modality !== 'video' && modality !== 'image') {
    throw new Error(`Evermind artifact at ${ref} is a '${modality}' model, not video/image`);
  }
  const { lm, codec } = pkg.loadMediaLM();
  const loaded: LoadedMediaModel = { lm, codec, modality };

  // Text-conditioned media models carry a tokenizer for the caption prefix.
  if (codec.vocab.textVocabSize > 0) {
    const tokObj = await store.get(`${ref}/tokenizer.json`);
    if (tokObj) {
      const tokDesc = JSON.parse(await tokObj.text()) as { vocab: Record<string, number>; merges: string[] };
      const tok = new BPETokenizer();
      tok.loadFromObjects(tokDesc.vocab, tokDesc.merges);
      loaded.tok = tok;
    }
  }

  MEDIA_CACHE.set(ref, loaded);
  return loaded;
}

/** Base64 of a single [0,1] frame quantized to 0–255 bytes. */
function frameToBase64(frame: Float32Array): string {
  const bytes = new Uint8Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const v = Math.round((frame[i] ?? 0) * 255);
    bytes[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/**
 * Generate video/image from a published media Evermind model: run the generator
 * over the (optionally text-conditioned) prompt and decode the emitted tokens to
 * frames via the bundled codec. Returns base64 frames + token usage.
 */
export async function evermindGenerateMedia(
  store: ArtifactStore,
  ref: string,
  opts: EvermindMediaGenerateOptions = {},
): Promise<EvermindMediaGeneration> {
  const { lm, codec, modality, tok } = await loadEvermindMediaModel(store, ref);

  // Caption prefix — only when the model actually has a text region + tokenizer.
  let promptTokens: number[] = [];
  if (tok && codec.vocab.textVocabSize > 0 && opts.prompt) {
    promptTokens = tok.encode(opts.prompt).filter((id) => id < codec.vocab.textVocabSize);
  }

  const maxFrames = Math.min(Math.max(1, opts.maxFrames ?? (modality === 'image' ? 1 : 16)), MAX_MEDIA_FRAMES);
  const maxNewTokens = opts.maxTokens ?? (codec.tokensPerFrame + 1) * maxFrames + 2;
  const { video, tokens } = generateVideo(lm, codec, promptTokens, {
    maxNewTokens,
    temperature: opts.temperature ?? 0.7,
    ...(opts.seed != null ? { seed: opts.seed } : {}),
  });

  const frames = video.slice(0, modality === 'image' ? 1 : maxFrames).map(frameToBase64);
  const prompt_tokens = promptTokens.length;
  const completion_tokens = tokens.length;
  return {
    // loadEvermindMediaModel guarantees video|image (it throws on 'text').
    modality: modality as 'video' | 'image',
    width: codec.width,
    height: codec.height,
    channels: codec.channels,
    frameCount: frames.length,
    frames,
    usage: { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens },
  };
}
