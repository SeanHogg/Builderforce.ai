/**
 * Chrome's built-in model, reached through the Prompt API — the ONE detection of it.
 *
 * Two surfaces drive the same browser engine: the Brain's local-first path (the in-page
 * shim in `browserEngine.ts`) and the web app's `PromptApiModelProvider`. Both need the
 * same three answers — is the surface there at all, is the model ready, and how does a
 * stream of output become deltas — so they live here once, structurally typed so no host
 * depends on an ambient DOM lib that may not have caught up with the API yet.
 *
 * The current surface is the `LanguageModel` global (Chrome 138+); older builds exposed
 * `self.ai.languageModel` with a `capabilities()` probe instead of `availability()`. Both
 * are read, and both answers normalise to the current vocabulary.
 */

/** One message of a session's seeded conversation. */
export interface PromptApiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** A live session — minimal structural typing of what the hosts call. */
export interface PromptApiSession {
  prompt(input: string, opts?: { signal?: AbortSignal }): Promise<string>;
  promptStreaming(input: string, opts?: { signal?: AbortSignal }): ReadableStream<string>;
  /** Forks the conversation, PRESERVING the original session's initial prompts —
   *  it takes only `{ signal }`, so it can never install a different system
   *  prompt. Changing the system prompt therefore requires a fresh `create()`. */
  clone(opts?: { signal?: AbortSignal }): Promise<PromptApiSession>;
  destroy(): void;
  readonly inputUsage?: number;
  readonly inputQuota?: number;
  /** Legacy (pre-138) name of the session's token budget. */
  readonly maxTokens?: number;
  /** Tokens `input` would add to the session (138+). */
  measureInputUsage?(input: string, opts?: { signal?: AbortSignal }): Promise<number>;
  /** Legacy (pre-138) token accounting; guarded because newer builds drop it. */
  countPromptTokens?(input: string): Promise<number>;
}

/** The current availability vocabulary. */
export type PromptApiAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

export interface PromptApiFactory {
  availability?(): Promise<PromptApiAvailability | 'readily'>;
  /** Legacy (pre-138) readiness probe. */
  capabilities?(): Promise<{ available?: 'readily' | 'after-download' | 'no' }>;
  create(opts?: {
    temperature?: number;
    topK?: number;
    initialPrompts?: PromptApiMessage[];
    signal?: AbortSignal;
    monitor?: (m: EventTarget) => void;
  }): Promise<PromptApiSession>;
}

/** Resolve the Prompt API factory across the current global (`LanguageModel`) and
 *  the legacy `self.ai.languageModel` surface, or null when the browser lacks it. */
export function promptApiFactory(): PromptApiFactory | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as {
    LanguageModel?: PromptApiFactory;
    ai?: { languageModel?: PromptApiFactory };
  };
  return g.LanguageModel ?? g.ai?.languageModel ?? null;
}

/** True when this browser exposes the built-in Prompt API surface at all.
 *  (Actual model availability is async — see {@link promptApiAvailability}.) */
export function hasPromptApi(): boolean {
  return promptApiFactory() !== null;
}

/**
 * What the browser says about its model, in the current vocabulary. Asking NEVER starts
 * a download — only `create()` does — so a router may ask freely. Any failure reads as
 * `unavailable`.
 */
export async function promptApiAvailability(
  factory: PromptApiFactory | null = promptApiFactory(),
): Promise<PromptApiAvailability> {
  if (!factory) return 'unavailable';
  try {
    if (factory.availability) {
      const status = await factory.availability();
      return status === 'readily' ? 'available' : status;
    }
    if (factory.capabilities) {
      const { available } = await factory.capabilities();
      return available === 'readily' ? 'available' : available === 'after-download' ? 'downloadable' : 'unavailable';
    }
  } catch {
    // A throwing probe (policy-disabled, a crashed component) is an unavailable model.
  }
  return 'unavailable';
}

/** The session's input budget in tokens, under either generation's name. */
export function promptApiInputQuota(session: PromptApiSession): number | undefined {
  const quota = session.inputQuota ?? session.maxTokens;
  return typeof quota === 'number' && Number.isFinite(quota) && quota > 0 ? quota : undefined;
}

/** Tokens `input` would add to the session, or undefined when the build cannot say. */
export async function promptApiMeasure(
  session: PromptApiSession,
  input: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  if (session.measureInputUsage) return session.measureInputUsage(input, signal ? { signal } : undefined);
  if (session.countPromptTokens) return session.countPromptTokens(input);
  return undefined;
}

/**
 * The deltas of a `promptStreaming` stream. Chrome ≥138 yields incremental deltas; older
 * builds yielded the full cumulative string — normalised here so a consumer never
 * double-counts. Releases the reader however iteration ends.
 */
export async function* promptStreamDeltas(stream: ReadableStream<string>): AsyncGenerator<string> {
  const reader = stream.getReader();
  let full = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (typeof value !== 'string') continue;
      const cumulative = value.startsWith(full);
      const delta = cumulative ? value.slice(full.length) : value;
      full = cumulative ? value : full + value;
      if (delta) yield delta;
    }
  } finally {
    reader.releaseLock();
  }
}
