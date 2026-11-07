/**
 * The ONE on-device task port (PRD 42 · Part B1).
 *
 * Utility work — a summary, a rewrite, a language check, a structured judgement — runs on
 * the device FIRST whatever model the conversation is pinned to. Every host supplies this
 * port once (web: `browserOnDeviceTasks()`, Rovr: the panel services, VS Code:
 * `modelRouting.ts`); consumers receive it and never branch on browser, vendor or API.
 *
 * Every method behaves the same way:
 *   - it returns its result, or `null` when the task cannot run here (the API is absent,
 *     the model is not ready, the input is over budget after chunking, the model refused,
 *     or its output failed validation) — `null` means "do what you did before";
 *   - it throws ONLY an `AbortError`;
 *   - it never touches the network.
 */

/** A JSON Schema document (the subset `@builderforce/json-schema` understands). */
export type JsonSchema = { readonly [key: string]: unknown };

export type OnDeviceTaskKind =
  | 'summarize' | 'rewrite' | 'proofread' | 'write'
  | 'detectLanguage' | 'translate' | 'json';

/** The runtime that served a call — a built-in model (`browser`) or a local engine. */
export type OnDeviceEngine = 'browser' | 'bfi' | 'webllm' | 'synapse' | 'ollama' | 'freetoken';

/** Who served ONE call (PRD 42 · Part F): its task kind, the engine and the bare model id. */
export interface ServedBy {
  kind: OnDeviceTaskKind;
  engine: OnDeviceEngine;
  model: string;
}

/** Per-call provenance: told who served THIS call (nothing shared, so concurrent calls cannot cross). */
export interface ServedOption {
  onServed?: (by: ServedBy) => void;
}

/**
 * One measured call (PRD 42 · Part F). `served`/`declined` come from the port; `replaced`
 * from a client-first caller whose device answer the server refused, so the cloud redid it.
 * A declined call has no engine. Token counts are estimates (≈4 chars each) of the call's
 * input and output, for the host's usage ledger.
 */
export interface OnDeviceTaskEvent {
  kind: OnDeviceTaskKind;
  engine: OnDeviceEngine | null;
  model: string | null;
  outcome: 'served' | 'declined' | 'replaced';
  ms: number;
  promptTokens?: number;
  completionTokens?: number;
}

/** A host's sink for {@link OnDeviceTaskEvent}s. Must not throw; a throw is swallowed. */
export type OnDeviceObserver = (event: OnDeviceTaskEvent) => void;

export interface SummarizeOptions extends ServedOption {
  kind: 'tldr' | 'key-points' | 'transcript';
  maxWords?: number;
  context?: string;
  signal?: AbortSignal;
}

export interface RewriteOptions extends ServedOption {
  tone?: 'more-formal' | 'as-is' | 'more-casual';
  length?: 'shorter' | 'as-is' | 'longer';
  instruction?: string;
  signal?: AbortSignal;
}

export interface WriteOptions extends ServedOption {
  context?: string;
  length?: 'short' | 'medium' | 'long';
  signal?: AbortSignal;
}

export interface TranslateOptions extends ServedOption {
  from?: string;
  to: string;
  signal?: AbortSignal;
}

export interface JsonTaskOptions extends ServedOption {
  system: string;
  user: string;
  schema: JsonSchema;
  signal?: AbortSignal;
}

export interface DetectedLanguage {
  lang: string;
  confidence: number;
}

export interface OnDeviceTasks {
  /** Which task kinds can run right now (ready models only). Cheap; memoized like probes. */
  available(): Promise<ReadonlySet<OnDeviceTaskKind>>;
  summarize(text: string, o: SummarizeOptions): Promise<string | null>;
  rewrite(text: string, o: RewriteOptions): Promise<string | null>;
  write(task: string, o?: WriteOptions): Promise<string | null>;
  proofread(text: string, o?: { signal?: AbortSignal } & ServedOption): Promise<string | null>;
  detectLanguage(text: string, o?: ServedOption): Promise<DetectedLanguage | null>;
  translate(text: string, o: TranslateOptions): Promise<string | null>;
  /** Structured output. The result is validated against `schema` before it is returned; invalid → null. */
  json<T>(o: JsonTaskOptions): Promise<T | null>;
}
