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
import { isServableText, type CoherenceFailure } from './textCoherence';
import {
  planEvermindToolCall,
  toOpenAIToolCall,
  type EvermindToolDecoder,
  type NormalizedTool,
  type ToolChoicePlan,
} from './evermindToolCall';

export { EXPORT_FORMATS };
export type { ExportFormat, ExportResult };

/** R2 key prefix under which published Evermind models live. */
export const EVERMIND_MODEL_ROOT = 'evermind-models';

export interface EvermindGenerateOptions {
  maxTokens?: number;
  temperature?: number;
  seed?: number;
  /**
   * Wall-clock budget for the generation loop, in ms.
   *
   * Evermind generation is SYNCHRONOUS CPU on the request path, so without this a
   * large head on a slow isolate simply runs until the Worker CPU limit kills the
   * request — a 5xx with no useful message and no partial answer. With it, the loop
   * stops at the budget and says so.
   */
  deadlineMs?: number;
}

export interface EvermindGeneration {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** True when the wall-clock budget stopped generation before `maxTokens` or a stop
   *  token did — the text is a real partial answer, not a complete one. */
  truncated: boolean;
  /** How long the generation loop actually took. */
  elapsedMs: number;
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

/** Neutral probe prompts a project chat head should be able to answer coherently.
 *  Fixed + generic (not project-specific) so the probe measures GENERATION QUALITY,
 *  not recall. Deterministic seeds keep the verdict reproducible. */
const COHERENCE_PROBE_PROMPTS: readonly string[] = [
  'Summarize the current status of the project.',
  'What has the team been working on recently?',
  'List the main things left to do.',
];

/** One graded probe generation. */
export interface EvermindCoherenceSample {
  prompt: string;
  text: string;
  coherent: boolean;
  /** The failing signal when `coherent` is false (null when it passed) — so an
   *  operator sees WHY a head was refused, not just that it was. */
  failure: CoherenceFailure | null;
  /** Short human-readable explanation of {@link failure} (empty when coherent). */
  detail: string;
}

/** A head's fitness-to-serve verdict (see {@link assessEvermindCoherence}). */
export interface EvermindCoherenceAssessment {
  ready: boolean;
  /** Fraction of probe samples that were substantive AND coherent (0..1). */
  passRate: number;
  samples: EvermindCoherenceSample[];
}

/**
 * Score an ALREADY-LOADED head's fitness to serve chat: generate from the neutral
 * probe prompts and grade each for coherence (`looksLikeCoherentText` + the
 * min-length bar). Pure + synchronous (no R2, no DB), so it serves BOTH callers —
 * the R2-backed {@link assessEvermindCoherence} used by the promote-to-inference
 * gate, and the learning coordinator, which already holds the freshly-merged model
 * in memory and must re-grade it before that version is allowed to answer anyone.
 * Deterministic seeds keep the verdict reproducible.
 */
export function assessLMCoherence(
  lm: EvermindLM,
  tok: BPETokenizer,
  opts: { minPassRate?: number } = {},
): EvermindCoherenceAssessment {
  const samples: EvermindCoherenceSample[] = COHERENCE_PROBE_PROMPTS.map((prompt, i) => {
    const text = lm.generateText(messagesToPrompt([{ role: 'user', content: prompt }]), tok, {
      maxNewTokens: 80,
      temperature: 0.7,
      seed: 1234 + i,
    });
    const verdict = isServableText(text, { context: prompt });
    return { prompt, text, coherent: verdict.coherent, failure: verdict.failure, detail: verdict.detail };
  });
  const passRate = samples.length ? samples.filter((s) => s.coherent).length / samples.length : 0;
  // Majority must be coherent by default — one lucky sample isn't fitness to serve.
  return { ready: passRate >= (opts.minPassRate ?? 0.5), passRate, samples };
}

/**
 * Benchmark a head's FITNESS TO SERVE CHAT by loading it from R2 and running
 * {@link assessLMCoherence}. This is the gate the promote-to-inference path consults
 * so a degraded head (the one that answered users in gibberish) can never be marked
 * inference-enabled. CPU-only, reuses the same R2 loader + per-isolate memo as
 * generation.
 */
export async function assessEvermindCoherence(
  store: ArtifactStore,
  ref: string,
  opts: { minPassRate?: number } = {},
): Promise<EvermindCoherenceAssessment> {
  const { lm, tok } = await loadEvermindModel(store, ref);
  return assessLMCoherence(lm, tok, opts);
}

/** One operator-run test-bench generation: what the head ACTUALLY produced for a
 *  chosen prompt, plus the same serve-time verdict the gateway applies to it. */
export interface EvermindProbeResult extends EvermindCoherenceSample {
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** True when the wall-clock budget stopped generation early — an incoherent verdict
   *  on a truncated sample is a statement about the clock, not about the model. */
  truncated: boolean;
  /** How long the generation took, so a slow head is visible before it times out. */
  elapsedMs: number;
}

/**
 * Test bench: run ONE operator-chosen prompt through a head and grade the output with
 * the SAME bar the serve path uses ({@link isServableText}). This is what makes "what
 * will this model actually produce?" answerable BEFORE inference is switched on — the
 * question the console previously had no way to answer (Validate only previewed which
 * memories would be recalled, never the generated text).
 *
 * Deterministic by default (`seed`), so a probe is reproducible and two operators
 * comparing notes see the same output.
 */
export async function probeEvermindGeneration(
  store: ArtifactStore,
  ref: string,
  prompt: string,
  opts: EvermindGenerateOptions = {},
): Promise<EvermindProbeResult> {
  const gen = await evermindGenerate(store, ref, [{ role: 'user', content: prompt }], {
    maxTokens: opts.maxTokens ?? 120,
    temperature: opts.temperature ?? 0.7,
    seed: opts.seed ?? 1234,
  });
  const verdict = isServableText(gen.content, { context: prompt });
  return {
    prompt,
    text: gen.content,
    coherent: verdict.coherent,
    failure: verdict.failure,
    detail: verdict.detail,
    usage: gen.usage,
    truncated: gen.truncated,
    elapsedMs: gen.elapsedMs,
  };
}

/**
 * Tokens generated between wall-clock checks.
 *
 * The deadline is enforced BETWEEN slices rather than between tokens because the
 * engine's `generate()` is one synchronous loop with no per-token hook. Slicing
 * costs nothing: `forward()` already recomputes the whole sequence for every token,
 * so re-entering it with `prompt + producedSoFar` is exactly the work the next token
 * was going to do anyway. Small enough that the overshoot past the deadline is one
 * slice, large enough that the re-encode is noise.
 */
const GENERATE_SLICE_TOKENS = 16;
/** Default wall-clock budget for one generation. Comfortably inside a Worker's CPU
 *  allowance, so the caller gets a partial answer plus `truncated` rather than a
 *  killed request. */
const DEFAULT_GENERATE_DEADLINE_MS = 8000;

/** Run generation for a published Evermind model and return text + token usage.
 *
 *  Deterministic for a given (prompt, seed, maxTokens): each slice derives its seed
 *  from the base seed and its index, so two operators running the same probe see the
 *  same text — the property the test bench actually promises. */
export async function evermindGenerate(
  store: ArtifactStore,
  ref: string,
  messages: Array<{ role?: unknown; content?: unknown }>,
  opts: EvermindGenerateOptions = {},
): Promise<EvermindGeneration> {
  const { lm, tok } = await loadEvermindModel(store, ref);
  const prompt = messagesToPrompt(messages);
  const maxTokens = opts.maxTokens ?? 256;
  const temperature = opts.temperature ?? 0.7;
  const baseSeed = opts.seed;
  const deadlineMs = opts.deadlineMs ?? DEFAULT_GENERATE_DEADLINE_MS;

  const started = Date.now();
  let content = '';
  let truncated = false;
  let produced = 0;
  let slice = 0;
  while (produced < maxTokens) {
    const want = Math.min(GENERATE_SLICE_TOKENS, maxTokens - produced);
    const chunk = lm.generateText(`${prompt}${content}`, tok, {
      maxNewTokens: want,
      temperature,
      ...(baseSeed != null ? { seed: baseSeed + slice } : {}),
    });
    slice++;
    // An empty slice means the model stopped producing; continuing would spin.
    if (!chunk) break;
    content += chunk;
    produced += want;
    if (Date.now() - started >= deadlineMs) {
      truncated = produced < maxTokens;
      break;
    }
  }

  const prompt_tokens = tok.encode(prompt).length;
  const completion_tokens = content ? tok.encode(content).length : 0;
  return {
    content,
    usage: { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens },
    truncated,
    elapsedMs: Date.now() - started,
  };
}

// ── Tool calling ─────────────────────────────────────────────────────────────
//
// The engine-backed half of {@link ./evermindToolCall}. That module owns the schema
// walk and the decision logic against a narrow port; this owns the only two things
// that need EvermindLM — scoring a continuation's likelihood, and generating one.

/**
 * A tool-decision prompt is rebuilt for every candidate and every argument, and each
 * one costs a full forward pass, so the conversation is capped rather than replayed
 * whole. Truncated from the LEFT: the most recent turns are what a tool choice
 * actually depends on.
 */
const MAX_TOOL_PROMPT_CHARS = 6000;

/** Log-probability the model assigned to `id` at a position, from that position's
 *  raw logits (log-softmax, computed max-shifted so long-tail logits don't overflow). */
function logProbOf(row: Float32Array, id: number): number {
  let max = -Infinity;
  for (let i = 0; i < row.length; i++) { const v = row[i]!; if (v > max) max = v; }
  if (!Number.isFinite(max)) return -Infinity;
  let sum = 0;
  for (let i = 0; i < row.length; i++) sum += Math.exp(row[i]! - max);
  const logit = id >= 0 && id < row.length ? row[id]! : -Infinity;
  return logit - (max + Math.log(sum));
}

/** A decoder plus the token usage it accumulated, so a tool-calling turn reports real
 *  numbers instead of zeros. */
export interface MeteredToolDecoder extends EvermindToolDecoder {
  usage(): { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * Bind an already-loaded head to the {@link EvermindToolDecoder} port.
 *
 * `score` is the interesting half: teacher forcing lets one forward pass over
 * `prompt + continuation` yield the log-prob of EVERY continuation token at once
 * (position `t` predicts token `t+1`), so ranking a candidate costs one pass rather
 * than one per token. The mean is returned — not the sum — so a long tool name is
 * not out-voted by a short one for its length alone.
 *
 * `generate` is greedy by default: a tool ARGUMENT is a value to get right, not prose
 * to vary, and determinism keeps a replayed run reproducible.
 */
export function createEvermindToolDecoder(lm: EvermindLM, tok: BPETokenizer, opts: { temperature?: number; seed?: number } = {}): MeteredToolDecoder {
  let promptTokens = 0;
  let completionTokens = 0;
  return {
    score(prompt: string, continuation: string): number {
      const contIds = tok.encode(continuation);
      if (contIds.length === 0) return -Infinity;
      // A leading token is required for the first continuation token to have a
      // position to be predicted FROM; an empty prompt gets the same id-0 prefix the
      // engine's own sampler uses.
      const promptIds = tok.encode(clampPromptText(prompt));
      const prefix = promptIds.length > 0 ? promptIds : [0];
      const { logits } = lm.forward([...prefix, ...contIds]);
      let total = 0;
      for (let i = 0; i < contIds.length; i++) {
        total += logProbOf(logits[prefix.length + i - 1]!, contIds[i]!);
      }
      promptTokens += prefix.length;
      completionTokens += contIds.length;
      return total / contIds.length;
    },
    generate(prompt: string, maxTokens: number): string {
      const text = lm.generateText(clampPromptText(prompt), tok, {
        maxNewTokens: maxTokens,
        temperature: opts.temperature ?? 0,
        ...(opts.seed != null ? { seed: opts.seed } : {}),
      });
      promptTokens += tok.encode(clampPromptText(prompt)).length;
      completionTokens += text ? tok.encode(text).length : 0;
      return text;
    },
    usage: () => ({ prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens }),
  };
}

/** Keep the tail of an over-long prompt (see {@link MAX_TOOL_PROMPT_CHARS}). */
function clampPromptText(prompt: string): string {
  return prompt.length <= MAX_TOOL_PROMPT_CHARS ? prompt : prompt.slice(prompt.length - MAX_TOOL_PROMPT_CHARS);
}

/** A tool-aware generation: either a planned call, or prose when the head chose to
 *  answer directly (`tool_choice: 'auto'`). */
export interface EvermindToolGeneration {
  call: { name: string; arguments: Record<string, unknown> } | null;
  /** Prose answer — populated only when `call` is null. */
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** Confidence separation behind the plan; see {@link EvermindToolPlan.margin}. */
  margin: number;
}

/**
 * Run a TOOL-BEARING request against a published Evermind model: plan a call by
 * constrained decoding, or fall through to ordinary prose when the head elected to
 * answer directly. The margin is returned unjudged — the vendor owns the policy of
 * what separation is good enough, because it owns the cascade behaviour.
 */
export async function evermindGenerateWithTools(
  store: ArtifactStore,
  ref: string,
  messages: Array<{ role?: unknown; content?: unknown }>,
  tools: NormalizedTool[],
  choice: ToolChoicePlan,
  opts: EvermindGenerateOptions = {},
): Promise<EvermindToolGeneration> {
  const { lm, tok } = await loadEvermindModel(store, ref);
  const decoder = createEvermindToolDecoder(lm, tok, {
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.seed != null ? { seed: opts.seed } : {}),
  });
  // The planner is given the conversation WITHOUT the `assistant:` primer — it is
  // choosing an action, not continuing a reply.
  const conversation = messagesToPrompt(messages).replace(/\nassistant:$/, '');
  const plan = planEvermindToolCall(decoder, conversation, tools, choice);
  if (plan.call) {
    return { call: plan.call, content: '', usage: decoder.usage(), margin: plan.margin };
  }
  // No tool: answer as usual. Generated through the same loaded head (and the same
  // per-isolate memo), so the prose path costs nothing extra to reach.
  const gen = await evermindGenerate(store, ref, messages, opts);
  const usage = decoder.usage();
  return {
    call: null,
    content: gen.content,
    usage: {
      prompt_tokens: usage.prompt_tokens + gen.usage.prompt_tokens,
      completion_tokens: usage.completion_tokens + gen.usage.completion_tokens,
      total_tokens: usage.total_tokens + gen.usage.total_tokens,
    },
    margin: plan.margin,
  };
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

/**
 * Build an OpenAI-compatible chat-completion object from a generation result.
 *
 * A planned tool call rides the same builder rather than a parallel one, so the
 * tool-calling turn and the prose turn cannot drift in shape: `tool_calls` on the
 * message plus the `tool_calls` finish reason is exactly what an agent loop switches
 * on, and `content` is null (not `''`) for a call — the OpenAI contract every client
 * SDK deserializes against.
 */
export function buildEvermindCompletion(
  // Only the text and the token counts shape a completion — deliberately NOT the
  // whole EvermindGeneration, so a caller that has just those (the tool planner, the
  // Studio bench) does not have to invent a `truncated`/`elapsedMs` it never measured.
  gen: Pick<EvermindGeneration, 'content' | 'usage'>,
  model: string,
  now: number = Date.now(),
  call?: { name: string; arguments: Record<string, unknown> } | null,
): Record<string, unknown> {
  const toolCalls = call ? [toOpenAIToolCall(call, `call_evermind_${now}`)] : [];
  return {
    id: `evermind-${now}`,
    object: 'chat.completion',
    created: Math.floor(now / 1000),
    model,
    choices: [{
      index: 0,
      message: toolCalls.length
        ? { role: 'assistant', content: null, tool_calls: toolCalls }
        : { role: 'assistant', content: gen.content },
      finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
    }],
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
