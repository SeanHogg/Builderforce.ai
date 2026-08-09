# PRD 22 — Browser Performance, Domain Execution, and Codebase Health

> **Status:** ACTIVE ANALYSIS AND CLEANUP PROGRAM · baseline audited 2026-08-08 · first
> deduplication slice implemented 2026-08-08 · **re-audited 2026-08-08 (§2.3 correction, §3.13–§3.17,
> §4.4, §6.7–§6.8, H-17…H-21)**. The re-audit added the two findings with the largest expected
> load-time effect — no browser read-through cache (§3.13) and a client-rooted route tree (§3.14) —
> and recorded that the strategic DDD layer is absent on the frontend rather than partial (§4.4).
> **Scope:** Static analysis of the browser-facing application, Studio and memory-engine execution
> seams, plus repository-wide architecture, duplication, cyclomatic complexity and backend-speed
> risks.
> **Depends on:** [PRD 20 — The Consolidated Data Model](./20-prd-consolidated-data-model.md) ·
> [PRD 21 — The Unified Experience](./21-prd-unified-experience.md)
> **Authority:** This document records evidence, priorities and acceptance gates. It does not by
> itself authorise a big-bang rewrite or a runtime migration; implementation proceeds as bounded,
> tested cleanup slices. The monthly non-token cap consolidation in §10 is the first completed slice.
> **Does not reopen:** PRD 20's kernel/domain ownership or PRD 21's canvas/panel and design-system
> decisions.

---

## 0 · Initial scoping directive

The operator's initial directive is the scope and decision rule for this analysis:

> a key feature of any application is its ability to perform at optimium speed in the browser; some actions shoudl run in webgl, some should run in webml, etc. some should be pushed directly into the users browser via PWA and/or WASM.  Logic is best structured within Domains.

For implementation purposes, this document interprets **WebML** as the browser machine-learning
execution layer available through **WebNN** and runtimes such as ONNX Runtime Web. WebGPU is the
preferred broadly useful GPU-compute path where WebNN is unavailable. WebGL remains a graphics
fallback; it is not the default general-compute target.

The directive does **not** mean that every operation should be moved to the most specialised
browser API. The rule is:

> **Put business policy in its owning domain. Put expensive work on the cheapest capable execution
> target that profiling proves suitable, without blocking the browser's interaction thread.**

That yields five distinct decisions:

1. **Domain placement:** which bounded context owns the policy and data transformation?
2. **Delivery:** should its code and assets arrive eagerly, on route entry, on feature activation,
   or through an installable/offline PWA path?
3. **Scheduling:** may it run on the interaction thread, or must it run in a worker?
4. **Compute backend:** JavaScript, WASM/SIMD, WebGL, WebGPU, WebNN, or a server?
5. **Fallback:** what happens on an unsupported, memory-constrained, offline, or lost-device path?

---

## 1 · Scope and method

### 1.1 Repositories and surfaces inspected

The workspace contains two substantial projects:

| Area | Role in this analysis |
|---|---|
| `Builderforce.ai/frontend` | Primary browser application: Next.js shell, Canvas, IDE, training, PWA |
| `Builderforce.ai/studio` | Browser video/ML engine: WebNN, WebGPU, WASM, IndexedDB, WebCodecs |
| `Builderforce.ai/studio-embedded` | React presentation and lifecycle integration for Studio |
| `Builderforce.ai/brain-embedded` | Browser conversation/orchestration package |
| `Builderforce.ai/browser-sdk` | Browser client surface |
| `builderforce-memory` | Supporting memory/model engine; inspected where frontend imports it |

The primary recommendations apply to `Builderforce.ai/frontend`. They do not propose relocating
server-authoritative tenancy, billing, permissions, audit, or collaboration policy into the browser.

### 1.2 Evidence standard

This is a static code audit, not a production trace. Findings are labelled as:

- **Observed:** directly present in source.
- **Likely consequence:** follows from the import or execution graph, but must be confirmed through
  a production build or browser performance trace.
- **Proposed:** a design to test, not a claim that it will necessarily be faster.

The existing `.next` directory did not contain deployable `.next/static/chunks` during the audit,
so this document does not invent route bundle sizes. Bundle conclusions must be verified with a
fresh production build and bundle analyser before and after a change.

### 1.3 Existing engineering constraint

`AGENTS.md` requires the dependency direction:

```text
presentation -> application -> domain -> infrastructure
```

Presentation owns view state, application coordinates use cases, domain owns business rules, and
infrastructure implements storage and runtime adapters. Findings below treat violations of this
rule as architecture defects even where current behaviour is correct.

---

## 2 · What is already correctly placed

This is not a greenfield browser-compute implementation. Several patterns already match the
directive and should be retained.

### 2.1 Local Mamba execution already has a worker boundary

`frontend/src/lib/mamba-worker-client.ts:35-38` creates a dedicated module worker:

```ts
function defaultWorkerFactory(): Worker {
  return new Worker(new URL('./mamba.worker.ts', import.meta.url), { type: 'module' });
}
```

`frontend/src/lib/mamba.worker.ts:25-27` supports transferable payloads:

```ts
function reply(msg: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length) self.postMessage(msg, transfer);
  else self.postMessage(msg);
}
```

The worker owns `init`, `generate`, `stream`, `train`, `export`, and `dispose` operations
(`mamba.worker.ts:35-80`). This is the reference pattern for other on-device model workloads.

### 2.2 Studio already routes across WebNN, WebGPU, and CPU

`studio/src/engine/device-router.ts:82-116` orders the automatic target probe as WebNN, WebGPU,
then CPU. ONNX sessions preserve a WASM fallback in
`studio/src/engine/diffusion-engine.ts:980-982`:

```ts
if (device === 'webnn') return { ...base, executionProviders: ['webnn', 'wasm'] };
if (device === 'webgpu') return { ...base, executionProviders: ['webgpu', 'wasm'] };
return { ...base, executionProviders: ['wasm'] };
```

The engine also releases ONNX sessions and destroys an owned `GPUDevice`
(`diffusion-engine.ts:418-451`). This is the required lifecycle standard for every GPU-backed
domain adapter.

### 2.3 Heavy IDE/editor features demonstrate activation-time delivery

`frontend/src/components/creation-canvas/CanvasBuildPanel.tsx:21` defers the IDE:

```ts
const IDE = dynamic(
  () => import('@/components/IDE').then((m) => m.IDE),
  { ssr: false },
);
```

The direct IDE route uses the same pattern at `frontend/src/app/ide/[id]/page.tsx:20`.

**Correction (2026-08-08 re-audit).** This precedent is far narrower than an earlier draft of this
document implied. `next/dynamic` appears in exactly **four** files across all of `frontend/src`:
`app/ide/[id]/page.tsx`, `components/CodeEditor.tsx`, `components/agent/FileChangeViewer.tsx`, and
`components/creation-canvas/CanvasBuildPanel.tsx`. There are zero `React.lazy` call sites. Runtime
`await import(...)` appears in roughly 69 places, mostly inside `lib/` modules, which does split
chunks but does not defer any component subtree.

Component-level code splitting is therefore **not an established pattern to expand — it is a pattern
to introduce.** §5 Phase 1 must be scoped as introduction, with a per-route owner list, not as
"add two more `dynamic()` calls".

### 2.4 The PWA has a controlled update protocol

`frontend/public/sw.js:9-19` documents a stamped build version, waiting service worker, visible
update prompt, and explicit `SKIP_WAITING`. This avoids silently replacing a running application
under the user.

---

## 3 · Findings, evidence, and required direction

### 3.1 P0 — The application shell likely delivers the Canvas and training graph eagerly

**Observed.** `frontend/src/components/AppShell.tsx:14` statically imports the Canvas stage:

```ts
import { CanvasStage } from './canvas/CanvasStage';
```

`CanvasStage.tsx:6` statically imports `CreationCanvas`, and `CreationCanvas.tsx:81,107` statically
imports modality panels including `VoiceConfigPanel` and `AITrainingPanel`:

```ts
import { VoiceConfigPanel } from '@/components/ide/VoiceConfigPanel';
import { AITrainingPanel } from '@/components/AITrainingPanel';
```

`AITrainingPanel.tsx:24-28` then statically imports the trainer and model types:

```ts
import { WebGPUTrainer, canTrainInBrowser, ... } from '@/lib/webgpu-trainer';
import { MambaEngine } from '@/lib/mamba-engine';
import type { HuggingFaceTokenizerSpec } from '@seanhogg/builderforce-memory-engine';
```

`webgpu-trainer.ts:33` has a runtime import from `@seanhogg/builderforce-memory-engine`.

**Likely consequence.** A signed-in route that renders `AppShell` can download and parse the Canvas
dependency graph even when `stageActive` is false. This makes the statement at
`AppShell.tsx:64-67` incomplete:

```ts
// Everyone who has not opened a canvas pays nothing: `stageActive` is false ...
```

They may pay nothing in mounted Canvas work, but the static import graph may still impose network,
parse, compile, and memory costs.

**Direction.** Make activation boundaries explicit:

```ts
const CanvasStage = dynamic(
  () => import('./canvas/CanvasStage').then((module) => module.CanvasStage),
  { ssr: false },
);

const AITrainingPanel = dynamic(
  () => import('@/components/AITrainingPanel').then((module) => module.AITrainingPanel),
  { ssr: false },
);
```

The stage must remain mounted after it opens, as required by PRD 21. Dynamic first activation and
persistent mounting are compatible requirements.

**Proof required.** Compare initial JS transferred, JS parsed, total blocking time, and heap usage
for dashboard, workforce, and Canvas routes before and after the split.

### 3.2 P0 — Browser LoRA training leaves substantial CPU work on the interaction thread

**Observed.** `frontend/src/components/AITrainingPanel.tsx:167-228` constructs and runs
`WebGPUTrainer` directly from a React event callback:

```ts
const trainer = new WebGPUTrainer({
  modelId: config.baseModel,
  // callbacks update React state
});

await trainer.init();
await trainer.train(params, fallbackExamples);
```

The trainer accelerates adapter operations, but still performs the following in its own caller:

- BPE tokenizer training: `webgpu-trainer.ts:276-278`
- model import/construction: `webgpu-trainer.ts:280-300`
- sequence tokenisation: `webgpu-trainer.ts:301-302`
- base-model forward/loss/backpropagation: `webgpu-trainer.ts:313-322`
- CPU-only `lora.fit` fallback: `webgpu-trainer.ts:328-329`
- safetensors and merged-package export: `webgpu-trainer.ts:346-365`

The inner training path is:

```ts
for (const sequence of sequences) {
  const merged = await gpuAdapter.forward();
  const saved = model.emb;
  try {
    model.emb = merged;
    model.zeroGrad();
    total += model.lossAndBackward(sequence);
    gpuAdapter.accumulate(Float32Array.from(model.gradients()[0]!.data));
  } finally {
    model.emb = saved;
  }
}
```

The only deliberate event-loop yield is after a full epoch at `webgpu-trainer.ts:338`:

```ts
await new Promise<void>((resolve) => setTimeout(resolve, 0));
```

**Likely consequence.** WebGPU queue submission may be asynchronous, but tokenizer work, base-model
autograd, array copying, and packaging can still produce long tasks and input latency.

**Direction.** Introduce a training-domain worker adapter modelled on the Mamba worker:

```text
training/presentation/AITrainingPanel
        |
        v
training/application/RunBrowserTraining
        |
        v
training/infrastructure/browser-training-worker-client
        |  progress / epoch / artifact / cancellation
        v
browser-training.worker
        |-- WebGPU adapter
        |-- WASM/SIMD or JS base model
        `-- tokenizer and artifact packaging
```

The worker must request its own GPU adapter/device. A `GPUDevice` must not be created on the main
thread and treated as transferable.

### 3.3 P0 — Training resource cleanup is incomplete

**Observed.** The adapter buffers have a destroy method at `webgpu-trainer.ts:167`, and the normal
completion path calls it at line 340. However, `gpuAdapter` is scoped inside the `try`; the catch
block at lines 388-395 cannot release it after an exception. `WebGPUTrainer.destroy()` at
lines 398-401 changes flags but does not destroy `this.gpuDevice`:

```ts
destroy(): void {
  this.stopped = true;
  this.ready = false;
}
```

**Direction.** The training domain adapter must implement deterministic disposal:

```ts
try {
  await runTraining();
} finally {
  gpuAdapter?.destroy();
  gpuDevice?.destroy();
  gpuAdapter = null;
  gpuDevice = null;
}
```

Disposal is required on completion, stop, exception, component unmount, worker termination, device
loss, and training-option changes.

### 3.4 P0 — Canvas presentation owns multiple application and domain responsibilities

**Observed.** `frontend/src/components/creation-canvas/CreationCanvas.tsx` is approximately 5,713
lines. The central `CanvasInner` starts at line 439 and the exported wrapper ends at line 5712.
Static counts during this audit found 88 `useState`, 43 `useEffect`, 21 `useMemo`, and 113
`useCallback` occurrences.

The component owns responsibilities from every layer:

| Responsibility | Evidence |
|---|---|
| Presentation/view state | `CreationCanvas.tsx:485-692` |
| Guest-room collaboration | `954-1028` |
| Live Evermind polling | `1030-1068` |
| Lock acquisition/renewal | `1403-1427` |
| Dataset import use case | `1429-1454` |
| History and undo/redo | `1456-1498` |
| Selection domain commands | `1500-1614` |
| Dataset query/profile/materialisation | `1616-1714`, `2700-2780` |
| Project/quality/application orchestration | `2066-2230` |
| Export orchestration | `4096-4153` |
| Diagnostics aggregation | around `4412` |

For example, a presentation callback performs a complete domain query and materialisation at
`CreationCanvas.tsx:1616-1659`:

```ts
const profile = profileTabular(source);
const result = queryTabular(source, {
  groupBy: category.name,
  aggregate: measure
    ? [{ op: 'sum', column: measure.name, label: measure.name }]
    : [{ op: 'count', label: 'count' }],
  sort: { column: measure ? measure.name : 'count', direction: 'desc' },
  limit: 8,
});
// React graph mutation follows in the same callback.
```

**Direction.** Establish the following domain boundary:

```text
frontend/src/domains/canvas/
  domain/
    graph.ts                 nodes, edges, invariants
    history.ts               commands, patches, checkpoints
    selection.ts             duplicate, copy, align, frame
    tabular.ts               profiles and query contracts
  application/
    ImportCanvasFile.ts
    MaterializeDataset.ts
    ShareCanvasSession.ts
    PersistCanvas.ts
  infrastructure/
    canvasSessionsGateway.ts
    guestRoomGateway.ts
    canvasPersistence.ts
    canvasDataWorkerClient.ts
  presentation/
    CreationCanvas.tsx
    CanvasInspector.tsx
    CanvasPanels.tsx
```

Presentation may coordinate display state and dispatch use cases. It must not parse files, own
collaboration transport, define graph invariants, or implement analytical queries.

### 3.5 P0 — A cross-domain API god module defeats ownership and code splitting

**Observed.** `frontend/src/lib/builderforceApi.ts` is approximately 363 KB and exposes 89
top-level API objects. Examples include:

- `toolsApi` at line 44
- `workflows` at line 926
- `tasksApi` at line 1758
- `managerApi` at line 2264
- `runtimeApi` at line 2759
- `dashboardApi` at line 2912
- `consumptionApi` at line 2968
- `membersApi` at line 3061

Representative unrelated clients coexist in the same module:

```ts
// builderforceApi.ts:44-57
export const toolsApi = {
  list: () => webRequest('/api/tools'),
  compute: (id, input) => webRequest(`/api/tools/${id}/compute`, ...),
};

// builderforceApi.ts:926-940
export const workflows = {
  list: (...) => request('/api/workflows...'),
  get: (id) => request(`/api/workflows/${id}`),
};

// builderforceApi.ts:2759-2779
export const runtimeApi = {
  submitExecution: (...) => request('/api/runtime/executions', ...),
  listForTask: (...) => request(...),
};
```

**Direction.** Move each client behind its owning domain's infrastructure port. Keep one small,
shared HTTP transport in infrastructure, but do not keep every domain contract in one module:

```text
domains/workflows/infrastructure/workflowsGateway.ts
domains/runtime/infrastructure/runtimeGateway.ts
domains/work/infrastructure/tasksGateway.ts
infrastructure/http/request.ts
```

This change is primarily about dependency direction and ownership. Smaller feature chunks are a
secondary benefit that must be verified rather than assumed.

### 3.6 P1 — File and dataset processing can block the interaction thread

**Observed.** `frontend/src/lib/officeFormats.ts:22` permits browser parsing of container files up
to 48 MiB:

```ts
export const MAX_PARSEABLE_BYTES = 48 * 1024 * 1024;
```

`canvasFileImport.ts:242-418` reads and parses files directly from the Canvas call path:

```ts
const triangles = parseMeshTriangles(await file.arrayBuffer(), meshFormat); // line 291
const read = await readDocx(await bytes(file));                              // line 344
const sheets = await readXlsx(await bytes(file));                            // line 358
const slides = await readPptx(await bytes(file));                            // line 363
const read = await readPdf(await bytes(file));                               // line 368
const source = parseTabularText(file.name, await file.text());               // line 400
```

The Office implementation performs ZIP scanning, decompression, XML regex iteration, sheet loops,
PDF stream scanning, and RTF parsing (`officeFormats.ts:45-610`). XLSX allows up to 50,000 rows at
`officeFormats.ts:410`.

Tabular profiling scans every value and sorts distinct-value counts
(`canvasTabularData.ts:125-159`). Queries derive, filter, group, aggregate, and sort rows
(`canvasTabularData.ts:284-366`). These functions are called synchronously from Canvas callbacks at
`CreationCanvas.tsx:1616-1714`.

**Direction.** Add a Canvas data worker with a narrow domain protocol:

```ts
type CanvasDataRequest =
  | { type: 'import'; id: string; name: string; mime: string; bytes: ArrayBuffer }
  | { type: 'profile'; id: string; source: TabularSource }
  | { type: 'query'; id: string; source: TabularSource; query: TabularQuery }
  | { type: 'mesh-preview'; id: string; format: MeshFormat; bytes: ArrayBuffer };
```

Transfer file buffers into the worker. Use streaming or incremental progress for large inputs.
Keep the 48 MiB safety ceiling until memory traces justify changing it.

**WASM decision.** Start with the existing TypeScript algorithms in a worker. Consider WASM/SIMD
for ZIP/XML, mesh, tabular, tokenisation, or diff algorithms only when benchmarks show a material
win after crossing and allocation costs are included.

### 3.7 P1 — Full-graph serialisation repeats after ordinary Canvas edits

**Observed.** Complete node/edge structures are repeatedly stringified:

- room snapshots: `CreationCanvas.tsx:954-977`
- Evermind binding key: `1030-1043`
- current graph mirror: `1070`
- history baseline and comparison: `1456-1477`
- undo/redo snapshots: `1481-1498`

The history effect is representative:

```ts
const next = JSON.stringify({ nodes, edges });
const handle = window.setTimeout(() => {
  if (historyBaseline.current !== next) {
    const change = describeGraphChange(
      JSON.parse(historyBaseline.current),
      { nodes, edges },
    );
    undoStack.current = [...undoStack.current.slice(-49), historyBaseline.current];
  }
}, 500);
```

**Likely consequence.** Cost grows with total graph payload, including embedded dataset rows and
artifact metadata, rather than with the size of the edit.

**Direction.** The Canvas domain should record immutable commands or patches and checkpoint full
snapshots periodically in a worker:

```ts
type CanvasCommand =
  | { type: 'node.move'; id: string; from: Point; to: Point }
  | { type: 'node.update'; id: string; before: CanvasData; after: CanvasData }
  | { type: 'selection.duplicate'; sourceIds: string[]; createdIds: string[] };
```

Collaboration can broadcast the same commands where ordering rules allow it. Persisted snapshots
remain necessary, but should not be the unit of every local edit.

### 3.8 P1 — The PWA offline fallback is not actually precached

**Observed.** `frontend/public/sw.js:25-29` precaches only:

```js
const PRECACHE_URLS = [
  '/manifest.json',
  '/icon-192.png',
  '/agentHost.png',
];
```

Navigation failure asks for `/` at `sw.js:69-73`:

```js
fetch(request).catch(() =>
  caches.match('/').then((r) => r ?? new Response('Offline', { status: 503 }))
)
```

Because `/` is not in `PRECACHE_URLS`, a fresh install has no guaranteed HTML fallback.

**Direction.** Precache a real, localised offline shell and route offline navigation to it. The
shell should explain which local capabilities remain usable and which require network access.

### 3.9 P1 — Service-worker and model caches need explicit storage policy

**Observed.** The service worker caches every same-origin, non-API GET response at
`frontend/public/sw.js:58-88`:

```js
if (request.method !== 'GET' || url.origin !== self.location.origin) return;
if (url.pathname.startsWith('/api/')) return;
// ...
if (res.ok) cache.put(request, res.clone());
```

There is no response-size, content-type, maximum-entry, maximum-age, range-request, or download
exclusion policy. A new build deletes the entire prior cache namespace at `sw.js:45-52`.

Separately, Studio documents multi-gigabyte model weights in
`studio/src/engine/weight-cache.ts:2-11` and stores them in an IndexedDB store named `weights`
(`weight-cache.ts:17-20`). No cache version metadata, last-access time, quota estimate, or eviction
policy is visible in that adapter.

**Direction.** Define storage classes:

| Class | Store | Policy |
|---|---|---|
| Hashed JS/CSS | Cache Storage | cache-first, immutable, build-version cleanup |
| Navigation shell | Cache Storage | network-first, guaranteed offline fallback |
| Images/fonts | Cache Storage | stale-while-revalidate, bounded entries and age |
| WASM runtime files | Cache Storage | explicit version and integrity policy |
| Model weights | IndexedDB/OPFS | model/version key, LRU metadata, quota-aware eviction |
| User drafts | IndexedDB | durable, schema-versioned, never evicted as disposable cache |
| API/customer data | domain store | explicit offline contract; never incidental response caching |

Before a large model download, call `navigator.storage.estimate()`. Offer persistent storage through
`navigator.storage.persist()` only in response to a user-visible offline/on-device action.

### 3.10 P2 — Do not replace the accessible 3D Canvas wholesale with WebGL

**Observed.** `frontend/src/components/canvas/Canvas3DView.tsx:122-133` explicitly chooses DOM and
CSS 3D transforms so every card remains focusable, textual, keyboard-operable, and visible to
assistive technology:

```ts
/**
 * Rendered as real DOM under CSS 3D transforms rather than a WebGL scene, which
 * is what keeps every card a focusable button with its own text ...
 */
```

That is a product requirement, not an accidental failure to use the GPU.

**Direction.** Preserve DOM cards. If traces show density-related rendering limits, test a hybrid:

- WebGL/WebGPU or `OffscreenCanvas` for edges, mesh surfaces, minimaps, selection backgrounds, and
  other dense non-semantic layers;
- DOM for focused, editable, selectable, and accessibility-visible objects;
- viewport culling for off-screen DOM nodes;
- an evidence-based object/edge threshold before switching renderers.

WebGL should remain a graphics path. New general compute should prefer WebGPU, WebNN, WASM, or a
worker-hosted CPU algorithm as appropriate.

### 3.11 P2 — Static image delivery leaves an avoidable initial-load cost

**Observed.** Next image optimisation is disabled globally at
`frontend/next.config.js:19`:

```js
images: { unoptimized: true },
```

The reason is valid: the Cloudflare Pages target does not implement Next's default image endpoint.
However, `frontend/public/images/hero/evermind-brain.png` is approximately 1.79 MiB and is loaded as
a priority image by `frontend/src/components/BrainBackdrop.tsx:142-147`:

```tsx
<Image
  src="/images/hero/evermind-brain.png"
  priority
  sizes="(max-width: 700px) 92vw, 760px"
/>
```

With optimisation disabled, `sizes` does not produce responsive source variants.

**Direction.** Pre-generate responsive AVIF/WebP variants during the build or use Cloudflare image
resizing. Retain the original only where its resolution is actually required.

### 3.12 P2 — The dependency-free diff algorithm is intentionally bounded, but belongs off-thread

**Observed.** `frontend/src/lib/unifiedDiff.ts:12-25` uses an O(n*m) LCS matrix and caps input at
1,200 combined lines:

```ts
const MAX_DIFF_LINES = 1200;
const dp: number[][] = Array.from(
  { length: n + 1 },
  () => new Array(m + 1).fill(0),
);
```

The cap prevents unbounded work, but the maximum case still allocates and traverses a large nested
array on the caller's thread.

**Direction.** Move diff construction behind the IDE/review domain's worker if performance traces
show long tasks. A WASM diff implementation is optional and must beat the worker-hosted TypeScript
path on representative files.

### 3.13 P0 — The browser has no canonical read-through cache, and three ad-hoc ones instead

**Observed.** The API enforces a single read-through caching contract (`getOrSetCached`, L1 isolate
Map + L2 KV, invalidated on write). The browser has **no equivalent primitive at all**. There is no
`@tanstack/react-query`, no SWR, and no other cache/dedup layer in `frontend/package.json`.

`frontend/src/lib/apiClient.ts` — the single sanctioned transport, and the only thing
`check-api-transport.mjs` guards — is 274 lines with **zero** occurrences of `cache`, `dedup`,
`inflight`, or a request map. It issues a `fetch` per call, every call.

**270 modules** import `@/lib/builderforceApi`. Combined with 1,034 `useEffect` call sites, the
default data-access shape is "component mounts → fires its own request". Two components needing the
same list issue two requests; a remount re-issues them; navigation re-issues them.

Three hand-rolled partial caches have grown up around the gap, each with a comment acknowledging it
is a client mirror of the server contract:

- `frontend/src/lib/api.ts:51` — an in-flight promise map, *"cleared on settle"*, explicitly noted as
  standing in for *"the server's cross-isolate `getOrSetCached`, which can't run here"*.
- `frontend/src/lib/widgets/sharedSource.ts:15` — *"Client mirror of the server's read-through cache
  contract (`getOrSetCached`)"*.
- `frontend/src/lib/team/useTeamRoster.ts:14` — *"the same read-through rule the api keeps with
  `getOrSetCached`"*.

**Likely consequence.** Duplicate in-flight requests, refetch-on-every-mount, no stale-while-
revalidate, and no shared invalidation. Three independent cache policies means an invalidation bug
is fixed in one and not the others. This is precisely the "ad-hoc in-process Map caches" anti-pattern
the repository's own caching rule prohibits, and it is the single largest **perceived**
load-time defect on already-hydrated routes — the one users experience as "every tab reloads".

**Direction.** One browser-side read-through primitive owned by
`infrastructure/http/`, mirroring the server contract by name so the two are obviously the same idea:

```ts
// infrastructure/http/readThrough.ts
export function getOrSetClientCached<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  opts?: { ttlMs?: number; staleWhileRevalidate?: boolean },
): Promise<T>;

export function invalidateClientCache(keyOrPrefix: string): void;
```

Requirements:

1. In-flight dedup by key (one network request for N concurrent callers).
2. Explicit TTL plus opt-in stale-while-revalidate; no unbounded growth.
3. **Invalidation on write** — every mutating gateway call declares the key prefixes it dirties, the
   same discipline the API already keeps.
4. Version-token keys where the keyspace is unbounded (search, filtered lists).
5. All three existing ad-hoc caches migrate to it **in the same slice** that introduces it. A fourth
   parallel cache is a worse outcome than the current three.
6. `check-api-transport.mjs` extends to fail on a new hand-rolled `Map`-plus-TTL cache in `src/lib/**`,
   the same way it already fails on a second `fetch`.

Adopting a library (`@tanstack/react-query`) is an acceptable implementation of this contract, but the
domain gateways must depend on the **contract**, not on the library, so the cache is replaceable.

**Proof required.** Request count and total transferred bytes for a dashboard → workforce → dashboard
navigation loop, before and after.

### 3.14 P0 — The application is a client-side SPA wearing an App Router

**Observed.** Of 1,227 `.ts`/`.tsx` files under `frontend/src`, **755 carry `'use client'`**. Of 137
`app/**/page.tsx` route entries, **68 are client components** — the page itself, not a leaf.

The root layout (`frontend/src/app/layout.tsx`) composes nine nested client context providers around
every route:

```tsx
<LocaleProvider>… <AuthProvider><CartProvider><EmulationProvider><RolePreviewProvider>
  <PermissionDebuggerProvider><ConfirmProvider><ToastProvider><DemoModeProvider>
```

**Likely consequence.** A `'use client'` page boundary forces its entire import subtree into the
client bundle regardless of whether the code is interactive, which is the *mechanism* behind §3.1 —
`AppShell.tsx:14`'s eager `CanvasStage` import is a symptom of a client-rooted tree, not an isolated
mistake. Dynamic-importing `CanvasStage` treats the symptom; it does not move a byte of the other 67
client pages. Additionally, a client-rooted page cannot stream, so first paint waits on hydration,
and every provider-level state change re-renders the shell subtree.

This finding **subsumes and outranks §3.1**: §3.1 is one edge of a graph whose root is here.

**Direction.**

1. Classify all 68 client pages: genuinely interactive at the root, or client-by-accident (a hook, a
   context read, or an event handler that belongs in a leaf).
2. Push `'use client'` down to the leaf that needs it. The page shell, data fetch, and static chrome
   become server components; `<Suspense>` boundaries stream the rest.
3. Split the provider stack: providers needed on **every** route stay in the root layout; the rest
   (`CartProvider`, `EmulationProvider`, `RolePreviewProvider`, `PermissionDebuggerProvider`,
   `DemoModeProvider`) move to the layouts of the route groups that use them.
4. Ratchet the counts. Both numbers may only fall.

**Constraint acknowledged.** The shell renders statically in the default locale and `LocaleProvider`
swaps to the cookie locale after hydration (`layout.tsx:125-126`). That decision is not reopened here,
but it does mean RSC conversion must be validated against locale-swap behaviour per route, and any
page converted to a server component must read its locale server-side rather than inherit the
post-hydration swap.

**Proof required.** Per-route first-load JS, and hydration time on the dashboard and workforce routes.

### 3.15 P1 — There is no frontend architecture ratchet

**Observed.** Every architecture ratchet in this repository is API-side. `api/scripts/` contains
`check-layering.mjs`, `check-domain-boundary.mjs`, `check-db-access.mjs`, `check-shape-lint.mjs`,
`check-signature-duplication.mjs` and twenty more; `.layering-baseline.txt` — the file §9.2's "127
known presentation files importing infrastructure" counts — lives at
`api/scripts/.layering-baseline.txt`.

`frontend/scripts/` contains three checks, wired into `npm test`: `check-api-transport.mjs`,
`check-design-tokens.mjs`, `check-design-scale.mjs`. **None of them enforces layering, module size,
complexity, or code splitting.**

`frontend/src/domains/` does not exist.

**Likely consequence.** §6.3 ("automated dependency checks enforce presentation → application →
domain") and §11.5's complexity/size ratchets have **no frontend implementation to extend**. Read
literally, §9.2's DDD verdict describes the API only; the frontend's layering state is not
*better or worse* than 127 violations, it is **unmeasured**. §3.4 and §3.5 propose the largest
structural moves in this document into a codebase with no guard to hold the result.

**Direction.** Phase 0 must land `frontend/scripts/check-layering.mjs` with its own baseline file
*before* Phase 3 moves anything, plus a size/complexity ratchet covering both areas. Ordering matters:
a ratchet added after the move records the move's mistakes as the baseline.

### 3.16 P2 — Config carries dead allowlist entries

**Observed.** `next.config.js:169-170` allowlists `api.fontshare.com` in `style-src` and
`cdn.fontshare.com`/`api.fontshare.com` in `font-src`, and `layout.tsx:153` comments *"Fontshare
loaded via CSS @import in globals.css"*. There is **no** `@import` in `globals.css` and **no**
reference to `fontshare` anywhere in `frontend/src`. The only font actually loaded is
`JetBrains_Mono` via `next/font/google`.

**Direction.** Remove the dead CSP entries and the stale comment. A CSP allowlist is a security
surface; entries that no longer correspond to a real dependency widen it for nothing. This is small,
but it is the kind of drift a document that claims a durable evidence index must not carry forward.

### 3.17 Ranking correction

The re-audit changes the priority order. §3.13 and §3.14 are the two findings with the largest
expected effect on **load time and perceived speed**, and neither appeared in the original draft:

| Rank | Finding | Why |
|---:|---|---|
| 1 | §3.14 client-rooted routing | Root cause of the delivery problem; §3.1 is a leaf of it |
| 2 | §3.13 no client read cache | Governs every post-hydration navigation; three divergent caches today |
| 3 | §3.4 / §3.5 ownership concentration | Governs maintainability and future splitting |
| 4 | §3.2 / §3.3 training thread + lifecycle | High severity, narrow blast radius (training users only) |
| 5 | §3.6 – §3.12 | Real, bounded, and correctly sequenced behind measurement |

§3.2 and §3.3 remain P0 by severity — an undestroyed `GPUDevice` is a leak, not a slow path — but
they affect the subset of sessions that open the training panel, whereas §3.13 and §3.14 affect
every session.

---

## 4 · Target architecture

### 4.1 Domain owns policy; infrastructure owns execution target

Domain code must not contain browser capability checks such as `navigator.gpu`, IndexedDB calls,
worker construction, ONNX provider names, or service-worker APIs. It defines the operation and its
invariants. Infrastructure selects the target.

```ts
// domains/training/domain/TrainingEngine.ts
export interface TrainingEngine {
  train(request: TrainingRequest, signal: AbortSignal): AsyncIterable<TrainingEvent>;
}

// domains/training/infrastructure/WorkerTrainingEngine.ts
export class WorkerTrainingEngine implements TrainingEngine {
  // Worker protocol, transferables, device-loss mapping, lifecycle.
}

// domains/training/infrastructure/RemoteTrainingEngine.ts
export class RemoteTrainingEngine implements TrainingEngine {
  // Authorised server job transport.
}
```

The application layer selects an implementation through a capability and policy service. The
presentation receives events and renders state; it never imports ONNX or the memory engine.

### 4.2 Execution-policy matrix

| Workload | Default | Fallback | Delivery | Owner |
|---|---|---|---|---|
| Canvas gestures and accessible cards | DOM/CSS main thread | reduced-effects DOM | Canvas activation | Canvas presentation |
| Canvas import/profile/query | dedicated worker | bounded main-thread JS for tiny input | Canvas data activation | Canvas domain |
| Mesh parsing/preview | worker JS; benchmark WASM | attachment-only preview | file activation | Canvas domain |
| Dense edges/minimap | DOM/SVG initially; benchmark GPU/OffscreenCanvas | DOM/SVG | density threshold | Canvas presentation adapter |
| Mamba inference/training | existing worker + WebGPU/CPU | cloud/provider cascade | request activation | Inference domain |
| LoRA training | worker + WebGPU/WebNN/WASM as supported | remote training or worker CPU | training activation | Training domain |
| Video generation | Studio WebNN/WebGPU/WASM | explicit unsupported/server path | video activation | Studio domain |
| Voice inference | worker-capable WebGPU/ORT | CPU/server | voice activation | Voice domain |
| IDE/editor | WebContainer + workers | server workspace | project activation | IDE domain |
| Offline shell and drafts | service worker + IndexedDB | network recovery | PWA install/use | Shell + owning domains |

### 4.3 Capability routing contract

One infrastructure service should return facts, not product policy:

```ts
interface BrowserCapabilities {
  worker: boolean;
  offscreenCanvas: boolean;
  webgpu: boolean;
  webnn: boolean;
  wasmSimd: boolean;
  wasmThreads: boolean;
  crossOriginIsolated: boolean;
  webCodecs: boolean;
  storageEstimate?: { quota: number; usage: number };
}
```

Each domain then decides what those facts mean. A Canvas renderer and a training engine should not
share a global `canUseGPU` boolean because their requirements differ.

### 4.4 Where this document is and is not Domain-Driven

The layering in §4.1 is correct and the ports are correctly shaped. But **layering is not DDD** —
it is the hexagonal/clean-architecture half. The tactical patterns are present; the strategic ones
are largely absent. Named honestly:

| DDD element | State in this document | Required correction |
|---|---|---|
| Layered architecture | ✅ Explicit and enforced (§4.1) | — |
| Ports and adapters | ✅ `TrainingEngine` + two adapters (§4.1) | — |
| Repository / gateway | ✅ §3.5 gateway split | — |
| **Bounded contexts** | 🟡 Named ad hoc — "Canvas domain", "Training domain", "Inference domain", "Voice domain" appear in §4.2 with no defining list | Publish the frontend context list and align it to PRD 20's 15 backend contexts |
| **Context map** | ❌ Absent | Declare each relationship: shared kernel, customer/supplier, conformist, or anti-corruption layer |
| **Aggregates and roots** | ❌ Absent | §3.4 proposes `graph.ts`/`history.ts`/`selection.ts` — modules, not aggregates. Name the root and its invariant |
| **Ubiquitous language** | ❌ Absent | The same concept is `CanvasData`, `node`, `object`, `card` and `creative` across surfaces |
| **Domain events** | ❌ Absent | §3.7's `CanvasCommand` is a command union; collaboration/undo/persistence need the event side too |
| **Anti-corruption layer** | ❌ Absent | ONNX/WebGPU/WebContainer/HuggingFace vocabulary would otherwise leak inward |
| **Invariant enforcement** | 🟡 Asserted, never specified | State the invariants that make an operation illegal |

Four corrections this document needs to actually claim DDD:

**(a) Aggregates before modules.** §3.4 splits `CreationCanvas.tsx` by *topic*, which is a file-layout
decision. The DDD question is: what is the consistency boundary? A defensible answer:

> **`CanvasBoard` is the aggregate root.** Nodes and edges are entities inside it and are never
> addressed from outside except through the root. Invariants: no edge may reference a missing node;
> node ids are unique within the board; a locked board rejects every mutating command; a command that
> would violate an invariant is rejected *before* it enters history.

Without that, `graph.ts` is a folder of functions and the invariants stay where they are today —
implicit in React callbacks.

**(b) Commands and events are different things.** §3.7's `CanvasCommand` is an *intent* — it can be
rejected. Collaboration broadcast, undo, and persistence should ride the *fact* that follows:

```ts
// intent — may be rejected by the aggregate
type CanvasCommand = { type: 'node.move'; id: string; to: Point };

// fact — already happened, safe to broadcast/persist/replay
type CanvasEvent   = { type: 'node.moved'; id: string; from: Point; to: Point; at: number };
```

Broadcasting commands (as §3.7 currently allows: *"Collaboration can broadcast the same commands"*)
means every peer re-runs validation and may legitimately disagree — a divergence bug, not a
performance bug. Broadcast events; keep command validation on the originating aggregate.

**(c) Context alignment is a decision, not an accident.** PRD 20 established 15 backend bounded
contexts. §4.2 introduces frontend "domains" with no stated relationship to them. Every frontend
context must declare one:

- **Conformist** — the frontend adopts the backend's model as-is (most CRUD surfaces).
- **Anti-corruption layer** — the frontend keeps its own model and translates (Canvas, whose graph
  model is genuinely browser-native and must not be dragged toward the persistence shape).
- **Shared kernel** — one model, changed only by joint agreement (tenancy, permissions, plan
  entitlement).

Unstated, the default outcome is that backend table shapes leak into component props, which is what
§3.5's god module already demonstrates at 8,408 lines.

**(d) Ubiquitous language has a gate, or it does not exist.** Add a glossary to the Canvas domain and
assert it — the repository already proves the technique works with
`api/scripts/check-prompt-tool-names.mjs`, which pins prompt vocabulary to advertised tool names.

**Verdict.** §9.2's "partially Domain-Driven" is accurate for the API and **generous for the
frontend**, where the finding is not partial adoption but absence of the strategic layer entirely.
The corrections above are the difference between this program producing *smaller files* and producing
*owned domains*.

---

## 5 · Delivery sequence

### Phase 0 — Measurements and guardrails

1. Add production bundle reports for initial shell, dashboard, Canvas, IDE, training, voice, and
   Studio routes.
2. Add browser performance scenarios for Canvas open, 500-object pan/zoom, 48 MiB import rejection
   or parse, dataset profile, local training, and Studio initialise/dispose.
3. Record long tasks, INP, heap, GPU memory where available, transferred bytes, and storage use.
4. Add a CI maximum for initial shell JS only after a trustworthy baseline exists.
5. **Land `frontend/scripts/check-layering.mjs` with its own baseline file, plus size/complexity
   ratchets covering both `api` and `frontend` (§3.15).** These must exist *before* Phase 3 moves
   code, or the move's mistakes become the baseline.
6. **Record the `'use client'` census as a ratchet** (755/1,227 files, 68/137 pages) — both numbers
   may only fall (§3.14).
7. **Record the client request census** — requests and transferred bytes for a
   dashboard → workforce → dashboard navigation loop (§3.13).

### Phase 1 — Delivery and data-access boundaries

1. **Introduce the browser read-through primitive** `getOrSetClientCached` + `invalidateClientCache`,
   and migrate all three ad-hoc caches (`lib/api.ts`, `lib/widgets/sharedSource.ts`,
   `lib/team/useTeamRoster.ts`) onto it in the same slice. Extend `check-api-transport.mjs` to reject
   a fourth hand-rolled cache (§3.13).
2. **Begin the client→server component conversion**, highest-traffic routes first. Split the root
   layout provider stack so route-specific providers move to their route groups (§3.14).
3. Dynamically load `CanvasStage` from the shell.
4. Dynamically load training, 3D, voice, game, Studio, and other modality panels from Canvas.
5. Confirm PRD 21's mounted-stage survival test remains green after first activation.
6. Remove the dead Fontshare CSP entries and stale comment (§3.16).

Steps 1 and 2 precede 3 and 4: dynamic-importing a component inside a client-rooted page recovers
much less than the same import inside a server-rooted one, and measuring 3–4 before 2 attributes the
gain to the wrong change.

### Phase 2 — Worker isolation

1. Move LoRA training into a dedicated worker, including tokenizer and packaging.
2. Route direct `MambaEngine` training calls in `AITrainingPanel.tsx:315-347` through the existing
   Mamba worker protocol rather than constructing an engine in the component.
3. Add the Canvas data/import worker with transferable file buffers.
4. Add deterministic cancellation and disposal tests.

### Phase 3 — Domain extraction

0. **Publish the frontend bounded-context list and its context map against PRD 20's 15 backend
   contexts** — each relationship declared conformist, ACL, or shared kernel (§4.4c). Nothing moves
   before its owner is named.
1. Name the `CanvasBoard` aggregate root and its invariants, then extract Canvas graph/history/
   selection policy behind it without changing behaviour (§4.4a).
2. Separate `CanvasCommand` (intent, validated by the aggregate) from `CanvasEvent` (fact, broadcast
   and persisted). Collaboration broadcasts events, never commands (§4.4b).
3. Extract Canvas application use cases and infrastructure gateways.
4. Split `builderforceApi.ts` into owning domain gateways over one HTTP transport, each consuming the
   Phase 1 read-through contract.
5. Add a Canvas glossary and a vocabulary check modelled on `check-prompt-tool-names.mjs` (§4.4d).
6. Reduce the Phase 0 frontend layering baseline; presentation cannot import infrastructure engines.

### Phase 4 — PWA and storage correctness

1. Add a real offline shell.
2. Define per-resource cache strategies and bounds.
3. Add model-cache metadata, versioning, storage estimates, and eviction.
4. Add user-visible download/storage controls for large on-device models.

### Phase 5 — Profile-driven GPU/WASM work

Only after phases 0-4:

1. Prototype hybrid GPU Canvas layers at measured density thresholds.
2. Benchmark WASM/SIMD candidates against worker-hosted TypeScript.
3. Retain an optimisation only when it improves representative p75/p95 measurements without
   accessibility, battery, memory, or compatibility regressions.

---

## 6 · Acceptance criteria

### 6.1 Delivery

- A non-Canvas signed-in route does not load `CreationCanvas`, the memory engine, ONNX Runtime,
  Studio, Monaco, or WebContainer before feature activation.
- Opening a Canvas loads its base chunk once and keeps the mounted stage alive across navigation.
- Opening a non-training Canvas does not load training-engine code.
- Production bundle reports identify each heavy chunk by owning domain.
- The `'use client'` file and page counts are ratcheted and strictly decreasing; a new client-rooted
  `page.tsx` requires a checked-in reason.
- The root layout carries only providers every route needs.

### 6.7 Client data access

- Exactly one browser read-through cache primitive exists; `check-api-transport.mjs` fails on a
  second hand-rolled `Map`-plus-TTL cache in `src/lib/**`.
- Concurrent callers of the same key produce one network request.
- Every mutating gateway call declares the key prefixes it invalidates; a write is observable on the
  next read without a full reload.
- Unbounded keyspaces (search, filtered lists) use a version token rather than accumulating entries.
- A dashboard → workforce → dashboard navigation loop issues strictly fewer requests than baseline.

### 6.8 Domain-Driven Design

- The frontend bounded-context list is published, and each context declares its relationship to a
  PRD 20 backend context (conformist, anti-corruption layer, or shared kernel).
- The Canvas aggregate root is named and its invariants are stated and tested; an invariant-violating
  command is rejected before it reaches history.
- Collaboration broadcasts domain events, not commands.
- A Canvas glossary exists and is asserted by a check.

### 6.2 Responsiveness

- Local training, Office import, mesh parsing, dataset profiling, and large diff generation produce
  no application-authored main-thread task over 50 ms in the agreed reference scenarios.
- Canvas pan, zoom, selection, typing, and drag remain responsive while a worker operation runs.
- Progress and cancellation remain observable; cancellation releases worker, GPU, and buffer state.

### 6.3 Domain architecture

- Presentation imports application/domain contracts, not ONNX, memory-engine, IndexedDB, worker,
  or raw transport implementations.
- Canvas business rules have one canonical domain implementation shared by UI and Brain tools.
- Each API gateway belongs to one bounded context; the shared layer contains transport mechanics,
  not cross-domain endpoint catalogues.
- Automated dependency checks enforce presentation -> application -> domain and infrastructure ->
  domain relationships.

### 6.4 PWA and storage

- A fresh installed PWA can render a branded offline shell without first visiting `/` online.
- Static, WASM, model, user-draft, and API data use separate documented storage policies.
- Model downloads check quota and failed writes do not corrupt the active model record.
- Model versions can be enumerated and removed; eviction never deletes user-authored drafts.
- Service-worker updates retain the existing visible, user-controlled activation flow.

### 6.5 Backend and fallback behaviour

- Training and Studio report the active backend: WebNN, WebGPU, WASM/CPU, or remote.
- Capability detection is feature-based; product copy does not infer support from a browser name.
- GPU device loss yields an actionable domain error and releases resources.
- Unsupported hardware degrades explicitly instead of silently attempting an unsafe workload.

### 6.6 Accessibility and product behaviour

- The Canvas retains keyboard, focus, screen-reader, reduced-motion, touch, and 360 px parity.
- A GPU Canvas layer never becomes the only semantic representation of an object.
- Offline and local-only modes clearly state which operations remain local and which require a
  network/server boundary.

---

## 7 · Non-goals

- Moving tenant-authoritative policy or sensitive secrets into downloadable browser code.
- Rewriting accessible DOM surfaces in WebGL merely because GPU rendering exists.
- Replacing tested TypeScript with WASM without representative benchmarks.
- Precaching the entire authenticated application or multi-gigabyte model catalogue.
- Keeping large model sessions alive after the feature that owns them has closed.
- Treating PWA installation as permission for unbounded background downloads.
- Combining domain extraction with behavioural redesign in one unreviewable change.

---

## 8 · Evidence index

| Finding | Primary evidence |
|---|---|
| Eager shell-to-training import chain | `frontend/src/components/AppShell.tsx:14`; `canvas/CanvasStage.tsx:6`; `creation-canvas/CreationCanvas.tsx:81,107`; `AITrainingPanel.tsx:24-28` |
| Canvas responsibility concentration | `CreationCanvas.tsx:439-5712`, especially `954-1714` and `4096-4412` |
| Browser training on caller thread | `AITrainingPanel.tsx:143-239`; `webgpu-trainer.ts:257-396` |
| Training cleanup gap | `webgpu-trainer.ts:305-340,388-401` |
| Existing worker precedent | `mamba-worker-client.ts:35-38`; `mamba.worker.ts:25-80` |
| Browser file parsing | `canvasFileImport.ts:232-418`; `officeFormats.ts:22,45-610` |
| Dataset compute | `canvasTabularData.ts:125-159,284-366`; `CreationCanvas.tsx:1616-1714` |
| Full graph serialisation | `CreationCanvas.tsx:954-1070,1456-1498` |
| API module breadth | `builderforceApi.ts:44-7390+`; 89 top-level API objects observed |
| Offline fallback gap | `frontend/public/sw.js:25-29,69-73` |
| Broad runtime caching | `frontend/public/sw.js:58-88` |
| Multi-GB weight cache | `studio/src/engine/weight-cache.ts:2-20,43-66,118-140` |
| Accessible CSS 3D decision | `frontend/src/components/canvas/Canvas3DView.tsx:122-133` |
| Unoptimised priority hero | `frontend/next.config.js:19`; `BrainBackdrop.tsx:142-147`; `public/images/hero/evermind-brain.png` |
| Bounded O(n*m) diff | `frontend/src/lib/unifiedDiff.ts:12-37,80-87` |
| No client read-through cache | `frontend/src/lib/apiClient.ts` (274 lines, zero cache/dedup); no `@tanstack/react-query`/`swr` in `frontend/package.json`; 270 modules import `@/lib/builderforceApi` |
| Three ad-hoc client caches | `frontend/src/lib/api.ts:51`; `frontend/src/lib/widgets/sharedSource.ts:15`; `frontend/src/lib/team/useTeamRoster.ts:14` |
| Client-rooted routing | 755 of 1,227 `frontend/src` files carry `'use client'`; 68 of 137 `app/**/page.tsx` are client components |
| Provider stack depth | `frontend/src/app/layout.tsx:170-197` — nine nested client providers around every route |
| Code splitting near-absent | `next/dynamic` in 4 files only (`app/ide/[id]/page.tsx`, `CodeEditor.tsx`, `agent/FileChangeViewer.tsx`, `creation-canvas/CanvasBuildPanel.tsx`); zero `React.lazy` |
| No frontend architecture ratchet | `frontend/scripts/` has only `check-api-transport`, `check-design-tokens`, `check-design-scale`; `.layering-baseline.txt` is at `api/scripts/`; `frontend/src/domains/` absent |
| Dead CSP allowlist | `frontend/next.config.js:169-170` allowlists Fontshare; no `@import` in `globals.css`, no `fontshare` reference in `frontend/src` |

Line numbers describe the 2026-08-08 working tree and will drift as implementation proceeds. File
names and quoted code are the durable evidence; implementation PRs must update this index when they
move the cited responsibility.

---

## 9 · Repository-wide codebase health baseline

The browser findings above are the highest-resolution performance analysis. This section adds the
repository-wide baseline needed to decide whether the implementing code is becoming easier to own.
Line counts and complexity figures are physical-source measurements from the tracked working tree on
2026-08-08. Generated output, migrations, tests and the embedded runtime are separated so a bundle or
fixture cannot make product code appear healthier.

### 9.1 Size and source composition

| Scope | Physical lines | Interpretation |
|---|---:|---|
| All tracked code | 1,586,932 | Includes migrations and obvious generated/bundled source |
| Maintainable code | 1,498,751 | Excludes migrations and obvious generated/bundled paths |
| Nonblank maintainable lines | 1,366,053 | Blank lines removed; comments remain |
| Production maintainable code | 1,139,629 | Tests excluded |
| Tests | 359,122 | Within the maintainable set |
| SQL migrations | 21,905 | Reported separately from application code |
| Obvious generated/bundled code | 66,276 | Minimum known generated footprint |

Largest areas at the snapshot:

| Area | Physical lines | Test lines |
|---|---:|---:|
| `agent-runtime` | 766,365 | 253,643 |
| `api` | 325,825 | 63,859 |
| `frontend` | 238,393 | 19,781 |
| `apps` | 96,004 | 9,983 |

The maintainable repository excluding `agent-runtime` is approximately **732,386 lines**. API and
frontend together are approximately **564,218 lines**. These are inventory figures, not reduction
targets: compact but unreadable code is not an improvement.

### 9.2 API layer distribution and DDD verdict

| Layer | Files | Lines | Share |
|---|---:|---:|---:|
| Application | 672 | 161,061 | 62.8% |
| Presentation | 177 | 61,267 | 23.9% |
| Infrastructure | 67 | 27,183 | 10.6% |
| Domain | 44 | 4,601 | 1.8% |
| API root/openapi/bootstrap | 5 | 2,399 | 0.9% |

The domain percentage is evidence, not a target. The useful test is whether domain decisions have one
domain owner and dependency direction is enforced.

The database is strongly domain-organised:

- 16 schema modules: kernel plus 15 bounded contexts.
- 623 Drizzle tables and 7,575 migrated columns at the audit snapshot.
- All 1,130 source tables classified and all 362 target domain tables written.
- All 245 consolidation tables reachable through the generic entity layer.
- Database-driver access restricted to `infrastructure/database/connection.ts`.

The application is **partially Domain-Driven**:

- Rich behavior exists for selected aggregates such as Task, Project, Tenant and workflows.
- Domain source has no reverse dependency into application, presentation or infrastructure.
- The layering ratchet currently reports **127 known presentation files importing infrastructure**,
  down from 144 before the concurrent cleanup; zero new violations are allowed.
- The domain-boundary ratchet reports **38 known cross-context schema imports**; zero new violations.
- Of 245 consolidated tables, 17 are reached by a named feature path while 228 are registry-only.
- Generic entity CRUD is a valuable canonical access layer, but is not a substitute for aggregate
  invariants and domain-specific use cases.

**Verdict:** database DDD is substantially ahead of application DDD. The delivery program must make
application boundaries converge on the database domains without manufacturing domain wrappers around
simple reference data.

### 9.3 Duplication baseline

Token clone detection used a conservative minimum of 15 lines and 90 tokens:

| Area | Clone groups | Duplicated lines | Rate |
|---|---:|---:|---:|
| API | 20 | 407 | 0.21% |
| Frontend | 47 | 1,276 | 0.51% |
| Combined | 67 | 1,683 | approximately 0.38% |

Broad “DRY everything” work has low expected value. Semantic duplication is the priority. The schema
signature ratchet identifies eight known duplicate-shape clusters:

1. `agent_host_skill_assignments` = `tenant_skill_assignments`
2. `board_type_mappings` = `import_type_mappings`
3. `drive_connections` = `mailbox_connections`
4. `initiatives` = `portfolios`
5. `kanban_template_lane_requirements` = `swimlane_requirements`
6. `marketing_tool_runs` = `tool_runs`
7. `platform_modules` = `tenant_custom_roles`
8. `project_manager_configs` = `tenant_manager_defaults`

### 9.4 Cyclomatic-complexity baseline

The TypeScript AST scan counts branches, loops, cases, catches, ternaries and boolean decision
operators. It is a ratchet metric rather than a claim that every branch has equal cognitive cost.

| Area | Production functions | CC > 15 | CC > 25 |
|---|---:|---:|---:|
| API | 14,561 | 341 | 100 |
| Frontend | 17,761 | 232 | 68 |

Highest-priority decision surfaces:

| Function | File | CC | Function lines |
|---|---|---:|---:|
| `Inspector` | `frontend/.../creation-canvas/CreationCanvas.tsx` | 184 | 299 |
| `managerFindings` | `frontend/src/lib/managerDiagnostics.ts` | 142 | 541 |
| `CanvasInner` | `frontend/.../creation-canvas/CreationCanvas.tsx` | 139 | 4,522 |
| `runCloudToolLoop` | `api/.../runtime/cloudAgentEngine.ts` | 125 | 652 |
| `handleContainerOp` | `api/.../runtime/cloudAgentEngine.ts` | 119 | 358 |
| `runManagerForProject` | `api/.../manager/ManagerService.ts` | 116 | 879 |
| LLM route handler | `api/.../presentation/routes/llmRoutes.ts` | 113 | 567 |
| `BrainService.agentReply` | `api/.../brain/BrainService.ts` | 87 | 599 |

Structural hotspots include `builderforceApi.ts` (8,408 lines), `CreationCanvas.tsx` (5,712),
`adminRoutes.ts` (3,774), `builtinMcpService.ts` (3,728), `llmRoutes.ts` (3,533),
`cloudAgentEngine.ts` (3,087), `TaskMgmtContent.tsx` (2,679), and `ManagerService.ts` (2,578).
File size locates ownership risk; moving the same branching into several files is not completion.

### 9.5 Backend and async performance-risk baseline

Static analysis found **311 production loops containing `await`** across the API, frontend and embedded
brain scope. This is a candidate register, not a defect count:

- Agent/model/tool turns are causally sequential.
- PR integration is intentionally serial because every merge moves the base branch.
- Retry, pagination and rate-limit loops often require ordering.
- Alert, webhook, QA, report and board-sync rows may be independent and are bounded-concurrency
  candidates.

Other static risks complement the browser-specific evidence in §3:

- Generic entity listing performs a page query and exact `COUNT(*)`. They already run concurrently and
  are cached, but exact count plus offset pagination scales poorly on large relations.
- Generic title search uses leading-wildcard `ILIKE '%query%'`; no `pg_trgm` declaration was found.
- `countScope` performs a `UNION ALL` count across every readable context table on a cold cache miss.
- The cloud loop performs substantial telemetry persistence between model/tool operations.

No latency improvement is claimed from this static evidence. §5 Phase 0 measurements are the gate.

---

## 10 · Current implementation and gate status

Status is factual and must be updated when evidence lands.

| Work item | Status | Evidence / remaining condition |
|---|---|---|
| Browser execution and delivery analysis | ✅ DONE | §§2–4 and evidence index §8 |
| LOC/language and API layer inventory | ✅ DONE | §9.1–9.2 |
| Database/application DDD audit | ✅ DONE | §9.2; architecture ratchets executed |
| Code clone and schema-shape audit | ✅ DONE | §9.3 |
| Complexity audit | ✅ DONE | §9.4 |
| Async-loop candidate audit | ✅ DONE | §9.5 |
| Monthly non-token cap policy dedupe | ✅ IMPLEMENTED IN CURRENT CHANGESET | One `application/shared/monthlyTenantCap.ts`; four ledgers consume it; 19 focused tests and both TS compilers pass; targeted clone count 0; net −47 lines |
| Migration prefix collision | ✅ RESOLVED IN CONCURRENT WORK | 382 migration files; no new duplicate prefixes; eight historical prefixes grandfathered |
| Presentation → infrastructure baseline | 🟡 IN PROGRESS | 144 → 127 known files; target 0 |
| Cross-context schema imports | 🟡 RATCHEted | 38 known; target 0 or an explicit kernel/view contract |
| Duplicate schema shapes | 🟡 RATCHEted | Eight known clusters; zero new |
| Shape-lint gate | 🔴 CURRENTLY RED FROM CONCURRENT SCHEMA WORK | `agent_definition_versions` newly matches kernel `revision`; resolve or explicitly adjudicate before merge |
| Full API test suite | ⏳ NOT RUN BY THIS AUDIT | Focused tests and type checks passed; full suite remains a delivery gate |
| Browser/runtime profiling | ⏳ NOT STARTED | Static evidence exists; no production measurements fabricated |
| React render profiling | ⏳ NOT STARTED | Begin with Creation Canvas interactions in §5 Phase 0 |
| Browser read-through cache primitive | 🔴 ABSENT | §3.13; `apiClient.ts` has no cache/dedup; three ad-hoc mirrors in `lib/api.ts`, `widgets/sharedSource.ts`, `team/useTeamRoster.ts` |
| Client→server component conversion | 🔴 NOT STARTED | §3.14; 68/137 pages and 755/1,227 files are `'use client'` |
| Component code splitting | 🔴 NEAR-ZERO | §2.3 correction; `next/dynamic` in 4 files, zero `React.lazy` |
| Frontend layering/complexity ratchet | 🔴 DOES NOT EXIST | §3.15; all layering ratchets are API-side; must land before Phase 3 |
| Frontend bounded-context list + context map | 🔴 NOT DEFINED | §4.4c; §4.2 names domains ad hoc with no PRD 20 alignment |
| Canvas aggregate root + invariants | 🔴 NOT DEFINED | §4.4a; §3.4 proposes modules, not a consistency boundary |
| Dead Fontshare CSP entries | 🟡 OPEN | §3.16; one-line removal in `next.config.js` + `layout.tsx:153` comment |

---

## 11 · Repository-wide architecture and cleanup workstreams

### 11.1 Presentation depends on use cases

For each of the 127 baseline files:

1. Identify the user-visible use case rather than the imported table.
2. Define or reuse a narrow application input/output contract.
3. Move persistence and query composition into an application service or repository adapter.
4. Inject the dependency into the route.
5. Remove the file from `.layering-baseline.txt` in the same change.

Work in bounded-context slices. Do not create one global service that hides every table behind a larger
interface.

### 11.2 Domain behavior owns invariants

Move a rule into domain code when it decides whether a transition is valid or what resulting state means,
can be expressed without I/O/framework dependencies, and is reused or dangerous to duplicate. Keep
retries, transactions, authorization context, provider calls, telemetry and scheduling in application
or infrastructure code.

### 11.3 Cross-context reads use explicit contracts

Reduce the 38 schema imports in this order:

1. Kernel primitive for genuinely shared concepts.
2. Named read model/view for another context's facts.
3. Application query service that composes outputs without transferring table ownership.
4. Direct schema import only as a documented temporary baseline entry.

### 11.4 Registry-only tables receive a disposition

Each of the 228 registry-only tables becomes exactly one of:

- **Feature-owned:** a named use case and route reaches it.
- **Reference/admin:** generic entity access is intentionally sufficient.
- **Migration-only:** retained while live rows move.
- **Dead target:** remove speculative schema.

Table count is not product completeness. Completion requires an intentional disposition.

### 11.5 Complexity and source-size ratchets

Add a repository-owned checker with actionable file/line/function output:

- New functions must have CC ≤ 15.
- Existing functions above 15 may not increase.
- Existing functions above 25 require a named reduction task when touched materially.
- No new production file above 800 physical lines without a checked-in exception and owner.
- Generated/bundled files and declarative schema modules are classified separately.

### 11.6 Behavioral seam reductions

- **Creation Canvas:** implement the ownership split in §3.4 and add separate reducers/gateways for
  document state, collaboration, persistence, selection, import and rendering subscriptions.
- **Cloud engine:** model cancellation/steering, compaction, completion/cascade, tool dispatch,
  governance approval, finish validation and persistence as explicit state transitions. Preserve causal
  ordering.
- **Manager service:** separate planning, triage, queue policy, provider operations, recovery dispatch
  and action journaling. Keep base-moving PR operations serial; batch reads/writes around them.
- **Routes:** parsing, auth and response mapping remain presentation concerns; business branching and
  query/provider policy move behind application use cases.
- **Brain reply orchestration:** separate model/tool policy, persistence and surface notification behind
  narrow ports.

### 11.7 Semantic duplication priorities

1. Resolve the eight database shape clusters under PRD 20 before building abstractions around both shapes.
2. Consolidate Content, Persona and Skill assignment screens behind a typed assignment contract.
3. Share login/register layout and provider controls while retaining flow-specific state.
4. Continue the operational-ledger consolidation only where unit-specific columns and Drizzle typing stay
   explicit.
5. Align drive/mailbox route and service consolidation with PRD 20's `connection` primitive.
6. Extract repeated grouping, trend and evidence construction from allocation, bottleneck and lifecycle
   insights.
7. Consolidate web-container connection pages and manager stall surfaces after higher-leverage policy
   duplication is removed.

Clone rate is a guardrail, not a target to drive to zero. Similar code may remain separate when its change
reasons differ.

---

## 12 · Backend speed and execution controls

This section complements the browser execution policy in §§3–4.

### 12.1 Instrumentation

Capture by route/use case and tenant-safe dimensions:

- p50, p95 and p99 request latency.
- Query count and cumulative database time.
- External-provider time.
- Cache hit/miss and cold-fill duration.
- Cloud-agent time per model turn, tool dispatch and telemetry persistence.
- React commit duration and render count for the Canvas scenarios in §5.

Do not log secrets, prompt bodies, tenant data or raw SQL parameters.

### 12.2 Database reads

- Replace offset pagination with cursor pagination for measured high-volume entities.
- Make exact totals optional; use maintained/approximate counts where UX does not require exactness.
- Add `pg_trgm` GIN indexes only for measured high-volume leading-wildcard search columns.
- Verify `(tenant_id, order_column)` and `(tenant_id, foreign_key/status)` composite indexes against real
  plans.
- Replace cold `countScope` sweeps with maintained rollups only when telemetry proves material cost.
- Require representative `EXPLAIN (ANALYZE, BUFFERS)` evidence for index PRs.

### 12.3 Bounded concurrency

Classify every `await`-inside-loop candidate:

- **Causal:** remains serial.
- **Rate-limited:** bounded pool with provider/tenant limits.
- **Independent:** bounded pool, normally 4–8 operations.
- **Batchable:** one database/provider operation replaces N calls.

Add an allowlisted check so new sequential I/O loops require a classification comment. Never replace a
loop with unbounded `Promise.all`.

### 12.4 Telemetry and ledgers

- Preserve ordered business events.
- Move noncritical telemetry to an outbox or batch insert.
- Measure write count and time per agent step before and after.
- Keep fail-open/fail-closed semantics explicit per meter; current non-token meters fail open.

### 12.5 Frontend delivery and rendering

In addition to §§3–5:

- Split Canvas stores/subscriptions so inspector changes do not invalidate the entire graph.
- Lazy-load heavy inspectors and format-specific tools while preserving PRD 21's mounted stage.
- Split `builderforceApi.ts` into domain clients over one transport/auth core.
- Track route chunks and interaction latency; file splitting without bundle/render improvement is not a
  performance result.

---

## 13 · Consolidated delivery program

Section 5 remains the detailed browser-execution sequence. Repository-wide delivery wraps it as follows.

### Program phase 0 · Establish truth and stop regression — 🟡 IN PROGRESS

- Execute §5 Phase 0 browser measurements.
- Keep LOC, clone and complexity reports reproducible.
- Land complexity, file-size and sequential-I/O ratchets.
- Keep layering, domain, schema, migration and source checks green.
- Resolve the current `agent_definition_versions` shape decision.
- Record full API/frontend test results from a stable working tree.

### Program phase 1 · Low-risk policy and delivery cleanup — 🟡 STARTED

- Monthly non-token cap policy — implemented and verified.
- Complete §5 Phase 1 delivery boundaries.
- Assignment/auth/ledger/insight clone clusters.
- Presentation boundary cleanup by bounded context.
- Registry-only table disposition register.

### Program phase 2 · Worker isolation and complexity seams — ⏳ NOT STARTED

- Complete §5 Phase 2 worker isolation.
- Creation Canvas ownership split.
- Cloud agent state machine.
- Manager service/PR queue split.
- LLM/admin route adapters and Brain reply orchestration.

Every slice needs characterization tests before movement.

### Program phase 3 · Domain extraction and measured speed — ⏳ NOT STARTED

- Complete §5 Phase 3 domain extraction.
- Cursor pagination and optional totals.
- Targeted indexes and maintained rollups where evidence requires them.
- Bounded sweep concurrency and telemetry batching/outbox.
- React subscription boundaries and lazy chunks.

### Program phase 4 · PWA/storage correctness and schema duplicate retirement — ⏳ NOT STARTED

- Complete §5 Phase 4.
- Resolve the eight known schema-shape clusters under PRD 20.
- Migrate rows and callers before dropping a table.
- Reduce ratchet baselines in the same changes; never expand them instead of deciding ownership.

### Program phase 5 · Profile-driven GPU/WASM work — ⏳ NOT STARTED

Complete §5 Phase 5 only after delivery, worker, domain and storage boundaries are measured and stable.

---

## 14 · Additional repository-wide acceptance criteria

The browser criteria in §6 remain mandatory. These criteria cover the consolidated health program:

| ID | Criterion | Verification |
|---|---|---|
| H-1 | A reproducible source report separates production, tests, migrations, generated code and `agent-runtime` | CI artifact + fixture test |
| H-2 | No new presentation file imports infrastructure | Layering ratchet; baseline only shrinks |
| H-3 | No new cross-context schema import appears | Domain-boundary ratchet; baseline only shrinks |
| H-4 | Every registry-only table has one explicit disposition | Checked-in manifest + coverage test |
| H-5 | New functions have CC ≤ 15 and existing high-complexity functions cannot regress | Complexity ratchet |
| H-6 | New files above 800 lines require a checked-in exception; generated/schema files are separate | Size ratchet |
| H-7 | API/frontend clone rates do not exceed baseline and no new clone ≥15 lines/90 tokens appears without exception | Token clone check |
| H-8 | The eight schema-shape clusters can only shrink | Existing signature ratchet |
| H-9 | Every new async loop is classified causal, rate-limited, independent or batchable | Static check + review |
| H-10 | Performance changes include before/after p95 plus query/render evidence | PR evidence artifact |
| H-11 | High-volume generic endpoints use cursors or document why bounded offset is safe | Integration test + query plan |
| H-12 | Measured high-volume wildcard search has an appropriate plan or documented alternative | `EXPLAIN ANALYZE` evidence |
| H-13 | Canvas target interactions do not regress p95 commit time after ownership extraction | E2E + React profile |
| H-14 | Cloud/manager refactors preserve cancellation, steering, approval, finish gates and serial PR correctness | Characterization/integration tests |
| H-15 | Type checks, focused tests, architecture checks and migration checks are green for each slice | CI |
| H-16 | Optimisation never weakens tenancy, authorization, audit ordering or usage-cap semantics | Security/integration tests |
| H-17 | Exactly one browser read-through cache exists and every mutating gateway declares its invalidation keys | Extended `check-api-transport.mjs` + request-count test |
| H-18 | `'use client'` file and page counts strictly decrease; a new client-rooted `page.tsx` needs a checked-in reason | RSC census ratchet |
| H-19 | The frontend has a layering baseline that only shrinks, landed before any Phase 3 move | `frontend/scripts/check-layering.mjs` |
| H-20 | Every frontend bounded context declares a conformist / ACL / shared-kernel relationship to a PRD 20 context | Checked-in context map + review |
| H-21 | Canvas invariants are enforced by the aggregate, and collaboration broadcasts events rather than commands | Aggregate unit tests + collaboration divergence test |

Completion is not “all files are small.” Completion is zero unowned boundary violations, bounded new
complexity, shrinking duplicate baselines and demonstrated latency improvements on material paths.

---

## 15 · Consolidated risks and controls

| Risk | Control |
|---|---|
| Mechanical file splitting preserves complexity | Measure functions and transitions, not file count alone |
| Premature abstraction creates generic god services | Extract only canonical policy with a shared change reason |
| Parallelisation breaks ordering/provider limits | Classify loops and use bounded pools; keep causal paths serial |
| Indexes increase write cost without helping reads | Representative plans and before/after latency required |
| Domain extraction becomes a rewrite | Move one use case at a time behind characterization tests |
| Concurrent cleanup overwrites unrelated work | Check dirty targets and isolate slices by ownership area |
| LOC incentives produce compressed code | LOC is inventory only; boundary, complexity and latency are gates |
| Generic registry access is mistaken for adoption | Require explicit disposition and named feature paths where behavior exists |

The non-goals in §7 also apply to this program. In addition, this document does not authorise replacing
TypeScript, React, Drizzle or Hono; driving clone rate/domain percentage to an aesthetic number; deleting
migrations/audit history before a migration plan; or claiming speed from static analysis alone.

---

## 16 · Definition of done for each cleanup slice

Every implementation slice governed by this document includes:

1. The measured smell or latency problem and its current owner.
2. A bounded file set with dirty-worktree overlap checked before editing.
3. Characterization tests for behavior being moved.
4. The canonical owner after the change.
5. Focused tests, both API TypeScript checks for API changes, and relevant ratchets.
6. Before/after clone or complexity evidence for structural work.
7. Before/after latency/query/render evidence for performance work.
8. A factual update to §10 or the completion log when status materially changes.

Cleaner code without a preserved contract, or faster code without a measurement, is not complete.
