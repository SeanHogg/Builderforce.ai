/**
 * The package surface for what runs ON THIS DEVICE, in the page: the in-page engines, the
 * browser's built-in model and its Prompt API, and the on-device task port. Split out of
 * `index.ts`, which re-exports all of it (`export *`), so the barrel stays a table of contents.
 */

// The engines that run INSIDE the page (PRD 34): one `PageEngine` contract, one fetch shim
// that answers each engine's OpenAI chat route, and one model store the picker drives.
// The browser's built-in model (its vendor id from `builtInAi/identity`), WebLLM (lazy
// chunk) and our WebGPU `bfi` (host-vendored wasm) each implement it;
// `createPageEngineSet` composes them for a host. `promptApi` is the ONE detection of the
// Prompt API surface.
export { createBrowserEngineProber, toPromptApiTurn } from './browserEngine';
export type { BrowserEngineProber } from './browserEngine';
// PRD 42 · Part A1 — which built-in model THIS browser ships, as data.
export { BUILT_IN_MODELS, builtInModelIdentity } from './builtInAi/identity';
export type { BuiltInAiVendor, BuiltInModelIdentity, NavigatorLike } from './builtInAi/identity';
// PRD 42 · Part A2 — the opt-in download (picker only) and its hardware-requirement label key.
export { BUILT_IN_REQUIREMENT_KEY, downloadBuiltInModel } from './builtInAi/download';
// PRD 42 · Part B — the ONE on-device task port (summarize / rewrite / write / proofread /
// detect / translate / json): the contract, the route table, and the two implementations
// (web/Rovr over the built-in APIs + page engines; any host over an on-device completion).
export type {
  DetectedLanguage, JsonSchema, JsonTaskOptions, OnDeviceEngine, OnDeviceObserver, OnDeviceTaskEvent, OnDeviceTaskKind,
  OnDeviceTasks, RewriteOptions, ServedBy, ServedOption, SummarizeOptions, TranslateOptions, WriteOptions,
} from './onDevice/onDeviceTasks';
export { utilityUsageObserver } from './localChat/utilityUsage';
export { observedTask, type ObservedTaskContext } from './onDevice/observedTask';
export { MAX_SUMMARY_CHUNKS, ON_DEVICE_TASK_ROUTES } from './onDevice/taskRoutes';
export { chunkedSummary, type ChunkedSummaryInput } from './onDevice/chunkedSummary';
export {
  completionOnDeviceTasks, servedByRef,
  type CompletionMessage, type CompletionOnDeviceOptions, type CompletionOnDeviceTasks, type OnDeviceCompletion,
} from './onDevice/completionOnDeviceTasks';
export { pageEngineCompletion, pageEnginesReady, pageOnDeviceTasks, type PageOnDeviceTasksOptions } from './onDevice/pageOnDeviceTasks';
// PRD 42 · Part D — client-first server routes: try the device, attach `clientResult`, retry once without.
export {
  capturingServed, isInvalidClientResult, jsonClientResult, pageClientFirst, textClientResult, withClientResult,
  type ClientFirstHost, type ClientResultEngine, type ClientResultPayload, type ClientResultProvenance,
} from './onDevice/clientFirst';
export { JUDGEMENT_SCHEMAS, judgeClientFirstFor, onDeviceJudgement } from './onDevice/clientFirstJudgement';
export { onDeviceTranscriptSummary } from './onDevice/clientFirstSummary';
export { PageEngineError } from './pageEngines/types';
export type { ChatCompletionChunk, ChatCompletionsRequest, PageEngine } from './pageEngines/types';
export { pageEnginesFetch, probePageEngines } from './pageEngines/fetchShim';
// Reaching a page engine across a boundary (editor host ↔ webview / worker, page ↔ Web Worker).
export {
  PAGE_ENGINE_REPLY_TYPES,
  PAGE_ENGINE_REQUEST_TYPES,
  isPageEngineReply,
  isPageEngineRequest,
  type PageEngineReply,
  type PageEngineRequest,
} from './pageEngines/remote/protocol';
export { servePageEngines, type PageEngineServerIo } from './pageEngines/remote/serve';
export {
  createPageEngineClient,
  type PageEngineClient,
  type PageEngineClientOptions,
  type PageEnginePort,
} from './pageEngines/remote/client';
export {
  ENGINE_WORKER_FATAL,
  ENGINE_WORKER_IDLE_MS,
  ENGINE_WORKER_INVALIDATE,
  createEngineWorker,
  isWasmTrap,
  serveEngineWorker,
  type EngineWorker,
  type EngineWorkerEndpoint,
  type EngineWorkerEvents,
  type EngineWorkerHandle,
  type EngineWorkerOptions,
} from './pageEngines/remote/engineWorker';
export {
  createBfiWorkerEngine,
  type BfiWorkerEngine,
  type BfiWorkerEngineOptions,
  type WorkerLike,
} from './pageEngines/bfiWorkerEngine';
export type { HfModelStore } from './pageEngines/hfModelStore';
export type { BfiEngineInstance, BfiEngineStatic, BfiModelInfo, BfiModule } from './pageEngines/bfiEngine';
export { deferredLocalModelStore } from './pageEngines/modelStore';
export type { LocalModelRow, LocalModelState, LocalModelStore } from './pageEngines/modelStore';
// How a picker lays that catalog out (curated rows by use, the rest behind "All models",
// unfit rows hidden) — the ONE rule brain-ui's `LocalModelList` renders in every host.
export { LOCAL_PICKER_GROUPS, localPickerView } from '@builderforce/local-inference';
export type { LocalPickerGroup, LocalPickerView } from '@builderforce/local-inference';
export { createPageEngineSet } from './pageEngines/pageEngineSet';
export { hasWebGPU } from './pageEngines/webgpu';
export { pageRuntimePin } from './pageEngines/pageRuntimePin';
export type { PageRuntimePin } from './pageEngines/pageRuntimePin';
export type { PageEngineSet, PageEngineSetOptions } from './pageEngines/pageEngineSet';
export {
  hasPromptApi,
  promptApiAvailability,
  promptApiFactory,
  promptApiInputQuota,
  promptApiMeasure,
  promptStreamDeltas,
} from './builtInAi/promptApi';
export type {
  PromptApiAvailability,
  PromptApiFactory,
  PromptApiMessage,
  PromptApiSession,
} from './builtInAi/promptApi';
