/**
 * The shared shape of a built-in task adapter and the ONE way its sessions are opened
 * (PRD 42 · Part B2). This file reads NO global — each API is detected in exactly one
 * adapter file, which hands its factory here.
 *
 * Rules every adapter inherits from here, so none re-implements them:
 *   - availability is asked, never acted on: anything but `available` (including
 *     `downloadable`/`downloading`) reads as "not here" — a task NEVER starts a download;
 *   - any failure is `null`; only an `AbortError` is rethrown;
 *   - a session never outlives the call that opened it (except a budget's, until released).
 */

import type {
  DetectedLanguage, JsonTaskOptions, OnDeviceTaskKind, RewriteOptions, SummarizeOptions, TranslateOptions, WriteOptions,
} from '../onDevice/onDeviceTasks';

export type AdapterId =
  | 'summarizer' | 'rewriter' | 'writer' | 'proofreader' | 'languageDetector' | 'translator'
  | 'prompt' | 'pageEngine';

/** A session's input window and a way to measure text against it. */
export interface InputBudget {
  /** Input tokens the session accepts. */
  limit: number;
  /** Tokens `text` would use; ≈4 chars per token when the build cannot measure. */
  measure(text: string, signal?: AbortSignal): Promise<number>;
  /** Frees the session behind the budget. */
  release(): void;
}

/** One built-in API as the port sees it. Each method is optional: absent = not this API's task. */
export interface BuiltInAdapter {
  readonly id: AdapterId;
  /** Which task kinds this adapter serves. */
  readonly kinds: readonly OnDeviceTaskKind[];
  /** True when the API is present AND its model is `available`. Never starts a download. */
  ready(): Promise<boolean>;
  /** The input window for a summary, or null when it cannot be opened. */
  budget?(signal?: AbortSignal): Promise<InputBudget | null>;
  summarize?(text: string, o: SummarizeOptions): Promise<string | null>;
  rewrite?(text: string, o: RewriteOptions): Promise<string | null>;
  write?(task: string, o?: WriteOptions): Promise<string | null>;
  proofread?(text: string, o?: { signal?: AbortSignal }): Promise<string | null>;
  detectLanguage?(text: string): Promise<DetectedLanguage | null>;
  translate?(text: string, o: TranslateOptions): Promise<string | null>;
  /**
   * Fetch this API's model (PRD 42 · A2). Calls `create()` SYNCHRONOUSLY (inside the user
   * activation); resolves when done or when the browser refuses (a refusal is not an
   * error here); rejects only on abort. Only the picker's Download reaches this.
   */
  download?(o: AdapterDownloadOptions): Promise<void>;
  /** The parsed JSON the model produced, UNVALIDATED — the port validates it. */
  json?(o: JsonTaskOptions): Promise<unknown | null>;
}

/** The structural minimum of a task API's static factory. */
export interface TaskApiFactory<S, C extends object = object> {
  availability(options?: C): Promise<string>;
  create(options?: C & { signal?: AbortSignal; monitor?: (monitor: EventTarget) => void }): Promise<S>;
}

/** What an adapter's `download` is given (PRD 42 · A2). */
export interface AdapterDownloadOptions {
  /** This model's own 0..1 fraction. */
  onProgress(fraction: number): void;
  signal?: AbortSignal;
  /** The viewer's locale (BCP-47), for the Translator's language pair. */
  locale?: string;
}

/** A `downloadprogress` event as a 0..1 fraction. Current builds report `loaded` already
 *  as a fraction of 1; older builds report bytes with a `total`. */
export function progressFraction(event: unknown): number | undefined {
  const { loaded, total } = (event ?? {}) as { loaded?: unknown; total?: unknown };
  if (typeof loaded !== 'number' || !Number.isFinite(loaded)) return undefined;
  const fraction = typeof total === 'number' && Number.isFinite(total) && total > 1 ? loaded / total : loaded;
  return Math.max(0, Math.min(1, fraction));
}

/** The structural minimum of a task API's session. */
export interface TaskApiSession {
  destroy?(): void;
  inputQuota?: number;
  measureInputUsage?(input: string, opts?: { signal?: AbortSignal }): Promise<number>;
}

const APPROX_CHARS_PER_TOKEN = 4;

export function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** Run `fn`; any failure but an abort is `null`. */
export async function nullOnFailure<T>(fn: () => Promise<T | null>, signal?: AbortSignal): Promise<T | null> {
  throwIfAborted(signal);
  try {
    return await fn();
  } catch (e) {
    if (isAbortError(e) || signal?.aborted) throw abortError();
    return null;
  }
}

/** True when the factory exists and reports `available` for these options. */
export async function taskApiReady<C extends object>(
  factory: TaskApiFactory<TaskApiSession, C> | null,
  options?: C,
): Promise<boolean> {
  if (!factory) return false;
  try {
    return (await factory.availability(options)) === 'available';
  } catch {
    return false;
  }
}

/** Open a session for `use`, destroy it after; null when the API is absent or not ready. */
export function withTaskSession<S extends TaskApiSession, C extends object, R>(
  factory: TaskApiFactory<S, C> | null,
  options: C,
  signal: AbortSignal | undefined,
  use: (session: S) => Promise<R | null>,
): Promise<R | null> {
  return nullOnFailure(async () => {
    if (!(await taskApiReady(factory, options))) return null;
    const session = await factory!.create({ ...options, ...(signal ? { signal } : {}) });
    try {
      return await use(session);
    } finally {
      session.destroy?.();
    }
  }, signal);
}

/**
 * The ONE task-API download: `create()` starts before any await (the click's activation),
 * progress is reported, the session is destroyed. A refusal resolves; an abort rejects.
 */
export async function downloadTaskModel<S extends TaskApiSession, C extends object>(
  factory: TaskApiFactory<S, C> | null,
  options: C,
  o: AdapterDownloadOptions,
): Promise<void> {
  if (!factory) return;
  throwIfAborted(o.signal);
  try {
    const session = await factory.create({
      ...options,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          const fraction = progressFraction(event);
          if (fraction !== undefined) o.onProgress(fraction);
        });
      },
      ...(o.signal ? { signal: o.signal } : {}),
    });
    session.destroy?.();
  } catch (e) {
    if (isAbortError(e) || o.signal?.aborted) throw abortError();
  }
}

/** An {@link InputBudget} over a session, falling back to ≈4 chars/token when it cannot measure. */
export function sessionBudget(session: TaskApiSession): InputBudget | null {
  const limit = session.inputQuota;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return null;
  return {
    limit,
    measure: async (text, signal) => {
      try {
        if (session.measureInputUsage) return await session.measureInputUsage(text, signal ? { signal } : undefined);
      } catch {
        // fall through to the estimate
      }
      return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
    },
    release: () => session.destroy?.(),
  };
}

/** The estimate used when no session can measure. */
export const approxTokens = (text: string): number => Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
