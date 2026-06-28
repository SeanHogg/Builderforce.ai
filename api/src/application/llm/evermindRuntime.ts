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

import { EvermindModelPackage, EvermindLM, BPETokenizer } from '@seanhogg/builderforce-memory-engine';

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
