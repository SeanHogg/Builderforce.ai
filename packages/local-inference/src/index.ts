/**
 * `@builderforce/local-inference` — LOCAL FIRST (CPU/GPU), failover to cloud inference.
 *
 * Shared by every client that runs the agent loop on the user's machine (the VS Code
 * extension today, the Chrome extension next), so "which runtimes exist, what do they
 * serve, which model may take this turn, and when do we fall back to the cloud" is
 * answered once:
 *
 *  - the runtime REGISTRY (Synapse/bfi, Ollama, FreeToken, the page engines — WebGPU
 *    `bfi`, WebLLM, the browser's built-in model — and Kimi Code) and the
 *    `local/<runtime>/<model>` ref grammar;
 *  - the page engines' model CATALOG (WebLLM's rows generated from the library), the
 *    device FIT check a picker runs before a download, and the PICKER layout (curated
 *    rows by use, the rest behind "All models");
 *  - a never-throwing PROBE of what each runtime serves and can do;
 *  - the `CatalogView` binding that makes `@builderforce/model-router` price local at 0;
 *  - the PLAN (capable local model first, then the cloud) and the FAILOVER rule that
 *    runs it without ever splicing two answers together.
 *
 * Pure and host-neutral: `fetch` is injected, nothing touches Node, `vscode` or
 * `chrome`. The binding to the shared streamer is brain-embedded's
 * `localFirstTransport` (`createLocalFirstStream`, `completeLocalFirst`); settings and
 * endpoint discovery stay with each host.
 */

export {
  BFI_ENGINE_BASE_URL,
  BROWSER_ENGINE_BASE_URL,
  WEBLLM_ENGINE_BASE_URL,
  HOST_FALLBACK_RUNTIMES,
  HTTP_LOCAL_RUNTIMES,
  LOCAL_RUNTIMES,
  LOCAL_RUNTIME_IDS,
  isLocalRuntimeId,
  localRuntime,
  type LocalEndpoint,
  type LocalEndpoints,
  type LocalRuntime,
  type LocalRuntimeId,
  type LocalRuntimeReach,
  type LocalToolSupport,
} from './runtimes.js';
export { LOCAL_MODEL_PREFIX, clientPinOf, formatLocalModelRef, isLocalModelRef, parseLocalModelRef, runsOnDevice, servedOnDevice, servedRef, type ServedResult } from './ref.js';
export {
  GATEWAY_COMPLETIONS_PATH,
  LOCAL_COMPLETIONS_PATH,
  fetchLocal,
  localAuthHeaders,
  localChatCompletionsUrl,
  localModelsUrl,
  matchLocalChatEndpoint,
  normalizeLocalBaseUrl,
  rewriteToLocalUrl,
} from './endpoint.js';
export { BFI_DISCOVERY_ENV, BFI_DISCOVERY_RELATIVE_PATH, parseBfiDiscovery } from './discovery.js';
export {
  DEFAULT_PROBE_TIMEOUT_MS,
  createLocalRuntimeProber,
  ollamaLoadedModels,
  ollamaResidentModel,
  probeLocalRuntimes,
  probedModels,
  type FetchLike,
  type LocalModel,
  type LocalProbeOptions,
  type LocalRuntimeProbe,
  type LocalRuntimeProber,
  type OllamaLoadedModel,
} from './probe.js';
export { localCatalogView } from './catalogView.js';
export { BFI_CPU_LIMITS } from './bfiLimits.generated.js';
export {
  LOCAL_MODEL_CATALOG,
  LOCAL_MODEL_USES,
  isLocalChatModel,
  localCatalogFor,
  localCatalogModel,
  type LocalCatalogModel,
  type LocalModelSource,
  type LocalModelUse,
} from './catalog.js';
export {
  LOCAL_PICKER_GROUPS,
  localPickerGroup,
  localPickerView,
  type LocalPickerGroup,
  type LocalPickerOptions,
  type LocalPickerRow,
  type LocalPickerView,
} from './catalogPicker.js';
export {
  VRAM_PER_MAX_BUFFER,
  assumedDeviceMemoryBytes,
  cpuMemoryCeiling,
  localModelFit,
  type LocalBackend,
  type DeviceNavigatorLike,
  type LocalCpuSupport,
  type LocalDeviceSupport,
  type LocalModelFit,
  type LocalModelUnfit,
  type LocalWebGpuSupport,
} from './fit.js';
export {
  localFirstPlan,
  localModelUnfitReason,
  type LocalFirstAccount,
  type LocalFirstAttempt,
  type LocalFirstInput,
  type LocalFirstWorkload,
} from './plan.js';
export {
  LocalFirstUnavailableError,
  runLocalFirst,
  type LocalFirstAttemptRecord,
  type LocalFirstOutcome,
  type LocalFirstRunOptions,
  type LocalFirstRunResult,
} from './failover.js';
export {
  LOGPROB_ENGINE_ORDER,
  createLogprobPort,
  httpLogprobEngine,
  labelLogprobsRequest,
  readLabelLogprobs,
  residentModelTracker,
  type LabelLogprobPort,
  type LogprobEngine,
} from './logprobs.js';
export {
  OLLAMA_EMBED_TIMEOUT_MS,
  ollamaEmbed,
  ollamaEmbedFingerprint,
  ollamaEmbedder,
  ollamaEmbedderSource,
  ollamaResidentEmbedModel,
  type LocalTextEmbedder,
  type ResidentEmbedModel,
} from './embed.js';
