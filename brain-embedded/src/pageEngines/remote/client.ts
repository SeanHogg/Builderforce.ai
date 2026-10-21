/**
 * The CALLER side of a remote page engine: a {@link PageEngine} whose probe and chat run
 * over a port (`protocol.ts`) to engines living elsewhere — the editor host's view of its
 * webview and worker, a page's view of its `bfi` Web Worker. Because each proxy IS a
 * `PageEngine`, nothing downstream changes: the fetch shim (`pageEnginesFetch`) and the
 * local-first plan read it like an in-place engine.
 *
 * Failure is quiet by contract: with no port for a runtime a probe answers null and a
 * chat is refused with a 503 the failover routes around; a port that goes away ends an
 * answer in flight with an error, never a hang; an abort here aborts the engine there.
 * A far side that goes SILENT — no chunk and no `pageEngine.alive` for
 * {@link PAGE_ENGINE_CHAT_IDLE_MS} — ends the answer the same way
 * ({@link PAGE_ENGINE_DETACHED}): a port can vanish without anyone telling the caller.
 */
import type { LocalRuntimeId, LocalRuntimeProbe } from '@builderforce/local-inference';
import { PageEngineError, abortReason, type ChatCompletionChunk, type ChatCompletionsRequest, type PageEngine } from '../types';
import { isPageEngineReply, type PageEngineRequest } from './protocol';

/** A chat with no frame at all (no chunk, no heartbeat) for this long has lost its engine. */
export const PAGE_ENGINE_CHAT_IDLE_MS = 120_000;

/** The code an answer ends with when the engine serving it went away or went silent —
 *  its message carries it, so the chat's error banner localizes it. */
export const PAGE_ENGINE_DETACHED = 'page_engine_detached';

/** Where a proxy's requests go. */
export interface PageEnginePort {
  post(message: PageEngineRequest): void;
}

export interface PageEngineClientOptions {
  /** How long a probe waits for an answer before reading as absent. */
  probeTimeoutMs: number;
  newId?: () => string;
  /** The 503 message when no port serves a runtime (host copy, e.g. "the panel is closed"). */
  unavailableMessage?: string;
  /** The error message when a port goes away mid-answer. */
  detachedMessage?: string;
  /** How long a chat may go without a frame (default {@link PAGE_ENGINE_CHAT_IDLE_MS}). */
  chatIdleMs?: number;
  /** A probe on `port` timed out with nothing at all heard from that port meanwhile. */
  onProbeTimeout?: (port: PageEnginePort) => void;
  /** Something arrived from `port` — including a late answer to a timed-out probe. */
  onHeard?: (port: PageEnginePort) => void;
}

export interface PageEngineProxyOptions {
  /** This proxy's probe timeout (default the client's). */
  probeTimeoutMs?: number;
}

export interface PageEngineClient {
  /** A proxy engine for `runtime`, sending through whatever `portFor()` names now. */
  engine(runtime: LocalRuntimeId, baseUrl: string, portFor: () => PageEnginePort | undefined, proxy?: PageEngineProxyOptions): PageEngine;
  /** Route a received message; true when it was one of the engine's replies. */
  receive(message: unknown): boolean;
  /** `port` is gone: probes in flight on it read null, answers in flight end in an error. */
  drop(port: PageEnginePort): void;
}

/** Chunks arriving over the port, pulled by the shim. */
class ChunkQueue {
  private readonly items: ChatCompletionChunk[] = [];
  private finished = false;
  private failure: { error: unknown } | undefined;
  private waiter: { resolve: (r: IteratorResult<ChatCompletionChunk>) => void; reject: (e: unknown) => void } | undefined;

  get settled(): boolean {
    return this.finished || this.failure !== undefined;
  }

  push(chunk: ChatCompletionChunk): void {
    if (this.settled) return;
    if (this.waiter) {
      const { resolve } = this.waiter;
      this.waiter = undefined;
      resolve({ done: false, value: chunk });
    } else this.items.push(chunk);
  }

  end(): void {
    if (this.settled) return;
    this.finished = true;
    if (this.waiter && this.items.length === 0) {
      const { resolve } = this.waiter;
      this.waiter = undefined;
      resolve({ done: true, value: undefined });
    }
  }

  fail(error: unknown): void {
    if (this.settled) return;
    this.failure = { error };
    if (this.waiter) {
      const { reject } = this.waiter;
      this.waiter = undefined;
      reject(error);
    }
  }

  next(): Promise<IteratorResult<ChatCompletionChunk>> {
    const item = this.items.shift();
    if (item) return Promise.resolve({ done: false, value: item });
    if (this.failure) return Promise.reject(this.failure.error);
    if (this.finished) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }
}

type Pending =
  | { kind: 'probe'; port: PageEnginePort; settle: (probe: LocalRuntimeProbe | null) => void }
  | { kind: 'chat'; port: PageEnginePort; queue: ChunkQueue; arm(): void; disarm(): void };

/** Timed-out probes remembered, so a late answer still proves its port alive. */
const LATE_PROBES_KEPT = 64;

export function createPageEngineClient(options: PageEngineClientOptions): PageEngineClient {
  let seq = 0;
  const newId = options.newId ?? (() => `pe${++seq}`);
  const chatIdleMs = options.chatIdleMs ?? PAGE_ENGINE_CHAT_IDLE_MS;
  const pending = new Map<string, Pending>();
  const late = new Map<string, PageEnginePort>();
  /** A logical clock: when each port last sent anything. */
  let clock = 0;
  const heardAt = new Map<PageEnginePort, number>();
  const heard = (port: PageEnginePort): void => {
    heardAt.set(port, ++clock);
    options.onHeard?.(port);
  };
  const detached = (message: string): PageEngineError =>
    new PageEngineError(503, PAGE_ENGINE_DETACHED, `${PAGE_ENGINE_DETACHED}: ${message}`);

  return {
    engine(runtime, baseUrl, portFor, proxy = {}) {
      const probeTimeoutMs = proxy.probeTimeoutMs ?? options.probeTimeoutMs;
      return {
        runtime,
        baseUrl,
        // The far side's engines memoize their own probes; asking across the port per
        // turn is one message, and a fresh one when the picker asks.
        probe(probeOptions = {}) {
          const port = portFor();
          if (!port) return Promise.resolve(null);
          const id = newId();
          const sentAt = clock;
          return new Promise<LocalRuntimeProbe | null>((resolve) => {
            const timer = setTimeout(() => {
              settle(null);
              late.set(id, port);
              if (late.size > LATE_PROBES_KEPT) late.delete(late.keys().next().value!);
              if ((heardAt.get(port) ?? -1) <= sentAt) options.onProbeTimeout?.(port);
            }, probeTimeoutMs);
            function settle(probe: LocalRuntimeProbe | null): void {
              clearTimeout(timer);
              pending.delete(id);
              resolve(probe);
            }
            pending.set(id, { kind: 'probe', port, settle });
            port.post({ type: 'pageEngine.probe', id, runtime, ...(probeOptions.fresh ? { fresh: true } : {}) });
          });
        },
        invalidate() {
          /* the far side's engines own their memo; a fresh probe asks them again */
        },
        async chatCompletions(body: ChatCompletionsRequest, signal?: AbortSignal) {
          if (signal?.aborted) throw abortReason(signal);
          const port = portFor();
          if (!port) throw new PageEngineError(503, `${runtime}_unavailable`, options.unavailableMessage ?? `${runtime} is not available here.`);
          const id = newId();
          const queue = new ChunkQueue();
          let idle: ReturnType<typeof setTimeout> | undefined;
          const disarm = (): void => {
            if (idle) clearTimeout(idle);
            idle = undefined;
          };
          const stop = (reason: unknown): void => {
            disarm();
            if (!pending.has(id)) return;
            pending.delete(id);
            port.post({ type: 'pageEngine.abort', id });
            queue.fail(reason);
          };
          /** (Re)start the inactivity timeout — on every chunk and heartbeat. */
          const arm = (): void => {
            disarm();
            if (chatIdleMs > 0 && Number.isFinite(chatIdleMs)) {
              idle = setTimeout(() => stop(detached(`no reply from the engine for ${Math.round(chatIdleMs / 1000)} s`)), chatIdleMs);
            }
          };
          pending.set(id, { kind: 'chat', port, queue, arm, disarm });
          arm();
          signal?.addEventListener('abort', () => stop(abortReason(signal)), { once: true });
          port.post({ type: 'pageEngine.chat', id, runtime, body: body as Record<string, unknown> });
          return {
            [Symbol.asyncIterator]: () => ({
              next: () => queue.next(),
              // The consumer let go early (a cancelled body): stop the far engine.
              return: async () => {
                stop(new DOMException('Aborted', 'AbortError'));
                return { done: true as const, value: undefined };
              },
            }),
          };
        },
      };
    },

    receive(message) {
      if (!isPageEngineReply(message)) return false;
      const entry = pending.get(message.id);
      if (!entry) {
        // A reply to a request already settled (aborted, timed out) — still proof of life.
        const port = late.get(message.id);
        if (port) {
          late.delete(message.id);
          heard(port);
        }
        return true;
      }
      heard(entry.port);
      switch (message.type) {
        case 'pageEngine.probed':
          if (entry.kind === 'probe') entry.settle(message.probe);
          break;
        case 'pageEngine.chunk':
          if (entry.kind === 'chat') {
            entry.arm();
            entry.queue.push(message.chunk as ChatCompletionChunk);
          }
          break;
        case 'pageEngine.alive':
          if (entry.kind === 'chat') entry.arm();
          break;
        case 'pageEngine.end':
          if (entry.kind === 'chat') {
            entry.disarm();
            pending.delete(message.id);
            entry.queue.end();
          }
          break;
        case 'pageEngine.error':
          pending.delete(message.id);
          if (entry.kind === 'chat') {
            entry.disarm();
            entry.queue.fail(new PageEngineError(message.status, message.code, message.message));
          } else entry.settle(null);
          break;
      }
      return true;
    },

    drop(port) {
      // `late` is kept (bounded): a late answer from a port put aside still revives it.
      heardAt.delete(port);
      for (const [id, entry] of [...pending]) {
        if (entry.port !== port) continue;
        if (entry.kind === 'probe') entry.settle(null);
        else {
          entry.disarm();
          pending.delete(id);
          entry.queue.fail(detached(options.detachedMessage ?? 'The engine serving this model went away.'));
        }
      }
    },
  };
}
