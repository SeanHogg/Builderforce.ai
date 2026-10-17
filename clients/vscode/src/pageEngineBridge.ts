/**
 * The extension host's view of the chat webview's page engines — one `PageEngine` proxy
 * per page runtime in the registry, answered over postMessage (see
 * `pageEngineBridgeProtocol.ts` for why the engines live in the webview).
 *
 * Because each proxy IS a `PageEngine`, nothing downstream changes: the host's local
 * fetch is brain-embedded's ONE shim over these proxies (`pageEnginesFetch`), and their
 * probes join the HTTP runtimes' in the shared local-first plan. Pinned and local-first
 * routes in `modelRouting.ts` read {@link hostPageEngines} and never see postMessage.
 *
 * Failure is quiet by contract: with no webview attached (the panel closed, or never
 * opened) a probe answers null — the runtime is simply absent — and a chat is refused
 * with a 503 the failover routes around. A webview that goes away mid-answer ends that
 * answer with an error frame, never a hang. A Stop aborts the webview's engine too.
 *
 * Pure — no `vscode` import — so the round trip is unit tested with a fake port.
 */
import {
  LOCAL_RUNTIMES,
  type LocalRuntimeId,
  type LocalRuntimeProbe,
} from "@builderforce/local-inference";
import {
  PageEngineError,
  pageEnginesFetch,
  probePageEngines,
  type ChatCompletionChunk,
  type ChatCompletionsRequest,
  type PageEngine,
} from "@seanhogg/builderforce-brain-embedded";
import { isPageEngineReply, type PageEngineRequest } from "./pageEngineBridgeProtocol";

/** The local fetch a route lends the shared streamer. */
type LocalFetch = (input: string, init: RequestInit) => Promise<Response>;

/** One attached webview. */
export interface PageEnginePort {
  post(message: PageEngineRequest): void;
}

export interface HostPageEngineBridge {
  /** One proxy per page runtime in the registry. */
  readonly engines: readonly PageEngine[];
  /** Attach a webview; returns its detach. The most recently attached one answers. */
  attach(port: PageEnginePort): () => void;
  /** Route a webview message; true when it was one of the bridge's replies. */
  receive(message: unknown): boolean;
  /** Whether any webview is attached right now. */
  connected(): boolean;
  /** Every page runtime with something ready to serve; [] with no webview. */
  probe(options?: { fresh?: boolean }): Promise<LocalRuntimeProbe[]>;
  /** The local fetch: page runtimes over the bridge, everything else via `base`. */
  fetch(base?: LocalFetch): LocalFetch;
}

export interface HostPageEngineBridgeOptions {
  /** How long a probe waits for the webview before reading as absent. */
  probeTimeoutMs?: number;
  newId?: () => string;
}

/** A webview that does not answer a probe this quickly is treated as not there. */
export const PAGE_ENGINE_PROBE_TIMEOUT_MS = 2_000;

const abortReason = (signal: AbortSignal): unknown => signal.reason ?? new DOMException("Aborted", "AbortError");

/** Chunks arriving over the bridge, pulled by the shim. */
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
  | { kind: "probe"; port: PageEnginePort; settle: (probe: LocalRuntimeProbe | null) => void }
  | { kind: "chat"; port: PageEnginePort; queue: ChunkQueue };

export function createHostPageEngineBridge(options: HostPageEngineBridgeOptions = {}): HostPageEngineBridge {
  const probeTimeoutMs = options.probeTimeoutMs ?? PAGE_ENGINE_PROBE_TIMEOUT_MS;
  let seq = 0;
  const newId = options.newId ?? (() => `pe${++seq}`);
  const ports: PageEnginePort[] = [];
  const pending = new Map<string, Pending>();
  const active = (): PageEnginePort | undefined => ports[ports.length - 1];

  function proxy(runtime: LocalRuntimeId, baseUrl: string): PageEngine {
    return {
      runtime,
      baseUrl,
      // The webview's engines memoize their own probes; asking across the bridge per
      // turn is one message, and a fresh one when the picker asks.
      probe(probeOptions = {}) {
        const port = active();
        if (!port) return Promise.resolve(null);
        const id = newId();
        return new Promise<LocalRuntimeProbe | null>((resolve) => {
          const timer = setTimeout(() => settle(null), probeTimeoutMs);
          function settle(probe: LocalRuntimeProbe | null): void {
            clearTimeout(timer);
            pending.delete(id);
            resolve(probe);
          }
          pending.set(id, { kind: "probe", port, settle });
          port.post({ type: "pageEngine.probe", id, runtime, ...(probeOptions.fresh ? { fresh: true } : {}) });
        });
      },
      invalidate() {
        /* the webview's engines own their memo; a fresh probe asks them again */
      },
      async chatCompletions(body: ChatCompletionsRequest, signal?: AbortSignal) {
        if (signal?.aborted) throw abortReason(signal);
        const port = active();
        if (!port) throw new PageEngineError(503, `${runtime}_unavailable`, "The chat panel that runs on-device models is closed.");
        const id = newId();
        const queue = new ChunkQueue();
        pending.set(id, { kind: "chat", port, queue });
        const stop = (reason: unknown): void => {
          if (!pending.has(id)) return;
          pending.delete(id);
          port.post({ type: "pageEngine.abort", id });
          queue.fail(reason);
        };
        signal?.addEventListener("abort", () => stop(abortReason(signal)), { once: true });
        port.post({ type: "pageEngine.chat", id, runtime, body: body as Record<string, unknown> });
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => queue.next(),
            // The consumer let go early (a cancelled body): stop the webview's engine.
            return: async () => {
              stop(new DOMException("Aborted", "AbortError"));
              return { done: true as const, value: undefined };
            },
          }),
        };
      },
    };
  }

  const engines = LOCAL_RUNTIMES.filter((runtime) => runtime.reach === "page" && runtime.defaultBaseUrl).map((runtime) =>
    proxy(runtime.id, runtime.defaultBaseUrl!),
  );

  function dropPort(port: PageEnginePort): void {
    for (const [id, entry] of [...pending]) {
      if (entry.port !== port) continue;
      if (entry.kind === "probe") entry.settle(null);
      else {
        pending.delete(id);
        entry.queue.fail(new PageEngineError(503, "page_engine_detached", "The chat panel running this model was closed."));
      }
    }
  }

  return {
    engines,
    attach(port) {
      ports.push(port);
      return () => {
        const at = ports.indexOf(port);
        if (at < 0) return;
        ports.splice(at, 1);
        dropPort(port);
      };
    },
    receive(message) {
      if (!isPageEngineReply(message)) return false;
      const entry = pending.get(message.id);
      if (!entry) return true; // a reply to a request already settled (aborted, timed out)
      switch (message.type) {
        case "pageEngine.probed":
          if (entry.kind === "probe") entry.settle(message.probe);
          break;
        case "pageEngine.chunk":
          if (entry.kind === "chat") entry.queue.push(message.chunk as ChatCompletionChunk);
          break;
        case "pageEngine.end":
          if (entry.kind === "chat") {
            pending.delete(message.id);
            entry.queue.end();
          }
          break;
        case "pageEngine.error":
          pending.delete(message.id);
          if (entry.kind === "chat") entry.queue.fail(new PageEngineError(message.status, message.code, message.message));
          else entry.settle(null);
          break;
      }
      return true;
    },
    connected: () => ports.length > 0,
    probe: (probeOptions) => probePageEngines(engines, probeOptions),
    fetch: (base) => pageEnginesFetch(engines, base),
  };
}

/** THE bridge for this extension host — panels attach to it, routes read it. */
export const hostPageEngines: HostPageEngineBridge = createHostPageEngineBridge();
