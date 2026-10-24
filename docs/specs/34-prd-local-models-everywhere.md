# PRD 34 — Local models everywhere, handed off through builderforce-memory

| | |
|---|---|
| Status | Shipped 2026-10-17 — real-browser end-to-end run outstanding (ROADMAP › Workload-aware routing) |
| Owner | Rovr program (agents) |
| Surfaces | Builderforce Agent VSIX · Rovr (Chrome) · Web Brain (builderforce.ai) |
| Repos | `builderforce-inference` (bfi → WebGPU), `builderforce-memory` (hand-off), `Builderforce.ai` |

## 1. What a person can do

Pick a model that runs **on this device** from the same model picker they use today
(the `/` menu → MODEL tab gains a **Local** filter), download it once, and chat or run
agent turns on it — in the VS Code extension, in Rovr and on builderforce.ai. When a run
moves between models (local ↔ cloud, plan → code, stall failover), the next model gets a
context **packed for its own window by builderforce-memory**, never a transcript it cannot
hold.

## 2. Operator decisions (2026-10-17)

- In-browser inference uses **WebGPU** through two engines: **our transformer** — Synapse's
  `bfi` (builderforce-inference) compiled to WebAssembly with its CubeCL kernels on the
  `wgpu` WebGPU backend — and **WebLLM** (`@mlc-ai/web-llm`) for MLC-prebuilt models.
  No llama-server, no Ollama requirement.
- **1-bit Bonsai** (PrismML, Apache-2.0, Qwen3 dense, GGUF `Q1_0` group-128) runs on `bfi`.
  WebLLM has no `Q1_0` mode.
- builderforce-memory is the hand-off mechanism between model calls on every host.

## 3. Contracts (every implementer builds against these)

### 3.1 `bfi-web` (builderforce-inference, new crate `crates/bfi-web`, wasm-bindgen)

```ts
export class BfiEngine {
  /** `webgpu`: adapter + device (requests `shader-f16` when offered); rejects with
   *  `webgpu_unavailable: <reason>` when there is no adapter. `cpu`: the native bfi
   *  CPU kernels in wasm memory (SIMD128, single-threaded). `auto` (default): WebGPU
   *  when an adapter exists, else CPU. */
  static create(options?: { backend?: 'webgpu' | 'cpu' | 'auto' }): Promise<BfiEngine>;
  readonly backend: 'webgpu' | 'cpu';
  /** No device creation; safe to call on every probe. The top level is the WebGPU
   *  adapter (contract v2, unchanged); `backends` describes each backend. */
  static support(): Promise<{ supported: boolean; reason?: string; maxBufferBytes: number; f16: boolean;
    backends: { webgpu: { supported: boolean; reason?: string; maxBufferBytes: number; f16: boolean };
                cpu: { supported: true; simd: boolean; threads: number; kvBudgetBytes: number;
                       maxMemoryBytes: number; deviceMemoryBytes?: number } } }>;
  /** Load a GGUF from bytes streamed by the host (the host owns download + cache).
   *  Weights stay PACKED on the GPU (one buffer per tensor). */
  load(chunks: ReadableStream<Uint8Array>, totalBytes: number,
       onProgress?: (loaded: number, total: number) => void,
       options?: { kvBudgetBytes?: number }): Promise<BfiModelInfo>;
  /** The context a load will serve (pure; 0 on a bad shape). Defaults: 2 GiB budget,
   *  f16 false, 128 MiB maxBufferBytes. */
  static contextFor(shape: { layers: number; kvHeads: number; headDim: number;
    trainedContext: number; backend?: 'webgpu' | 'cpu'; kvBudgetBytes?: number; f16?: boolean;
    maxBufferBytes?: number }): number;
  /** OpenAI `chat.completions` request JSON → streams OpenAI chunk JSON strings via
   *  `onChunk` (`{choices:[{delta:{content|tool_calls}}]}`), resolves with the final
   *  completion JSON (incl. `usage`, `finish_reason`). `tools` → grammar-constrained
   *  `tool_calls` (bfi-runtime `tools.rs`). Aborts on `signal`. */
  chat(requestJson: string, onChunk: (chunkJson: string) => void, signal?: AbortSignal): Promise<string>;
  unload(): void;
}
export interface BfiModelInfo { arch: string; backend: 'webgpu' | 'cpu'; contextTokens: number;
  vocab: number; params: number; kvF16: boolean }
```

**CPU backend (no GPU).** The same model code (`bfi-models` qwen3 on `bfi-core`'s
`CpuBackend`, streamed tensor by tensor, weights packed in wasm memory). f32 KV under a
512 MiB default budget (`contextFor({ backend: 'cpu' })`: Bonsai 1.7B 2,304, 4B / 8B
1,792). wasm32's 4 GiB is the ceiling: weights + KV + a 256 MiB working set over it is
`cpu_memory_exceeded`, refused from the header before any weight is placed. Catalog
rows opt in with `requires.cpu.minDeviceMemoryBytes` (1.7B 2 GiB, 4B 4 GiB, 8B 8 GiB;
an unreported RAM reads as 4 GiB); `localModelFit` returns the backend it chose and the
picker badges `bfi` rows "GPU" / "CPU". The web app and Rovr run the whole `bfi` page engine
in a dedicated Web Worker (`createBfiWorkerEngine` / `runBfiWorker`, over the same remote
page-engine frames the editor uses), so CPU decoding never blocks the page. The editor's
extension host runs the engine in a `worker_threads` worker (registry `fallbackReach:
'host'`) — the native addon `@seanhogg/bfi-node` where it ships (GPU and multi-threaded
CPU, a native KV budget of a quarter of the RAM share, 512 MiB–2 GiB, on the CPU), else
the same wasm — so a `local/bfi/…` pin is served with the chat panel closed; in the editor the
host's file cache is the ONE copy of a model — the webview's model store is a view of
it and its engine streams the bytes back over the bridge.

**Served context.** The KV cache is f16 when the adapter offers `shader-f16`, else f32,
and is capped by `kvBudgetBytes` (default 2 GiB). A load tries the planned context, halves
it (step 256) on a WebGPU out-of-memory scope down to `min(2048, trained)`, and reports
what it allocated in `contextTokens`. Planned, no OOM: Bonsai 8B / 4B 14,336 (f32 7,168),
1.7B 18,688 (f32 9,216). The `bfi` probe reports `contextFor` over the catalog row's `kv`
shape before a load and the allocated value after one, so hand-off packs to the window the
device serves — never the trained 65,536.

GGUF `Q1_0` (PrismML fork, group 128): `block_q1_0 { f16 d; u8 qs[16]; }` — 18 bytes per
128 weights; weight `j` = `((qs[j/8] >> (j%8)) & 1) ? +d : -d`. Confirm the type id and
bit order against `PrismML-Eng/llama.cpp` (`ggml.h`, `ggml-quants.c`) before shipping.

### 3.2 `@builderforce/local-inference` (pure, data)

- Page runtimes join the registry with `reach: 'page'`: `bfi` (label **Builderforce engine**)
  and `webllm` (label **WebLLM**), each with its own `http://<id>.local` base URL.
- `LOCAL_MODEL_CATALOG: readonly LocalCatalogModel[]` — DATA, one row per offered model:
  `{ ref, runtime, model, label, family, params, bytes, contextTokens (trained), kv?:
  { layers, kvHeads, headDim }, tools, source:
  { kind: 'hf-file', repo, file } | { kind: 'webllm', modelId }, requires: { f16?: boolean,
  minBufferBytes } }`. A picker, a fit check and a download manager all read it.
- `localModelFit(model, support)` → `{ fits: true } | { fits: false, reason }` (pure).

### 3.3 `@seanhogg/builderforce-memory/handoff` (pure, Worker/browser/Node safe)

```ts
export interface HandoffMessage { role: 'system'|'user'|'assistant'|'tool'; content: unknown;
  tool_calls?: unknown; tool_call_id?: string }
export interface HandoffPackInput {
  messages: readonly HandoffMessage[];
  targetContextTokens: number;        // the NEXT model's window
  reserveOutputTokens: number;
  toolsTokens?: number;               // advertised tool schemas
  from?: string; to?: string;         // model refs, for the hand-off note
  recall?: (query: string, budgetChars: number) => Promise<string>;   // memory block
  summarize?: (dropped: readonly HandoffMessage[]) => Promise<string>;
  estimateTokens?: (text: string) => number;                           // default chars/4
  timeoutMs?: number;                 // bounds summarize + recall; none by default
}
export interface HandoffPack { messages: HandoffMessage[]; dropped: number; summarized: boolean;
  recalled: boolean; estimatedTokens: number; fits: boolean }
export function packHandoff(input: HandoffPackInput): Promise<HandoffPack>;
```

Rules: the system message stays; the latest user directive stays verbatim; an assistant
`tool_calls` message and its `tool` results are never split; the verbatim tail takes what
the budget allows; the dropped middle becomes ONE assistant note — the summary when
`summarize` succeeds, else the memory recall for the latest directive, else an elision
marker — prefixed with a one-line hand-off note (`from → to`) when they differ. The result
never exceeds `targetContextTokens − reserveOutputTokens − toolsTokens` (`fits:false` only
when the system message + directive alone exceed it).

### 3.4 Hosts

- brain-embedded runs `packHandoff` whenever the model about to serve differs from the last
  one, or its known window is smaller than the working budget; local-first applies it per
  local attempt. Trace: `llm.handoff { from, to, dropped, summarized, recalled }`.
- Page engines implement one `PageEngine` contract (probe → `LocalRuntimeProbe | null`,
  never downloading; `chatCompletions(request, signal)` → OpenAI chunks) and share ONE fetch
  shim; the Prompt API engine is refactored onto it.
- Downloads happen from the picker, into Cache Storage, with progress and delete — with
  ONE exception (operator decision 2026-10-24): in the VSIX with the native engine, the
  first unpinned local-first turn with no Bonsai cached starts one background download of
  the largest recommended Bonsai the device fits, up to 4B (`hostBfi/provision.ts`). That
  turn goes to the cloud; later turns run on Bonsai.
- VSIX: Synapse's engine runs INSIDE the editor as a native addon (`@seanhogg/bfi-node`,
  `packages/bfi-node`: napi over `bfi-engine`, the core `bfi-web` shares) in the extension
  host's `bfi` worker — native wgpu (Vulkan; Metal on macOS) or every CPU core, with the
  native KV budget — and its bridge port is PREFERRED over the webview's. Where no addon
  ships for the platform (or it will not load), the worker runs the wasm on the CPU and
  the webview's worker serves WebGPU, as before. Rovr: in the side panel. Web: in the page.
- Automatic local-first ranks our engines first (WebLLM, `bfi`, Synapse, the browser's
  model) and a third-party server (Ollama, FreeToken) last; Ollama's window is the one it
  SERVES (`/api/ps`), never the trained length.
- `bfi-web` is vendored at `packages/bfi-web` (`@seanhogg/bfi-web`, private, consumed by
  `link:`; `scripts/vendor-bfi-web.mjs` rebuilds it and `--check` holds it to
  `SOURCE.json`). ONE loader, `loadBfiWeb`/`bfiWebLoader` in brain-embedded's `/bfi` entry
  (kept off the root because the package is unpublished), initializes the wasm once; each
  host supplies only the binary's URL — web: `@seanhogg/bfi-web/wasm-url` (a relative
  `new URL` webpack/Turbopack emit); VSIX webview: Vite `?url`; Rovr: `build.mjs` copies the
  file and the panel passes `chrome.runtime.getURL`.

## 4. Not in scope

Training, quantizing, vision input, multi-GPU, publishing `bfi-web` to npm (vendored build
until the operator approves a public package).
