/**
 * The runtime REGISTRY — every runtime a client on the user's machine can drive
 * directly, as data.
 *
 * Membership means "the CLIENT performs this call itself", not "the weights are on this
 * disk". Six entries are on-device engines (Synapse's native `bfi`, Ollama, FreeToken,
 * and three engines inside the page: our `bfi` compiled to WebAssembly over WebGPU,
 * WebLLM, and the browser's own built-in model): no account, no metering, available
 * offline, and the only ones local-first routing will try. `kimi-code` is Kimi's hosted API and belongs here anyway: its edge
 * refuses a hosted gateway before reading a credential, while the identical request
 * from the developer's own machine is the personal client the subscription is licensed
 * for. Same mechanism, different reason — hence `onDevice`.
 *
 * Kept as DATA so a host never branches on a runtime id: the picker, the probe, the
 * plan and the catalog binding all read the fields below.
 */
type LocalRuntimeId = 'synapse' | 'ollama' | 'freetoken' | 'bfi' | 'webllm' | 'browser' | 'kimi-code';
/**
 * Where a runtime's calls go, and what (if anything) authenticates them. An on-device
 * engine normally leaves `token` unset; `bfi serve --api-key` and a signed-in Kimi
 * install carry one. Callers never branch on which — they pass the endpoint through.
 */
interface LocalEndpoint {
    /** Runtime root (unnormalized is fine — every consumer normalizes). */
    baseUrl: string;
    /** Bearer credential, when this runtime needs one. */
    token?: string;
}

/**
 * What the runtimes on this machine serve RIGHT NOW, and what each model can do.
 *
 * A runtime that is not running is the NORMAL case — a developer with only Ollama still
 * opens the picker — so every failure (refused, wedged, non-OK, malformed) reads as "no
 * models" and the probe never throws. A short timeout keeps a wrong-port endpoint from
 * stalling the caller: this is localhost, where a healthy answer is immediate.
 *
 * `fetch` is injected, never the global: the same probe runs in the editor's Node host,
 * a web page and an MV3 service worker, and a test pins it without patching globals.
 */

/** One model a runtime serves. */
interface LocalModel {
    /** The full `local/<runtime>/<model>` ref. */
    ref: string;
    /** The runtime serving it (named `provider` because every stored ref and picker row
     *  already says so). */
    provider: LocalRuntimeId;
    /** The bare id the runtime itself knows, e.g. `qwen3:8b`. */
    model: string;
    /** The runtime's own human label, when it publishes one (Kimi declares "K2.7 Coding");
     *  a picker falls back to the id. */
    label?: string;
    /** May take a TOOL turn. Absent/false = no — see `LocalToolSupport`: unknown is never
     *  read as capable. */
    tools?: boolean;
    /** Context window in tokens, when the runtime reports one. Absent = unknown. */
    contextTokens?: number;
}
/** One runtime's answer. */
interface LocalRuntimeProbe {
    provider: LocalRuntimeId;
    endpoint: LocalEndpoint;
    /** Its catalog route answered OK. False = not running / wrong port / refused. */
    reachable: boolean;
    models: LocalModel[];
}

/**
 * Can THIS device run a catalog model — and on which backend? Answered from what the
 * engine reports (WebGPU present, `shader-f16` offered, the largest buffer binding it
 * grants; for `bfi`, its CPU backend's memory budget too) before anyone downloads a
 * gigabyte to find out. Pure: the host asks its engine for the support record
 * (`BfiEngine.support()` or a WebGPU adapter read) and passes it in.
 *
 * WebGPU wins when the model fits it. A row that declares `requires.cpu` may otherwise
 * run on the engine's CPU backend (`bfi` compiled to wasm runs the native kernels in
 * wasm memory) when the device has the memory: its weights + the CPU KV budget + the
 * working set under the memory the browser will grant ({@link cpuMemoryCeiling}), and the
 * device's RAM at least the row's floor. Every constant is Rust's (`kv_plan`, generated
 * into `bfiLimits.generated.ts` at vendor time); the engine applies the same rule.
 */

/** Where a model runs on this device. */
type LocalBackend = 'webgpu' | 'cpu';
/** The engine's CPU backend (`BfiEngine.support().backends.cpu`). */
interface LocalCpuSupport {
    supported: boolean;
    /** Built with WebAssembly SIMD128. */
    simd: boolean;
    /** Threads the kernels run on. */
    threads: number;
    /** The KV-cache budget a CPU load uses by default. */
    kvBudgetBytes?: number;
    /** Weights + KV + working set must fit under this (wasm32: 4 GiB). */
    maxMemoryBytes?: number;
    /** The device's RAM, when the host can read it (`navigator.deviceMemory`, `os.totalmem()`). */
    deviceMemoryBytes?: number;
}
/** The engine's WebGPU backend (`BfiEngine.support().backends.webgpu`). */
interface LocalWebGpuSupport {
    supported: boolean;
    reason?: string;
    maxBufferBytes: number;
    maxStorageBufferBindingSizeBytes?: number;
    f16: boolean;
}
/** What the device offers. The top level is the WebGPU adapter (contract version 2);
 *  `backends` is present when the engine has more than one. Never requires creating a
 *  device. */
interface LocalDeviceSupport {
    /** Version of the cross-language support record. */
    contractVersion?: 2;
    supported: boolean;
    /** Why WebGPU is unavailable, when `supported` is false. */
    reason?: string;
    f16: boolean;
    /** Adapter `maxBufferSize`: the largest allocatable GPU buffer. */
    maxBufferSizeBytes?: number;
    /** Adapter `maxStorageBufferBindingSize`: the largest storage-buffer binding. */
    maxStorageBufferBindingSizeBytes?: number;
    /** @deprecated Version 1 conflated the two limits. Use the explicit fields. */
    maxBufferBytes: number;
    /** Requested adapter preference, not a claim about the selected hardware. */
    requestedPowerPreference?: 'high-performance' | 'low-power';
    backends?: {
        webgpu?: LocalWebGpuSupport;
        cpu?: LocalCpuSupport;
    };
}
/** Why a model cannot run here — a stable code a picker maps to copy. */
type LocalModelUnfit = 'webgpu_unavailable' | 'shader_f16_unavailable' | 'buffer_too_small' | 'vram_too_small' | 'memory_insufficient';

/**
 * THE contract every engine that runs INSIDE the page implements (PRD 34 §3.4) — Chrome's
 * built-in model (Prompt API), WebLLM and our WebGPU `bfi`.
 *
 * An engine answers two questions and nothing else: what it can serve right now (a probe
 * shaped exactly like an HTTP runtime's, so the shared plan reads it unchanged) and a
 * chat completion as OpenAI chunks. Turning that into the `fetch` the shared streamer
 * drives — SSE framing, failover statuses, the non-streaming answer — is the ONE shim's
 * (`pageEnginesFetch`), never an engine's.
 */

/** The request as the streamer sends it: OpenAI `chat.completions` JSON. Gateway-only
 *  fields ride along; an engine reads what it needs and ignores the rest. */
interface ChatCompletionsRequest {
    model?: unknown;
    messages?: unknown;
    tools?: unknown;
    stream?: unknown;
    [field: string]: unknown;
}
/** One OpenAI `chat.completion.chunk` — the shape every engine yields. */
interface ChatCompletionChunk {
    id?: string;
    model?: string;
    choices: Array<{
        index: number;
        delta: {
            role?: string;
            content?: string | null;
            tool_calls?: Array<{
                index: number;
                id?: string;
                type?: string;
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
        };
        finish_reason: string | null;
    }>;
    usage?: Record<string, unknown> | null;
}
interface PageEngine {
    runtime: LocalRuntimeId;
    /** The non-routable root its chat route is answered at (`http://<runtime>.local`). */
    baseUrl: string;
    /** What it can serve right now, or null when nothing is ready. NEVER downloads, never
     *  throws; memoized, so asking per turn is free while nothing moved. */
    probe(options?: {
        fresh?: boolean;
    }): Promise<LocalRuntimeProbe | null>;
    /** Drop the memoized probe — a model was downloaded or removed. */
    invalidate(): void;
    /**
     * The completion as OpenAI chunks. Anything that stops it from STARTING — a refusal,
     * a model not downloaded, an oversized prompt — is thrown before the iterable is
     * returned (or by its first pull) as a {@link PageEngineError}, so the shim answers a
     * non-2xx and the failover moves on before the user saw anything.
     */
    chatCompletions(body: ChatCompletionsRequest, signal?: AbortSignal): Promise<AsyncIterable<ChatCompletionChunk>>;
}
/** A refusal with the HTTP status the shim answers it with. */
declare class PageEngineError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message?: string);
}

/**
 * THE frames for reaching a page engine that runs somewhere else — ONE declaration for
 * every boundary it crosses (PRD 34 §3.4):
 *
 *  - the editor's extension host ↔ its chat webview (postMessage), and ↔ its own `bfi`
 *    worker (`worker_threads`);
 *  - a page (web, Rovr) ↔ the dedicated Web Worker its `bfi` engine runs in, so CPU
 *    decoding never blocks the page.
 *
 *   caller → engine   `pageEngine.probe` · `pageEngine.chat` · `pageEngine.abort`
 *   engine → caller   `pageEngine.probed` · `pageEngine.chunk` · `pageEngine.end` · `pageEngine.error`
 *                     · `pageEngine.alive` (a chat still running with nothing to send yet — a
 *                       load, a queued turn — so the caller's inactivity timeout is not hit)
 *
 * Every frame carries the request `id` the caller minted. Pure — no DOM, no Node.
 */

/** caller → engine */
type PageEngineRequest = {
    type: 'pageEngine.probe';
    id: string;
    runtime: LocalRuntimeId;
    fresh?: boolean;
} | {
    type: 'pageEngine.chat';
    id: string;
    runtime: LocalRuntimeId;
    body: Record<string, unknown>;
} | {
    type: 'pageEngine.abort';
    id: string;
};
/** engine → caller */
type PageEngineReply = {
    type: 'pageEngine.probed';
    id: string;
    probe: LocalRuntimeProbe | null;
} | {
    type: 'pageEngine.chunk';
    id: string;
    chunk: unknown;
} | {
    type: 'pageEngine.end';
    id: string;
} | {
    type: 'pageEngine.alive';
    id: string;
} | {
    type: 'pageEngine.error';
    id: string;
    status: number;
    code: string;
    message: string;
};
declare const PAGE_ENGINE_REQUEST_TYPES: readonly ["pageEngine.probe", "pageEngine.chat", "pageEngine.abort"];
declare const PAGE_ENGINE_REPLY_TYPES: readonly ["pageEngine.probed", "pageEngine.chunk", "pageEngine.end", "pageEngine.error", "pageEngine.alive"];
/** Whether a caller-received message is one of the engine's replies. */
declare function isPageEngineReply(message: unknown): message is PageEngineReply;
/** Whether an engine-received message is one of the caller's requests. */
declare function isPageEngineRequest(message: unknown): message is PageEngineRequest;

type ReplyPayload<T extends PageEngineReply['type']> = Omit<Extract<PageEngineReply, {
    type: T;
}>, 'type'>;
interface PageEngineServerIo {
    /** Post a reply to the caller. */
    reply<T extends PageEngineReply['type']>(type: T, payload: ReplyPayload<T>): void;
    /** Subscribe to the caller's requests; returns the unsubscribe. */
    listen(onRequest: (request: PageEngineRequest) => void): () => void;
}
/** Serve `engines()` over `io`. The engines are read lazily, on the first request — a
 *  surface that never routes a turn to a page model never builds them. */
declare function servePageEngines(engines: () => readonly PageEngine[], io: PageEngineServerIo): () => void;

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

/** Where a proxy's requests go. */
interface PageEnginePort {
    post(message: PageEngineRequest): void;
}
interface PageEngineClientOptions {
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
interface PageEngineProxyOptions {
    /** This proxy's probe timeout (default the client's). */
    probeTimeoutMs?: number;
}
interface PageEngineClient {
    /** A proxy engine for `runtime`, sending through whatever `portFor()` names now. */
    engine(runtime: LocalRuntimeId, baseUrl: string, portFor: () => PageEnginePort | undefined, proxy?: PageEngineProxyOptions): PageEngine;
    /** Route a received message; true when it was one of the engine's replies. */
    receive(message: unknown): boolean;
    /** `port` is gone: probes in flight on it read null, answers in flight end in an error. */
    drop(port: PageEnginePort): void;
}
declare function createPageEngineClient(options: PageEngineClientOptions): PageEngineClient;

/** A worker with nothing in flight for this long is terminated (it respawns on demand). */
declare const ENGINE_WORKER_IDLE_MS: number;
/** caller → worker: drop memoized probes (a model was downloaded or removed). */
declare const ENGINE_WORKER_INVALIDATE = "engineWorker.invalidate";
/** worker → caller: the engine trapped; terminate me and start a fresh worker. */
declare const ENGINE_WORKER_FATAL = "engineWorker.fatal";
/** A started worker, as the lifecycle drives it. */
interface EngineWorkerHandle {
    post(message: unknown): void;
    terminate(): void;
}
interface EngineWorkerEvents {
    onMessage(message: unknown): void;
    /** The worker errored or exited. */
    onGone(reason: string): void;
}
interface EngineWorkerOptions {
    /** Start a worker (a host's platform: `new Worker(…)`, `new worker_threads.Worker(…)`). */
    spawn(events: EngineWorkerEvents): EngineWorkerHandle | Promise<EngineWorkerHandle>;
    /** Every message from the worker that is not a lifecycle frame. */
    onMessage(message: unknown): void;
    /** A worker stopped: fail what was in flight on `port` (the remote client's `drop`). */
    onStopped(port: PageEnginePort, reason: string): void;
    idleMs?: number;
    /** Logs why a worker went away (a crash, a trap). Default `console.warn`. */
    warn?: (message: string) => void;
    now?: () => number;
}
interface EngineWorker {
    /** The live worker's port, starting one if none runs. */
    port(): PageEnginePort;
    /** Whether a worker runs now. */
    running(): boolean;
    /** Tell a running worker's engines to drop their memos (no worker is started for it). */
    invalidate(): void;
    /** Terminate it; the next `port()` starts a new one. */
    dispose(): void;
    /** Terminate it as a crash would (`reason` is logged) — the next `port()` starts a
     *  fresh one. For a worker that reported it cannot go on (its threads did not start). */
    restart(reason: string): void;
}
declare function createEngineWorker(options: EngineWorkerOptions): EngineWorker;
/** The worker side's transport. */
interface EngineWorkerEndpoint {
    post(message: unknown): void;
    /** Subscribe to the caller's messages; returns the unsubscribe. */
    listen(onMessage: (message: unknown) => void): () => void;
    /** Subscribe to this realm's uncaught errors and unhandled rejections — where a trap
     *  inside an engine's async work surfaces (a Web Worker's `error` /
     *  `unhandledrejection`, Node's `unhandledRejection`). The listener answers true when
     *  the error was a trap it reported, so the host may suppress the realm's default
     *  report (a Web Worker's `preventDefault`, so the page sees one FATAL, not also an
     *  `error` event). */
    onUncaught?(listener: (error: unknown) => boolean): void;
}
interface EngineWorkerServeOptions {
    /** Runs once, before the FATAL frame: forget the poisoned module (`forgetBfiWeb`). */
    onFatal?: () => void;
}
interface ServedEngineWorker {
    /** Report a trap (or any unrecoverable state) — the caller terminates and respawns.
     *  Pass it as an engine's `onTrap`. Only the first report is sent. */
    fatal(error: unknown): void;
}
/**
 * The WORKER half: serve `engines` over `endpoint`, honour INVALIDATE, hand every other
 * message to `onOther` (an engine's own frames, e.g. `bfi.init`), and report a trap —
 * from `fatal`, or uncaught in this realm — as the ONE FATAL frame.
 */
declare function serveEngineWorker(endpoint: EngineWorkerEndpoint, engines: () => readonly PageEngine[], onOther?: (message: unknown) => void, options?: EngineWorkerServeOptions): ServedEngineWorker;
/** Whether `e` is a WebAssembly trap — the instance that threw it is poisoned. */
declare function isWasmTrap(e: unknown): boolean;

/** Where a published file is fetched from (Hugging Face redirects to its CDN). */
declare function hfResolveUrl(repo: string, file: string): string;
interface HfModelStore {
    status(ref: string): Promise<'absent' | 'ready'>;
    /** Stream the file into the cache, reporting 0..1. A failed or cancelled download
     *  leaves nothing behind (Cache Storage `put` is all-or-nothing). */
    download(ref: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void>;
    remove(ref: string): Promise<void>;
    /** The cached file as a byte stream plus its size — what `BfiEngine.load` takes. */
    open(ref: string): Promise<{
        stream: ReadableStream<Uint8Array>;
        bytes: number;
    }>;
}

/**
 * Our transformer — Synapse's `bfi` compiled to WebAssembly over WebGPU, or over the CPU
 * where there is no GPU (`bfi-web`, PRD 34 §3.1) — as a page engine answering the `bfi`
 * runtime's chat route. The backend is the fit's: `localModelFit` offers a Bonsai row on
 * WebGPU when the adapter fits it, else on the engine's CPU backend when the device has
 * the memory, and the engine opens exactly that backend (`create({ backend })`) — the
 * probe's predicted context and the load always agree.
 *
 * The wasm package is vendored by the host, so this adapter takes its loader as a
 * dependency (`loadBfi`) rather than importing it: brain-embedded compiles and tests
 * without it, and a host that never offers `bfi` never fetches the wasm.
 *
 * The host owns download and cache (the `hf-file` model store); `bfi` only ever reads
 * weights the store already holds. A probe looks in the store FIRST and answers null
 * without loading the wasm when no Bonsai file is there; a chat call for a model that is
 * not downloaded is a 503 before anything streams. `tools` is honoured for every model —
 * `bfi` grammar-constrains the call.
 *
 * The window a probe reports is the one the engine will SERVE: `bfi` sizes its KV cache
 * to the device (a 2 GiB budget, f16 when the adapter has `shader-f16`), so Bonsai 8B's
 * trained 65,536 tokens become ~14k in a browser; on the CPU an f32 cache under 512 MiB
 * (Bonsai 1.7B ≈ 2.3k). Before a load that is
 * `BfiEngine.contextFor` over the row's KV shape — the engine's own formula, never a
 * copy of it — and after one it is what the load actually allocated.
 *
 * This engine always runs in a WORKER — a page's dedicated Web Worker (`bfiWorker.ts`,
 * every host's page, the editor's webview included) or the editor host's
 * `worker_threads` worker (`hostBfi/worker.ts`). A wasm trap poisons the realm's
 * instance, so `onTrap` reports it and the host starts a fresh worker. Every load,
 * eviction and stream runs through ONE queue (`engineQueue.ts`).
 */

/** `bfi-web`'s model summary (§3.1). */
interface BfiModelInfo {
    arch: string;
    /** The backend the engine runs on. */
    backend?: LocalBackend;
    /** The context the load actually allocated (≤ the trained window). */
    contextTokens: number;
    vocab: number;
    params: number;
    kvF16?: boolean;
}
/** `BfiEngine.contextFor`'s input: a model's attention shape plus the device. */
interface BfiContextShape {
    layers: number;
    kvHeads: number;
    headDim: number;
    trainedContext: number;
    /** Which backend's rule (default WebGPU); `cpu` = f32 KV, no buffer cap. */
    backend?: LocalBackend;
    kvBudgetBytes?: number;
    f16?: boolean;
    maxStorageBufferBindingSizeBytes?: number;
}
/** A live `BfiEngine` (§3.1) — structurally typed so the wasm package is not a build dep. */
interface BfiEngineInstance {
    load(chunks: ReadableStream<Uint8Array>, totalBytes: number, onProgress?: (loaded: number, total: number) => void): Promise<BfiModelInfo>;
    chat(requestJson: string, onChunk: (chunkJson: string) => void, signal?: AbortSignal): Promise<string>;
    unload(): void;
    /** Native (`@seanhogg/bfi-node`) only: stop the engine's thread and free its model. A
     *  wasm engine dies with its worker; a native one lives in the process, so a trap must
     *  end it explicitly. */
    dispose?(): void;
}
/** The `BfiEngine` class's statics (§3.1). */
interface BfiEngineStatic {
    /** `auto` (default) = WebGPU when an adapter exists, else the CPU. */
    create(options?: {
        backend?: LocalBackend | 'auto';
    }): Promise<BfiEngineInstance>;
    support(): Promise<LocalDeviceSupport>;
    /** The context a load will serve on this shape and device (pure; 0 on a bad shape). */
    contextFor(shape: BfiContextShape): number;
}
interface BfiModule {
    BfiEngine: BfiEngineStatic;
}
interface BfiPageEngine extends PageEngine {
    /** The device's support record for the PICKER — every backend, whether or not this
     *  host serves it (`backends` restricts the probe and the chat only). */
    support(): Promise<LocalDeviceSupport>;
}
interface BfiEngineOptions {
    /** Loads the vendored `bfi-web` module (a dynamic import of its URL, in a host). */
    loadBfi: () => Promise<BfiModule>;
    store: Pick<HfModelStore, 'status' | 'open'>;
    /** The device's RAM where the engine cannot read it itself — a Node host passes
     *  `os.totalmem()`; a page leaves it to `navigator.deviceMemory`. */
    deviceMemoryBytes?: number;
    /** The backends this host SERVES `bfi` on (default both): the probe and the chat. The
     *  editor's webview worker serves `['webgpu']`, so CPU decoding never runs beside the
     *  chat UI; the extension host's worker serves both on the native addon (its GPU is
     *  native wgpu) and `['cpu']` on the wasm fallback. `support()` — the picker's record
     *  — is never restricted. */
    backends?: readonly LocalBackend[];
    /** A wasm trap poisoned the instance: the host terminates this worker and starts a
     *  fresh one (`serveEngineWorker`'s `fatal`). A native engine's panic arrives the same
     *  way (`@seanhogg/bfi-node` raises it as a `RuntimeError`). */
    onTrap?: (error: unknown) => void;
    /** The engine's own `support()` is cheap here — a native addon (`@seanhogg/bfi-node`)
     *  has no wasm to compile — so it answers the picker and the probe even before any
     *  model is downloaded, and the record is the real device's (its GPU, its RAM). */
    supportFromEngine?: boolean;
    ttlMs?: number;
    now?: () => number;
}
declare function createBfiEngine(options: BfiEngineOptions): BfiPageEngine;

/**
 * `bfi`'s support record WITHOUT the wasm — for the picker on a device with no Bonsai
 * downloaded yet. Listing the catalog must not start a worker or compile 3.7 MB of wasm
 * just to say "Download (250 MB)", so until a model is in the store the record is built
 * from what the page itself can read: the WebGPU adapter (no device), WebAssembly SIMD
 * (the default artifact needs it to instantiate at all), and the CPU planning constants
 * Rust generates (`BFI_CPU_LIMITS`, `cpuMemoryCeiling`). Once a model is downloaded the
 * engine's own `BfiEngine.support()` answers.
 */

/** The support record `BfiEngine.support()` would give, read without the engine. */
declare function bfiSupportWithoutWasm(deviceMemoryBytes?: number | undefined): Promise<LocalDeviceSupport>;

/**
 * The WORKER half of `bfi` in a dedicated Web Worker (see `bfiWorkerEngine.ts` for the
 * page half and the frames). A host's worker module is one line: `runBfiWorker()`.
 * Lives in the `/bfi` entry because it loads the vendored wasm.
 *
 * What differs per host arrives in the `bfi.init` frame: the wasm URLs, the backends
 * this worker serves, and whether it reads models from this origin's Cache Storage or
 * through the page (`relayStore` — the editor's webview, whose models live in the
 * extension host's file cache and are reached only over the page's bridge).
 *
 * A wasm trap poisons this worker's instance (the glue cannot re-initialize in the same
 * realm), so it is reported as the lifecycle's FATAL frame — `serveEngineWorker` does
 * that for an engine's `onTrap` and for a trap surfacing as an uncaught error or an
 * unhandled rejection — and the page starts a fresh worker. A threaded artifact that
 * does not start is reported as `bfi.threadsFailed`: the page replaces this worker with a
 * single-threaded one.
 */

interface RunBfiWorkerOptions {
    /** The model store the engine reads when the page does not relay one; default this
     *  origin's Cache Storage. */
    store?: Pick<HfModelStore, 'status' | 'open'>;
    /** Load the wasm module; default the vendored `bfi-web` (tests inject). */
    loadBfi?: (wasmUrl: string, threads?: BfiThreadsSource) => Promise<BfiModule>;
}
/** The WORKER half: call once at the top of the worker module. */
declare function runBfiWorker(scope?: MessageEndpointLike, options?: RunBfiWorkerOptions): void;

/**
 * THE `bfi-web` loader — the one way a `bfi` worker (`runBfiWorker`, the editor host's
 * `hostBfi/worker.ts`) loads the wasm.
 *
 * `@seanhogg/bfi-web` is the vendored wasm-pack build of Synapse's engine (PRD 34 §3.1,
 * `packages/bfi-web`). This module dynamic-imports it, runs its wasm-bindgen initializer
 * with the wasm URL the HOST's bundler emitted — once, however many engines or calls ask
 * — and hands back the `BfiEngine` class in the shape `bfiEngine.ts` takes. Only the URL
 * differs per host (Next asset, Vite `?url`, `chrome.runtime.getURL`, a file's bytes);
 * everything else lives here. `bfi` never runs on a page's own thread: a wasm trap
 * poisons its realm, and only a worker can be replaced.
 *
 * It is its own entry (`@seanhogg/builderforce-brain-embedded/bfi`), never re-exported
 * from the root: `@seanhogg/bfi-web` is not published, so it stays EXTERNAL in this
 * package's build and only a host that links it may import this entry. An embed that
 * imports the root alone never meets the specifier.
 *
 * The entry also carries the `bfi` page engine itself and the `hf-file` URL rule, for a
 * host that runs the engine OUTSIDE a page (the editor's extension host, in a worker,
 * on the CPU backend) over its own file store — React-free, so that worker stays small.
 */

/** Where the wasm binary comes from: a URL the host's bundler emitted (a page), or its
 *  bytes (a Node host reads the file — Node's `fetch` has no `file:`). */
type BfiWasmSource = string | URL | ArrayBuffer | ArrayBufferView;
/** The slice of the wasm-pack `--target web` module this loader uses. */
interface BfiWebModule extends BfiModule {
    /** wasm-bindgen's initializer: fetches and instantiates the binary at `module_or_path`. */
    default(options: {
        module_or_path: BfiWasmSource;
    }): Promise<unknown>;
    /** The THREADED artifact only: start the rayon pool of `n` workers. */
    initThreads?(n: number): Promise<number>;
}
/**
 * The THREADED artifact (`packages/bfi-web/threads/`, built on a pinned nightly with
 * atomics), which a host SERVES as plain files — its pool workers find the glue by URL —
 * and the loader imports at runtime. CPU-only: it carries no WebGPU backend.
 */
interface BfiThreadsSource {
    /** Absolute URL of the threaded glue (`…/threads/bfi_web.js`). */
    moduleUrl: string;
    /** Absolute URL of its wasm (`…/threads/bfi_web_bg.wasm`). */
    wasmUrl: string;
}
interface BfiLoadOptions {
    /** The threaded artifact, offered when the host serves it. Used only where threads
     *  exist (cross-origin isolated: `SharedArrayBuffer` + `Worker`) and there is no WebGPU
     *  adapter to prefer. */
    threads?: BfiThreadsSource;
    /** Pool size; default `navigator.hardwareConcurrency`. */
    threadCount?: number;
    /** Imports the threaded glue by URL. Injected only by tests. */
    importThreads?: (moduleUrl: string) => Promise<BfiWebModule>;
    /** How long the pool may take to start (default {@link BFI_THREADS_START_TIMEOUT_MS}). */
    threadsTimeoutMs?: number;
}
/** wasm-bindgen-rayon's pool start (`initThreads`) can hang — a helper worker that never
 *  reports in — so it is raced against this. */
declare const BFI_THREADS_START_TIMEOUT_MS = 10000;
/**
 * The threaded artifact applied here and did not start. Its instance may already exist
 * in this realm, and a realm never holds two wasm instances, so the default artifact is
 * NOT loaded beside it: the host replaces the worker with a single-threaded one
 * (`runBfiWorker` reports it; `createBfiWorkerEngine` respawns without `threads`).
 */
declare class BfiThreadsError extends Error {
    constructor(message: string);
}
/** Whether `e` is a {@link BfiThreadsError} (by name: it may cross a realm). */
declare const isBfiThreadsError: (e: unknown) => boolean;
/** Imports the package. Injected only by tests; a host never passes it. */
type BfiWebImporter = () => Promise<BfiWebModule>;
/**
 * Load `bfi-web` with its binary at `wasmUrl`, initializing the wasm once per worker.
 * With `options.threads`, a cross-origin-isolated context without a WebGPU adapter loads
 * the THREADED artifact instead and starts its rayon pool
 * (`initThreads(navigator.hardwareConcurrency)`, raced against
 * {@link BFI_THREADS_START_TIMEOUT_MS}); one that fails or times out rejects with
 * {@link BfiThreadsError} — never a second instance in this realm. A failed load is not
 * cached, so a later call (a retry after going online) tries again.
 */
declare function loadBfiWeb(wasmUrl: BfiWasmSource, importer?: BfiWebImporter, options?: BfiLoadOptions): Promise<BfiModule>;
/**
 * Forget the initialized module — after a wasm trap poisoned it. The next `loadBfiWeb`
 * imports and initializes again; in practice the realm is a worker that is about to be
 * replaced (the glue keeps its instance per realm), so this only guarantees nothing here
 * hands the poisoned module out again.
 */
declare function forgetBfiWeb(): void;

/**
 * `bfi` in a DEDICATED WEB WORKER — on every page host: the web app, Rovr and the
 * editor's chat webview. Never on the page's own thread, for two reasons:
 *
 *  - without WebGPU, `bfi-web` decodes on the CPU synchronously, token by token; on the
 *    page's main thread that freezes the UI for the whole answer;
 *  - a wasm trap poisons the realm's instance for good (the glue cannot re-initialize),
 *    and only a worker can be thrown away and replaced.
 *
 * So the page runs the whole `bfi` page engine (`createBfiEngine`: the wasm, its WebGPU —
 * `navigator.gpu` exists in dedicated workers — or CPU backend, the model store) in a
 * worker, and talks to it over the remote page-engine frames (`remote/protocol.ts`) the
 * editor uses between its host and webview. The worker's life is the ONE engine-worker
 * lifecycle (`remote/engineWorker.ts`): started on first use, respawned after a crash or
 * a wasm trap, torn down after five idle minutes and on `dispose()`, and a model that
 * keeps crashing it is failed for the session.
 *
 *   page → worker   `bfi.init` (the wasm URLs, the backends, the store) · `bfi.support`
 *                   · `bfi.stored` · the lifecycle and page-engine frames
 *   worker → page   `bfi.supported` · `bfi.store` · `bfi.threadsFailed`
 *                   · the lifecycle and page-engine frames
 *
 * Model downloads stay on the page (the picker's store). The worker reads the same
 * origin's Cache Storage — or, with `relayStore`, the page's own store over `bfi.store`
 * frames (the editor's webview, whose models are the extension host's files). A finished
 * download invalidates its memoized probe. With nothing downloaded, `support()` answers
 * from the page itself (`bfiSupportWithoutWasm`) — the picker listing the catalog never
 * starts the worker or compiles the wasm.
 *
 * The THREADED artifact is offered in `bfi.init` until it once fails to start
 * (`bfi.threadsFailed`): the worker is then replaced by a single-threaded one — never two
 * wasm instances in one realm — and a probe, support read or turn the restart cut off is
 * asked again once.
 *
 * This file is the PAGE half (root entry, no wasm import); the worker half is
 * `bfiWorker.ts` (`/bfi` entry). A host provides the worker module — one line,
 * `runBfiWorker()` — through its own bundler.
 */

/** The slice of `DedicatedWorkerGlobalScope` the worker half uses. */
interface MessageEndpointLike {
    postMessage(message: unknown): void;
    addEventListener(type: 'message', listener: (event: {
        data: unknown;
    }) => void): void;
    removeEventListener(type: 'message', listener: (event: {
        data: unknown;
    }) => void): void;
}
/** The slice of a browser `Worker` the page half uses. */
interface WorkerLike {
    postMessage(message: unknown): void;
    addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: {
        data?: unknown;
        message?: string;
    }) => void): void;
    terminate(): void;
}
interface BfiWorkerEngineOptions {
    /** Start the worker (whose module calls `runBfiWorker`). Called on first real use. */
    create: () => WorkerLike;
    /** The wasm binary's URL, as the host's bundler emitted it (absolute). */
    wasmUrl: () => string | URL | Promise<string | URL>;
    /** The THREADED artifact the host serves (absolute URLs), if any. The worker loads it
     *  instead when cross-origin isolated with no WebGPU adapter (`loadBfiWeb`). */
    threads?: () => BfiThreadsSource | undefined | Promise<BfiThreadsSource | undefined>;
    /** The backends the worker SERVES (default both). The editor's webview passes
     *  `['webgpu']`: its CPU turns go to the extension host's worker. */
    backends?: readonly LocalBackend[];
    /** The support record of whoever serves the OTHER backends (the editor's host worker,
     *  read without its wasm): the picker's record is this worker's backends plus the
     *  peer's (`withPeerBackends`), so a model that fits only there is still offered. */
    peerSupport?: () => Promise<LocalDeviceSupport | undefined>;
    /** The worker reads models through this page's `store` instead of the origin's Cache
     *  Storage. */
    relayStore?: boolean;
    /** The page's view of the model store: whether the wasm is needed yet, and (with
     *  `relayStore`) what the worker reads. Absent: always ask the worker. */
    store?: Pick<HfModelStore, 'status'> & Partial<Pick<HfModelStore, 'open'>>;
    /** How long a probe or support read waits for the worker. A cold worker compiles
     *  ~3.7 MB of wasm first, so this is generous. */
    timeoutMs?: number;
    /** Idle teardown (default `ENGINE_WORKER_IDLE_MS`). */
    idleMs?: number;
}
/** A {@link BfiPageEngine} whose engine runs in a worker, plus its teardown. */
interface BfiWorkerEngine extends BfiPageEngine {
    dispose(): void;
}
/** The PAGE half: a `bfi` page engine whose engine runs in the worker. */
declare function createBfiWorkerEngine(options: BfiWorkerEngineOptions): BfiWorkerEngine;

export { createBfiEngine as $, type PageEngineServerIo as A, type BfiWorkerEngineOptions as B, type ChatCompletionChunk as C, createBfiWorkerEngine as D, ENGINE_WORKER_FATAL as E, createEngineWorker as F, createPageEngineClient as G, type HfModelStore as H, isPageEngineReply as I, isPageEngineRequest as J, isWasmTrap as K, type LocalRuntimeId as L, serveEngineWorker as M, servePageEngines as N, BFI_THREADS_START_TIMEOUT_MS as O, type PageEngine as P, type BfiEngineOptions as Q, type BfiLoadOptions as R, type BfiPageEngine as S, BfiThreadsError as T, type BfiThreadsSource as U, type BfiWasmSource as V, type WorkerLike as W, type BfiWebImporter as X, type BfiWebModule as Y, type RunBfiWorkerOptions as Z, bfiSupportWithoutWasm as _, type LocalEndpoint as a, forgetBfiWeb as a0, hfResolveUrl as a1, isBfiThreadsError as a2, loadBfiWeb as a3, runBfiWorker as a4, type LocalRuntimeProbe as b, type LocalModel as c, type LocalBackend as d, type LocalModelUnfit as e, type BfiEngineInstance as f, type BfiEngineStatic as g, type BfiModelInfo as h, type BfiModule as i, type BfiWorkerEngine as j, type ChatCompletionsRequest as k, ENGINE_WORKER_IDLE_MS as l, ENGINE_WORKER_INVALIDATE as m, type EngineWorker as n, type EngineWorkerEndpoint as o, type EngineWorkerEvents as p, type EngineWorkerHandle as q, type EngineWorkerOptions as r, PAGE_ENGINE_REPLY_TYPES as s, PAGE_ENGINE_REQUEST_TYPES as t, type PageEngineClient as u, type PageEngineClientOptions as v, PageEngineError as w, type PageEnginePort as x, type PageEngineReply as y, type PageEngineRequest as z };
