"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/pageEngines/bfiLoader.ts
var bfiLoader_exports = {};
__export(bfiLoader_exports, {
  BFI_THREADS_START_TIMEOUT_MS: () => BFI_THREADS_START_TIMEOUT_MS,
  BfiThreadsError: () => BfiThreadsError,
  bfiSupportWithoutWasm: () => bfiSupportWithoutWasm,
  createBfiEngine: () => createBfiEngine,
  forgetBfiWeb: () => forgetBfiWeb,
  hfResolveUrl: () => hfResolveUrl,
  isBfiThreadsError: () => isBfiThreadsError,
  isWasmTrap: () => isWasmTrap,
  loadBfiWeb: () => loadBfiWeb,
  runBfiWorker: () => runBfiWorker,
  serveEngineWorker: () => serveEngineWorker,
  servePageEngines: () => servePageEngines
});
module.exports = __toCommonJS(bfiLoader_exports);

// src/pageEngines/settleWithin.ts
var SettleTimeoutError = class extends Error {
  constructor(what, ms) {
    super(`${what} did not settle within ${ms} ms`);
    this.name = "SettleTimeoutError";
  }
};
function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SettleTimeoutError(what, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// src/pageEngines/types.ts
var PageEngineError = class extends Error {
  status;
  code;
  constructor(status, code, message2 = code) {
    super(message2);
    this.name = "PageEngineError";
    this.status = status;
    this.code = code;
  }
};
var abortReason = (signal) => signal.reason ?? new DOMException("Aborted", "AbortError");
var errorMessage = (e) => e instanceof Error ? e.message : String(e);
function memoizedProbe(runtime, run, config = {}) {
  const ttlMs = config.ttlMs ?? PAGE_ENGINE_PROBE_TTL_MS;
  const now = config.now ?? (() => Date.now());
  let memo;
  return {
    probe(options = {}) {
      const at = now();
      if (!options.fresh && memo && at - memo.at < ttlMs) return memo.value;
      const value = run().catch((e) => {
        reportPageEngineFailure(runtime, "probe", e);
        return null;
      });
      memo = { at, value };
      return value;
    },
    invalidate() {
      memo = void 0;
    }
  };
}
var PAGE_ENGINE_PROBE_TTL_MS = 3e4;

// src/pageEngines/engineFailure.ts
function reportPageEngineFailure(runtime, stage, error) {
  console.warn(`BuilderForce page engine: ${runtime} ${stage} failed (${errorMessage(error)})`);
}

// src/pageEngines/webgpu.ts
var WEBGPU_ADAPTER_TIMEOUT_MS = 5e3;
var UNSUPPORTED = (reason) => ({
  contractVersion: 2,
  supported: false,
  reason,
  f16: false,
  maxBufferBytes: 0,
  maxBufferSizeBytes: 0,
  maxStorageBufferBindingSizeBytes: 0,
  requestedPowerPreference: "high-performance"
});
var pageGpu = () => globalThis.navigator?.gpu;
async function webGpuSupport(gpu = pageGpu(), timeoutMs = WEBGPU_ADAPTER_TIMEOUT_MS) {
  if (!gpu) return UNSUPPORTED("webgpu_missing");
  let adapter;
  try {
    adapter = await withTimeout(gpu.requestAdapter({ powerPreference: "high-performance" }), timeoutMs, "WebGPU requestAdapter");
  } catch (e) {
    reportPageEngineFailure("webllm", "support", e);
    return UNSUPPORTED(e instanceof SettleTimeoutError ? "adapter_timeout" : e instanceof Error ? e.message : String(e));
  }
  try {
    if (!adapter) return UNSUPPORTED("no_adapter");
    const maxBufferSizeBytes = adapter.limits?.maxBufferSize ?? 0;
    const maxStorageBufferBindingSizeBytes = adapter.limits?.maxStorageBufferBindingSize ?? 0;
    return {
      contractVersion: 2,
      supported: true,
      f16: adapter.features?.has("shader-f16") ?? false,
      maxBufferBytes: maxBufferSizeBytes,
      maxBufferSizeBytes,
      maxStorageBufferBindingSizeBytes,
      requestedPowerPreference: "high-performance"
    };
  } catch (e) {
    return UNSUPPORTED(e instanceof Error ? e.message : String(e));
  }
}

// ../packages/local-inference/src/runtimes.ts
var BROWSER_ENGINE_BASE_URL = "http://browser.local";
var BFI_ENGINE_BASE_URL = "http://bfi.local";
var WEBLLM_ENGINE_BASE_URL = "http://webllm.local";
var KIMI_CODE_CATALOG_ALIASES = {
  "k2": "moonshotai/kimi-k2",
  "kimi-k2": "moonshotai/kimi-k2",
  "kimi-k2-0905": "moonshotai/kimi-k2-0905",
  "kimi-k2-thinking": "moonshotai/kimi-k2-thinking",
  "k2.5": "moonshotai/kimi-k2.5",
  "kimi-k2.5": "moonshotai/kimi-k2.5",
  "k2.6": "moonshotai/kimi-k2.6",
  "kimi-k2.6": "moonshotai/kimi-k2.6",
  "kimi-k2.7-code": "moonshotai/kimi-k2.7-code",
  "k3": "moonshotai/kimi-k3",
  "kimi-k3": "moonshotai/kimi-k3",
  "kimi-k3.1-pro": "moonshotai/kimi-k3.1-pro",
  // The book prices Kimi's moving alias under its own `~` id; there is no plain `moonshotai/kimi-latest`.
  "kimi-latest": "~moonshotai/kimi-latest"
};
var LOCAL_RUNTIMES = [
  { id: "synapse", automaticRank: 30, label: "Synapse", onDevice: true, catalog: "probe", tools: "all", reach: "http", ownedBy: "bfi" },
  {
    id: "ollama",
    automaticRank: 50,
    label: "Ollama",
    onDevice: true,
    defaultBaseUrl: "http://127.0.0.1:11434",
    catalog: "probe",
    tools: "probe",
    reach: "http"
  },
  {
    id: "freetoken",
    automaticRank: 60,
    label: "FreeToken",
    onDevice: true,
    defaultBaseUrl: "http://127.0.0.1:1919",
    catalog: "probe",
    tools: "unknown",
    reach: "http"
  },
  {
    id: "bfi",
    automaticRank: 20,
    label: "Builderforce engine",
    onDevice: true,
    defaultBaseUrl: BFI_ENGINE_BASE_URL,
    catalog: "declared",
    tools: "all",
    reach: "page",
    fallbackReach: "host"
  },
  {
    id: "webllm",
    automaticRank: 10,
    label: "WebLLM",
    onDevice: true,
    defaultBaseUrl: WEBLLM_ENGINE_BASE_URL,
    catalog: "declared",
    tools: "unknown",
    reach: "page"
  },
  {
    id: "browser",
    automaticRank: 40,
    label: "Gemini Nano",
    onDevice: true,
    defaultBaseUrl: BROWSER_ENGINE_BASE_URL,
    catalog: "declared",
    tools: "unknown",
    reach: "page"
  },
  { id: "kimi-code", automaticRank: Number.POSITIVE_INFINITY, label: "Kimi Code", onDevice: false, catalog: "declared", tools: "all", reach: "http", gatewayVendor: "kimi-code", catalogAliases: KIMI_CODE_CATALOG_ALIASES, providerSampling: true, accountProvider: "kimi" }
];
var HTTP_LOCAL_RUNTIMES = LOCAL_RUNTIMES.filter((r) => r.reach === "http");
var LOCAL_RUNTIME_IDS = LOCAL_RUNTIMES.map((r) => r.id);
var HOST_FALLBACK_RUNTIMES = LOCAL_RUNTIMES.filter((r) => r.fallbackReach === "host");

// ../packages/local-inference/src/ref.ts
var LOCAL_MODEL_PREFIX = "local/";
function formatLocalModelRef(runtime, model) {
  return `${LOCAL_MODEL_PREFIX}${runtime}/${model}`;
}

// ../packages/local-inference/src/bfiLimits.generated.ts
var BFI_CPU_LIMITS = {
  cpuKvBudgetBytes: 536870912,
  cpuWorkingSetBytes: 268435456,
  wasm32MemoryBytes: 4294967296,
  deviceMemoryShareDivisor: 2,
  assumedDeviceMemoryBytes: 2147483648,
  assumedDesktopMemoryBytes: 8589934592
};

// ../packages/local-inference/src/webllmCatalog.generated.ts
var WEBLLM_CATALOG = [
  { modelId: "snowflake-arctic-embed-s-q0f32-MLC-b4", label: "Snowflake Arctic Embed S \xB7 B4", family: "snowflake-arctic-embed", params: 33e6, bytes: 132e6, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 250305577, f16: false, uses: ["embedding"], recommended: true },
  { modelId: "SmolLM2-135M-Instruct-q0f16-MLC", label: "SmolLM2 135M Instruct", family: "smollm2", params: 135e6, bytes: 27e7, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 377162301, f16: true, uses: ["chat"], recommended: false },
  { modelId: "SmolLM2-360M-Instruct-q4f16_1-MLC", label: "SmolLM2 360M Instruct", family: "smollm2", params: 36e7, bytes: 2025e5, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 394327491, f16: true, uses: ["chat"], recommended: false },
  { modelId: "snowflake-arctic-embed-m-q0f32-MLC-b4", label: "Snowflake Arctic Embed M \xB7 B4", family: "snowflake-arctic-embed", params: 109e6, bytes: 436e6, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 565601894, f16: false, uses: ["embedding"], recommended: true },
  { modelId: "TinyLlama-1.1B-Chat-v0.4-q4f16_1-MLC-1k", label: "TinyLlama 1.1B Chat v0.4 \xB7 1K", family: "tinyllama", params: 11e8, bytes: 61875e4, contextTokens: 1024, tools: false, lowResource: true, vramBytes: 708040458, f16: true, uses: ["chat"], recommended: false },
  { modelId: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC-1k", label: "TinyLlama 1.1B Chat v1.0 \xB7 1K", family: "tinyllama", params: 11e8, bytes: 61875e4, contextTokens: 1024, tools: false, lowResource: true, vramBytes: 708040458, f16: true, uses: ["chat"], recommended: false },
  { modelId: "TinyLlama-1.1B-Chat-v0.4-q4f16_1-MLC", label: "TinyLlama 1.1B Chat v0.4", family: "tinyllama", params: 11e8, bytes: 61875e4, contextTokens: 2048, tools: false, lowResource: true, vramBytes: 731109130, f16: true, uses: ["chat"], recommended: false },
  { modelId: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC", label: "TinyLlama 1.1B Chat v1.0", family: "tinyllama", params: 11e8, bytes: 61875e4, contextTokens: 2048, tools: false, lowResource: true, vramBytes: 731109130, f16: true, uses: ["chat"], recommended: false },
  { modelId: "gemma3-1b-it-q4f16_1-MLC", label: "Gemma3 1B IT", family: "gemma3", params: 1e9, bytes: 5625e5, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 745610936, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B Instruct", family: "llama-3.2", params: 1e9, bytes: 5625e5, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 921740247, f16: true, uses: ["chat"], recommended: true },
  { modelId: "Qwen2-0.5B-Instruct-q4f16_1-MLC", label: "Qwen2 0.5B Instruct", family: "qwen2", params: 5e8, bytes: 28125e4, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 990505861, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 0.5B Instruct", family: "qwen2.5", params: 5e8, bytes: 28125e4, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 990505861, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 Coder 0.5B Instruct", family: "qwen2.5-coder", params: 5e8, bytes: 28125e4, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 990505861, f16: true, uses: ["coding"], recommended: false },
  { modelId: "snowflake-arctic-embed-s-q0f32-MLC-b32", label: "Snowflake Arctic Embed S \xB7 B32", family: "snowflake-arctic-embed", params: 33e6, bytes: 132e6, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 1072504504, f16: false, uses: ["embedding"], recommended: false },
  { modelId: "phi-1_5-q4f16_1-MLC", label: "Phi 1.5", family: "phi-1_5", params: 142e7, bytes: 79875e4, contextTokens: 2048, tools: false, lowResource: true, vramBytes: 1268871332, f16: true, uses: ["chat"], recommended: false },
  { modelId: "phi-1_5-q4f16_1-MLC-1k", label: "Phi 1.5 \xB7 1K", family: "phi-1_5", params: 142e7, bytes: 79875e4, contextTokens: 1024, tools: false, lowResource: true, vramBytes: 1268871332, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen3-0.6B-q4f16_1-MLC", label: "Qwen3 0.6B", family: "qwen3", params: 6e8, bytes: 3375e5, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 1471508644, f16: true, uses: ["chat"], recommended: false },
  { modelId: "snowflake-arctic-embed-m-q0f32-MLC-b32", label: "Snowflake Arctic Embed M \xB7 B32", family: "snowflake-arctic-embed", params: 109e6, bytes: 436e6, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 1475881206, f16: false, uses: ["embedding"], recommended: false },
  { modelId: "gemma-2b-it-q4f16_1-MLC", label: "Gemma 2B IT", family: "gemma", params: 2e9, bytes: 1125e6, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 1548243436, f16: true, bufferBytes: 262144e3, uses: ["chat"], recommended: false },
  { modelId: "gemma-2b-it-q4f16_1-MLC-1k", label: "Gemma 2B IT \xB7 1K", family: "gemma", params: 2e9, bytes: 1125e6, contextTokens: 1024, tools: false, lowResource: true, vramBytes: 1548243436, f16: true, bufferBytes: 262144e3, uses: ["chat"], recommended: false },
  { modelId: "stablelm-2-zephyr-1_6b-q4f16_1-MLC-1k", label: "StableLM 2 Zephyr 1.6B \xB7 1K", family: "stablelm-2-zephyr", params: 16e8, bytes: 9e8, contextTokens: 1024, tools: false, lowResource: true, vramBytes: 1585090396, f16: true, uses: ["chat"], recommended: false },
  { modelId: "gemma-2-2b-it-q4f16_1-MLC-1k", label: "Gemma 2 2B IT \xB7 1K", family: "gemma-2", params: 2e9, bytes: 1125e6, contextTokens: 1024, tools: false, lowResource: true, vramBytes: 1660210381, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen3.5-0.8B-q4f16_1-MLC", label: "Qwen3.5 0.8B", family: "qwen3.5", params: 8e8, bytes: 45e7, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 1708644106, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen2-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2 1.5B Instruct", family: "qwen2", params: 15e8, bytes: 84375e4, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 1708916736, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen2-Math-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2 Math 1.5B Instruct", family: "qwen2-math", params: 15e8, bytes: 84375e4, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 1708916736, f16: true, uses: ["math"], recommended: false },
  { modelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 1.5B Instruct", family: "qwen2.5", params: 15e8, bytes: 84375e4, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 1708916736, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 Coder 1.5B Instruct", family: "qwen2.5-coder", params: 15e8, bytes: 84375e4, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 1708916736, f16: true, uses: ["coding"], recommended: true },
  { modelId: "Qwen2.5-Math-1.5B-Instruct-q4f16_1-MLC", label: "Qwen2.5 Math 1.5B Instruct", family: "qwen2.5-math", params: 15e8, bytes: 84375e4, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 1708916736, f16: true, uses: ["math"], recommended: true },
  { modelId: "SmolLM2-1.7B-Instruct-q4f16_1-MLC", label: "SmolLM2 1.7B Instruct", family: "smollm2", params: 17e8, bytes: 95625e4, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 1860373053, f16: true, uses: ["chat"], recommended: false },
  { modelId: "OLMo-2-0425-1B-Instruct-q4f16_1-MLC", label: "OLMo 2 0425 1B Instruct", family: "olmo-2-0425", params: 1e9, bytes: 5625e5, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 1863057408, f16: true, uses: ["chat"], recommended: false },
  { modelId: "gemma-2-2b-it-q4f16_1-MLC", label: "Gemma 2 2B IT", family: "gemma-2", params: 2e9, bytes: 1125e6, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 1987366093, f16: true, uses: ["chat"], recommended: true },
  { modelId: "gemma-2-2b-jpn-it-q4f16_1-MLC", label: "Gemma 2 2B JPN IT", family: "gemma-2", params: 2e9, bytes: 1125e6, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 1987366093, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen3-1.7B-q4f16_1-MLC", label: "Qwen3 1.7B", family: "qwen3", params: 17e8, bytes: 984156278, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 2135592796, f16: true, uses: ["chat"], recommended: false },
  { modelId: "RedPajama-INCITE-Chat-3B-v1-q4f16_1-MLC-1k", label: "RedPajama INCITE Chat 3B v1 \xB7 1K", family: "redpajama-incite-chat", params: 3e9, bytes: 16875e5, contextTokens: 1024, tools: false, lowResource: true, vramBytes: 2140237988, f16: true, uses: ["chat"], recommended: false },
  { modelId: "stablelm-2-zephyr-1_6b-q4f16_1-MLC", label: "StableLM 2 Zephyr 1.6B", family: "stablelm-2-zephyr", params: 16e8, bytes: 9e8, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 2189070172, f16: true, uses: ["chat"], recommended: false },
  { modelId: "phi-2-q4f16_1-MLC-1k", label: "Phi 2 \xB7 1K", family: "phi-2", params: 278e7, bytes: 156375e4, contextTokens: 1024, tools: false, lowResource: true, vramBytes: 2235532575, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen3.5-2B-q4f16_1-MLC", label: "Qwen3.5 2B", family: "qwen3.5", params: 2e9, bytes: 1125e6, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 2354514493, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Hermes-3-Llama-3.2-3B-q4f16_1-MLC", label: "Hermes 3 Llama 3.2 3B", family: "hermes-3-llama-3.2", params: 3e9, bytes: 16875e5, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 2373651005, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B Instruct", family: "llama-3.2", params: 321e7, bytes: 1816811105, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 2373651005, f16: true, uses: ["chat"], recommended: true },
  { modelId: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen2.5 3B Instruct", family: "qwen2.5", params: 3e9, bytes: 16875e5, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 2626431222, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC", label: "Qwen2.5 Coder 3B Instruct", family: "qwen2.5-coder", params: 3e9, bytes: 16875e5, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 2626431222, f16: true, uses: ["coding"], recommended: true },
  { modelId: "Phi-3-mini-4k-instruct-q4f16_1-MLC-1k", label: "Phi 3 Mini 4k Instruct \xB7 1K", family: "phi-3-mini-4k", params: 382e7, bytes: 214875e4, contextTokens: 1024, tools: false, lowResource: true, vramBytes: 2642484920, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Phi-3.5-mini-instruct-q4f16_1-MLC-1k", label: "Phi 3.5 Mini Instruct \xB7 1K", family: "phi-3.5-mini", params: 382e7, bytes: 214875e4, contextTokens: 1024, tools: false, lowResource: true, vramBytes: 2642484920, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Ministral-3-3B-Base-2512-q4f16_1-MLC", label: "Ministral 3 3B Base 2512", family: "ministral-3", params: 3e9, bytes: 16875e5, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 3002796605, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC", label: "Ministral 3 3B Instruct 2512 BF16", family: "ministral-3", params: 3e9, bytes: 16875e5, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 3002796605, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Ministral-3-3B-Reasoning-2512-q4f16_1-MLC", label: "Ministral 3 3B Reasoning 2512", family: "ministral-3", params: 3e9, bytes: 16875e5, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 3002796605, f16: true, uses: ["reasoning"], recommended: true },
  { modelId: "RedPajama-INCITE-Chat-3B-v1-q4f16_1-MLC", label: "RedPajama INCITE Chat 3B v1", family: "redpajama-incite-chat", params: 3e9, bytes: 16875e5, contextTokens: 2048, tools: false, lowResource: false, vramBytes: 3116462244, f16: true, uses: ["chat"], recommended: false },
  { modelId: "phi-2-q4f16_1-MLC", label: "Phi 2", family: "phi-2", params: 278e7, bytes: 156375e4, contextTokens: 2048, tools: false, lowResource: false, vramBytes: 3202319647, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen3-4B-q4f16_1-MLC", label: "Qwen3 4B", family: "qwen3", params: 4e9, bytes: 2279167154, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 3598282916, f16: true, uses: ["chat"], recommended: true },
  { modelId: "Phi-4-mini-instruct-q4f16_1-MLC", label: "Phi 4 Mini Instruct", family: "phi-4-mini", params: 384e7, bytes: 216e7, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 3604563886, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Phi-3-mini-4k-instruct-q4f16_1-MLC", label: "Phi 3 Mini 4k Instruct", family: "phi-3-mini-4k", params: 382e7, bytes: 214875e4, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 3850444472, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi 3.5 Mini Instruct", family: "phi-3.5-mini", params: 382e7, bytes: 214875e4, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 3850444472, f16: true, uses: ["chat"], recommended: true },
  { modelId: "Qwen3.5-4B-q4f16_1-MLC", label: "Qwen3.5 4B", family: "qwen3.5", params: 4e9, bytes: 225e7, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 4055703224, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Phi-3.5-vision-instruct-q4f16_1-MLC", label: "Phi 3.5 Vision Instruct", family: "phi-3.5-vision", params: 415e7, bytes: 2334375e3, contextTokens: 4096, tools: false, lowResource: true, vramBytes: 4144161096, f16: true, uses: ["vision"], recommended: false },
  { modelId: "Hermes-2-Pro-Mistral-7B-q4f16_1-MLC", label: "Hermes 2 Pro Mistral 7B", family: "hermes-2-pro-mistral", params: 7e9, bytes: 39375e5, contextTokens: 4096, tools: true, lowResource: false, vramBytes: 4229200609, f16: true, uses: ["chat"], recommended: true },
  { modelId: "Mistral-7B-Instruct-v0.2-q4f16_1-MLC", label: "Mistral 7B Instruct v0.2", family: "mistral", params: 7e9, bytes: 39375e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 4795546993, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC", label: "Mistral 7B Instruct v0.3", family: "mistral", params: 7e9, bytes: 39375e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 4795546993, f16: true, uses: ["chat"], recommended: false },
  { modelId: "NeuralHermes-2.5-Mistral-7B-q4f16_1-MLC", label: "NeuralHermes 2.5 Mistral 7B", family: "neuralhermes-2.5-mistral", params: 7e9, bytes: 39375e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 4795546993, f16: true, uses: ["chat"], recommended: false },
  { modelId: "OpenHermes-2.5-Mistral-7B-q4f16_1-MLC", label: "OpenHermes 2.5 Mistral 7B", family: "openhermes-2.5-mistral", params: 7e9, bytes: 39375e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 4795546993, f16: true, uses: ["chat"], recommended: false },
  { modelId: "WizardMath-7B-V1.1-q4f16_1-MLC", label: "WizardMath 7B V1.1", family: "wizardmath", params: 7e9, bytes: 39375e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 4795546993, f16: true, uses: ["math"], recommended: false },
  { modelId: "Llama-3-8B-Instruct-q4f16_1-MLC-1k", label: "Llama 3 8B Instruct \xB7 1K", family: "llama-3", params: 8e9, bytes: 45e8, contextTokens: 1024, tools: false, lowResource: true, vramBytes: 4821708964, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Llama-3.1-8B-Instruct-q4f16_1-MLC-1k", label: "Llama 3.1 8B Instruct \xB7 1K", family: "llama-3.1", params: 8e9, bytes: 45e8, contextTokens: 1024, tools: false, lowResource: true, vramBytes: 4821708964, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Llama-2-7b-chat-hf-q4f16_1-MLC-1k", label: "Llama 2 7B Chat HF \xB7 1K", family: "llama-2", params: 7e9, bytes: 39375e5, contextTokens: 1024, tools: false, lowResource: false, vramBytes: 4842869228, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Hermes-3-Llama-3.1-8B-q4f16_1-MLC", label: "Hermes 3 Llama 3.1 8B", family: "hermes-3-llama-3.1", params: 803e7, bytes: 4526847881, contextTokens: 4096, tools: true, lowResource: false, vramBytes: 5112992891, f16: true, uses: ["chat"], recommended: true },
  { modelId: "Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC", label: "Hermes 2 Pro Llama 3 8B", family: "hermes-2-pro-llama-3", params: 8e9, bytes: 45e8, contextTokens: 4096, tools: true, lowResource: false, vramBytes: 5217850491, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Hermes-2-Theta-Llama-3-8B-q4f16_1-MLC", label: "Hermes 2 Theta Llama 3 8B", family: "hermes-2-theta-llama-3", params: 8e9, bytes: 45e8, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 5217850491, f16: true, uses: ["chat"], recommended: false },
  { modelId: "DeepSeek-R1-Distill-Llama-8B-q4f16_1-MLC", label: "DeepSeek R1 Distill Llama 8B", family: "deepseek-r1-distill-llama", params: 8e9, bytes: 45e8, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 5243928576, f16: true, uses: ["reasoning"], recommended: false },
  { modelId: "Llama-3-8B-Instruct-q4f16_1-MLC", label: "Llama 3 8B Instruct", family: "llama-3", params: 8e9, bytes: 45e8, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 5243928576, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Llama-3.1-8B-Instruct-q4f16_1-MLC", label: "Llama 3.1 8B Instruct", family: "llama-3.1", params: 8e9, bytes: 45e8, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 5243928576, f16: true, uses: ["chat"], recommended: true },
  { modelId: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC", label: "DeepSeek R1 Distill Qwen 7B", family: "deepseek-r1-distill-qwen", params: 7e9, bytes: 39375e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 5354731602, f16: true, uses: ["reasoning"], recommended: true },
  { modelId: "Qwen2-7B-Instruct-q4f16_1-MLC", label: "Qwen2 7B Instruct", family: "qwen2", params: 7e9, bytes: 39375e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 5354731602, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen2-Math-7B-Instruct-q4f16_1-MLC", label: "Qwen2 Math 7B Instruct", family: "qwen2-math", params: 7e9, bytes: 39375e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 5354731602, f16: true, uses: ["math"], recommended: false },
  { modelId: "Qwen2.5-7B-Instruct-q4f16_1-MLC", label: "Qwen2.5 7B Instruct", family: "qwen2.5", params: 7e9, bytes: 39375e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 5354731602, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC", label: "Qwen2.5 Coder 7B Instruct", family: "qwen2.5-coder", params: 7e9, bytes: 39375e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 5354731602, f16: true, uses: ["coding"], recommended: true },
  { modelId: "Qwen3-8B-q4f16_1-MLC", label: "Qwen3 8B", family: "qwen3", params: 8e9, bytes: 45e8, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 5972458209, f16: true, uses: ["chat"], recommended: false },
  { modelId: "gemma-2-9b-it-q4f16_1-MLC", label: "Gemma 2 9B IT", family: "gemma-2", params: 9e9, bytes: 50625e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 6733965558, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Qwen3.5-9B-q4f16_1-MLC", label: "Qwen3.5 9B", family: "qwen3.5", params: 9e9, bytes: 50625e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 6745499894, f16: true, uses: ["chat"], recommended: false },
  { modelId: "OLMo-2-1124-7B-Instruct-q4f16_1-MLC", label: "OLMo 2 1124 7B Instruct", family: "olmo-2-1124", params: 7e9, bytes: 39375e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 6793734390, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Llama-2-7b-chat-hf-q4f16_1-MLC", label: "Llama 2 7B Chat HF", family: "llama-2", params: 7e9, bytes: 39375e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 7076860396, f16: true, uses: ["chat"], recommended: false },
  { modelId: "Llama-2-13b-chat-hf-q4f16_1-MLC", label: "Llama 2 13B Chat HF", family: "llama-2", params: 13e9, bytes: 73125e5, contextTokens: 4096, tools: false, lowResource: false, vramBytes: 12387971236, f16: true, uses: ["chat"], recommended: false }
];

// ../packages/local-inference/src/catalog.ts
var MIB = 1024 * 1024;
var WEBGPU_DEFAULT_BINDING_BYTES = 128 * MIB;
var WEBLLM_FULL_BINDING_BYTES = 1024 * MIB;
var GIB = 1024 * MIB;
function bonsai(size, params, bytes, contextTokens, layers, cpuMinMemory) {
  const model = `bonsai-${size.toLowerCase()}-q1_0`;
  return {
    ref: formatLocalModelRef("bfi", model),
    runtime: "bfi",
    model,
    label: `Bonsai ${size} (1-bit)`,
    family: "bonsai",
    params,
    bytes,
    contextTokens,
    kv: { layers, kvHeads: 8, headDim: 128 },
    tools: true,
    uses: ["chat"],
    recommended: true,
    source: { kind: "hf-file", repo: `prism-ml/Bonsai-${size}-gguf`, file: `Bonsai-${size}-Q1_0.gguf` },
    requires: { minBufferBytes: WEBGPU_DEFAULT_BINDING_BYTES, cpu: { minDeviceMemoryBytes: cpuMinMemory } }
  };
}
function webllm(entry) {
  const binding = entry.lowResource ? WEBGPU_DEFAULT_BINDING_BYTES : WEBLLM_FULL_BINDING_BYTES;
  return {
    ref: formatLocalModelRef("webllm", entry.modelId),
    runtime: "webllm",
    model: entry.modelId,
    label: entry.label,
    family: entry.family,
    params: entry.params,
    bytes: entry.bytes,
    contextTokens: entry.contextTokens,
    tools: entry.tools,
    uses: entry.uses,
    recommended: entry.recommended,
    source: { kind: "webllm", modelId: entry.modelId },
    requires: {
      ...entry.f16 ? { f16: true } : {},
      minBufferBytes: Math.max(binding, entry.bufferBytes ?? 0),
      vramBytes: entry.vramBytes
    }
  };
}
var LOCAL_MODEL_CATALOG = [
  // CPU floors: the device RAM a row needs to run without a GPU. An unreported RAM reads
  // as 2 GiB on a phone or tablet (Rust `kv_plan`), so there only 1.7B is offered, and as
  // 8 GiB on a desktop (`assumedDeviceMemoryBytes`); 4B needs 4 GiB, 8B 8 GiB — and every
  // row must also fit `cpuMemoryCeiling` (half the RAM, wasm32's cap).
  bonsai("1.7B", 17e8, 248302272, 32768, 28, 2 * GIB),
  bonsai("4B", 4e9, 572270624, 32768, 36, 4 * GIB),
  bonsai("8B", 819e7, 1158654496, 65536, 36, 8 * GIB),
  ...WEBLLM_CATALOG.map(webllm)
];
function isLocalChatModel(row) {
  return row.uses.some((use) => use !== "vision" && use !== "embedding");
}
function localCatalogModel(ref) {
  return LOCAL_MODEL_CATALOG.find((m) => m.ref === ref);
}
function localCatalogFor(runtime) {
  return LOCAL_MODEL_CATALOG.filter((m) => m.runtime === runtime && isLocalChatModel(m));
}

// ../packages/local-inference/src/fit.ts
var VRAM_PER_MAX_BUFFER = 8;
var MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i;
function isMobileDevice(nav) {
  if (!nav) return false;
  const hinted = nav.userAgentData?.mobile;
  if (typeof hinted === "boolean") return hinted;
  const ua = nav.userAgent ?? "";
  return MOBILE_UA.test(ua) || /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}
function assumedDeviceMemoryBytes(nav = globalThis.navigator) {
  return isMobileDevice(nav) ? BFI_CPU_LIMITS.assumedDeviceMemoryBytes : BFI_CPU_LIMITS.assumedDesktopMemoryBytes;
}
function cpuMemoryCeiling(deviceMemoryBytes) {
  const device = deviceMemoryBytes && deviceMemoryBytes > 0 ? deviceMemoryBytes : assumedDeviceMemoryBytes();
  return Math.min(BFI_CPU_LIMITS.wasm32MemoryBytes, Math.floor(device / BFI_CPU_LIMITS.deviceMemoryShareDivisor));
}
function webGpuFit(model, support) {
  if (!support.supported) {
    return { fits: false, reason: "webgpu_unavailable", ...support.reason ? { detail: support.reason } : {} };
  }
  if (model.requires.f16 && !support.f16) return { fits: false, reason: "shader_f16_unavailable" };
  const bindingBytes = support.maxStorageBufferBindingSizeBytes ?? support.maxBufferBytes;
  if (bindingBytes < model.requires.minBufferBytes) return { fits: false, reason: "buffer_too_small" };
  const { vramBytes } = model.requires;
  const maxBuffer = support.maxBufferSizeBytes;
  if (vramBytes && maxBuffer && vramBytes > maxBuffer * VRAM_PER_MAX_BUFFER) return { fits: false, reason: "vram_too_small" };
  return { fits: true, backend: "webgpu" };
}
function cpuFits(model, cpu) {
  const floor = model.requires.cpu?.minDeviceMemoryBytes;
  if (floor === void 0 || !cpu.supported) return false;
  if ((cpu.deviceMemoryBytes ?? assumedDeviceMemoryBytes()) < floor) return false;
  const need = model.bytes + (cpu.kvBudgetBytes ?? BFI_CPU_LIMITS.cpuKvBudgetBytes) + BFI_CPU_LIMITS.cpuWorkingSetBytes;
  return need <= (cpu.maxMemoryBytes ?? cpuMemoryCeiling(cpu.deviceMemoryBytes));
}
function localModelFit(model, support) {
  const gpu = webGpuFit(model, support);
  if (gpu.fits) return gpu;
  const cpu = support.backends?.cpu;
  if (!model.requires.cpu || !cpu?.supported) return gpu;
  if (cpuFits({ requires: model.requires, bytes: model.bytes ?? 0 }, cpu)) return { fits: true, backend: "cpu" };
  return { fits: false, reason: "memory_insufficient" };
}

// src/pageEngines/bfiChunks.ts
function closingChunk(finalJson) {
  try {
    const final = JSON.parse(finalJson);
    const finish = final.choices?.[0]?.finish_reason ?? null;
    if (!finish && !final.usage) return null;
    return {
      ...final.model ? { model: final.model } : {},
      choices: [{ index: 0, delta: {}, finish_reason: finish }],
      ...final.usage ? { usage: final.usage } : {}
    };
  } catch {
    return null;
  }
}
async function* bfiChunks(engine, requestJson, signal, mapError, crashes) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const queue = [];
  let wake;
  const state = {};
  const notify = () => {
    wake?.();
    wake = void 0;
  };
  const onCrash = (error) => {
    if (state.outcome) return;
    state.outcome = { ok: false, error };
    notify();
  };
  crashes.add(onCrash);
  engine.chat(
    requestJson,
    (json) => {
      try {
        queue.push(JSON.parse(json));
        notify();
      } catch (e) {
        reportPageEngineFailure("bfi", "chunk", e);
      }
    },
    controller.signal
  ).then(
    (final) => {
      state.outcome = { ok: true, final };
      notify();
    },
    (error) => {
      state.outcome = { ok: false, error };
      notify();
    }
  );
  try {
    for (; ; ) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (state.outcome) break;
      await new Promise((resolve) => wake = resolve);
    }
    const settled = state.outcome;
    if (!settled.ok) throw signal?.aborted ? abortReason(signal) : mapError(settled.error);
    const closing = closingChunk(settled.final);
    if (closing) yield closing;
  } finally {
    crashes.delete(onCrash);
    signal?.removeEventListener("abort", onAbort);
    if (!state.outcome) controller.abort();
  }
}

// src/pageEngines/bfiSupport.ts
var BFI_UNSUPPORTED = { supported: false, reason: "bfi_unavailable", f16: false, maxBufferBytes: 0 };
async function anyBfiModelDownloaded(store) {
  const states = await Promise.all(
    localCatalogFor("bfi").map(
      (row) => store.status(row.ref).catch((e) => {
        reportPageEngineFailure("bfi", "cache_lookup", e);
        return "absent";
      })
    )
  );
  return states.includes("ready");
}
function restrictBackends(s, backends) {
  const gpu = backends.includes("webgpu");
  const out = gpu ? { ...s } : { ...s, supported: false, reason: "webgpu_not_used_here" };
  const { cpu, webgpu } = s.backends ?? {};
  out.backends = {
    ...webgpu ? { webgpu: gpu ? webgpu : { ...webgpu, supported: false, reason: "webgpu_not_used_here" } } : {},
    ...cpu && backends.includes("cpu") ? { cpu } : {}
  };
  return out;
}
var SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
function wasmSimdSupported() {
  try {
    return typeof WebAssembly === "object" && WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}
function reportedDeviceMemoryBytes() {
  const gb = globalThis.navigator?.deviceMemory;
  return typeof gb === "number" && gb > 0 ? gb * 1024 ** 3 : void 0;
}
async function bfiSupportWithoutWasm(deviceMemoryBytes = reportedDeviceMemoryBytes()) {
  const simd = wasmSimdSupported();
  const gpu = await webGpuSupport();
  const webgpu = simd ? gpu : { ...gpu, supported: false, reason: "wasm_simd_unavailable" };
  return {
    ...webgpu,
    backends: {
      webgpu: {
        supported: webgpu.supported,
        ...webgpu.reason ? { reason: webgpu.reason } : {},
        maxBufferBytes: webgpu.maxBufferBytes,
        maxStorageBufferBindingSizeBytes: webgpu.maxStorageBufferBindingSizeBytes ?? 0,
        f16: webgpu.f16
      },
      cpu: {
        supported: simd,
        simd,
        threads: 1,
        kvBudgetBytes: BFI_CPU_LIMITS.cpuKvBudgetBytes,
        maxMemoryBytes: cpuMemoryCeiling(deviceMemoryBytes),
        ...deviceMemoryBytes ? { deviceMemoryBytes } : {}
      }
    }
  };
}

// src/pageEngines/catalogProbe.ts
async function catalogProbe(runtime, baseUrl, support, isReady, contextOf = (row) => row.contextTokens) {
  const fitting = localCatalogFor(runtime).flatMap((row) => {
    const fit = localModelFit(row, support);
    return fit.fits ? [{ row, backend: fit.backend }] : [];
  });
  const ready = await Promise.all(
    fitting.map(
      ({ row }) => isReady(row).catch((e) => {
        reportPageEngineFailure(runtime, "cache_lookup", e);
        return false;
      })
    )
  );
  const rows = fitting.filter((_, i) => ready[i]);
  if (rows.length === 0) return null;
  return {
    provider: runtime,
    endpoint: { baseUrl },
    reachable: true,
    models: rows.map(({ row, backend }) => ({
      ref: formatLocalModelRef(runtime, row.model),
      provider: runtime,
      model: row.model,
      label: row.label,
      tools: row.tools,
      contextTokens: contextOf(row, backend)
    }))
  };
}

// src/pageEngines/engineQueue.ts
function createEngineQueue() {
  let tail = Promise.resolve();
  return {
    acquire(signal) {
      let release;
      const held = new Promise((resolve) => release = resolve);
      const previous = tail;
      tail = previous.then(() => held);
      let released = false;
      const once = () => {
        if (released) return;
        released = true;
        release();
      };
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          reject(abortReason(signal));
          void previous.then(once);
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        void previous.then(() => {
          if (signal?.aborted) return;
          signal?.removeEventListener("abort", onAbort);
          resolve(once);
        });
      });
    }
  };
}

// src/pageEngines/remote/protocol.ts
var PAGE_ENGINE_REQUEST_TYPES = ["pageEngine.probe", "pageEngine.chat", "pageEngine.abort"];
var PAGE_ENGINE_HEARTBEAT_MS = 3e4;
var has = (types, message2, idRequired) => {
  if (!message2 || typeof message2 !== "object") return false;
  const { type, id } = message2;
  return typeof type === "string" && types.includes(type) && (!idRequired || typeof id === "string");
};
function isPageEngineRequest(message2) {
  return has(PAGE_ENGINE_REQUEST_TYPES, message2, true);
}

// src/pageEngines/remote/serve.ts
var message = (e) => e instanceof Error ? e.message : String(e);
function servePageEngines(engines, io) {
  const running = /* @__PURE__ */ new Map();
  const engineFor = (runtime) => engines().find((engine) => engine.runtime === runtime);
  async function chat(request) {
    const { id, runtime } = request;
    const engine = engineFor(runtime);
    if (!engine) {
      io.reply("pageEngine.error", { id, status: 503, code: `${runtime}_unavailable`, message: `${runtime} is not available here` });
      return;
    }
    const controller = new AbortController();
    running.set(id, controller);
    const heartbeat = setInterval(() => io.reply("pageEngine.alive", { id }), PAGE_ENGINE_HEARTBEAT_MS);
    try {
      const chunks = await engine.chatCompletions(request.body, controller.signal);
      for await (const chunk of chunks) {
        if (controller.signal.aborted) break;
        io.reply("pageEngine.chunk", { id, chunk });
      }
      if (!controller.signal.aborted) io.reply("pageEngine.end", { id });
    } catch (e) {
      if (controller.signal.aborted) return;
      const status = e instanceof PageEngineError ? e.status : 500;
      const code = e instanceof PageEngineError ? e.code : `${runtime}_engine_failed`;
      io.reply("pageEngine.error", { id, status, code, message: message(e) });
    } finally {
      clearInterval(heartbeat);
      running.delete(id);
    }
  }
  return io.listen((request) => {
    switch (request.type) {
      case "pageEngine.probe": {
        const engine = engineFor(request.runtime);
        const asked = engine ? engine.probe(request.fresh ? { fresh: true } : void 0) : Promise.resolve(null);
        void asked.catch((e) => {
          reportPageEngineFailure(request.runtime, "probe", e);
          return null;
        }).then((probe) => io.reply("pageEngine.probed", { id: request.id, probe }));
        return;
      }
      case "pageEngine.chat":
        void chat(request);
        return;
      case "pageEngine.abort":
        running.get(request.id)?.abort();
        return;
    }
  });
}

// src/pageEngines/remote/engineWorker.ts
var ENGINE_WORKER_IDLE_MS = 5 * 6e4;
var ENGINE_WORKER_INVALIDATE = "engineWorker.invalidate";
var ENGINE_WORKER_FATAL = "engineWorker.fatal";
var ENGINE_WORKER_CRASH_WINDOW_MS = 10 * 6e4;
function serveEngineWorker(endpoint, engines, onOther = () => void 0, options = {}) {
  servePageEngines(engines, {
    reply: (type, payload) => endpoint.post({ type, ...payload }),
    listen: (onRequest) => endpoint.listen((message2) => {
      if (isPageEngineRequest(message2)) onRequest(message2);
    })
  });
  endpoint.listen((message2) => {
    if (isPageEngineRequest(message2)) return;
    if (message2?.type === ENGINE_WORKER_INVALIDATE) {
      for (const engine of engines()) engine.invalidate();
      return;
    }
    onOther(message2);
  });
  let reported = false;
  const fatal = (error) => {
    if (reported) return;
    reported = true;
    options.onFatal?.();
    endpoint.post({ type: ENGINE_WORKER_FATAL, message: error instanceof Error ? error.message : String(error) });
  };
  endpoint.onUncaught?.((error) => {
    if (!isWasmTrap(error)) return false;
    fatal(error);
    return true;
  });
  return { fatal };
}
function isWasmTrap(e) {
  const RuntimeError = globalThis.WebAssembly?.RuntimeError;
  return RuntimeError !== void 0 && e instanceof RuntimeError || e instanceof Error && e.name === "RuntimeError";
}

// src/pageEngines/bfiEngine.ts
var BFI_STATUS = {
  webgpu_unavailable: 503,
  cpu_memory_exceeded: 503,
  context_exceeded: 413,
  invalid_request: 400
};
function bfiError(e) {
  if (e instanceof PageEngineError) return e;
  const message2 = errorMessage(e);
  const code = /^([a-z_]+):/.exec(message2)?.[1];
  return code && BFI_STATUS[code] ? new PageEngineError(BFI_STATUS[code], code, message2) : e;
}
var crashError = (e) => new PageEngineError(503, "bfi_engine_crashed", `bfi_engine_crashed: ${errorMessage(e)}`);
var BFI_CONTEXT_FLOOR = 2048;
function predictedContext(engine, row, support, backend) {
  const cpuBudget = support.backends?.cpu?.kvBudgetBytes;
  const planned = !row.kv ? 0 : backend === "cpu" ? engine.contextFor({
    ...row.kv,
    trainedContext: row.contextTokens,
    backend: "cpu",
    ...cpuBudget ? { kvBudgetBytes: cpuBudget } : {}
  }) : engine.contextFor({
    ...row.kv,
    trainedContext: row.contextTokens,
    f16: support.f16,
    maxStorageBufferBindingSizeBytes: support.maxStorageBufferBindingSizeBytes ?? support.maxBufferBytes
  });
  return planned > 0 ? planned : Math.min(BFI_CONTEXT_FLOOR, row.contextTokens);
}
function cancellable(source) {
  const reader = source.getReader();
  let finished = false;
  const stream = new ReadableStream({
    async pull(controller) {
      const next = await reader.read();
      if (next.done) {
        finished = true;
        controller.close();
      } else controller.enqueue(next.value);
    },
    cancel(reason) {
      finished = true;
      return reader.cancel(reason);
    }
  });
  return {
    stream,
    cancel() {
      if (finished) return;
      finished = true;
      void reader.cancel().catch((e) => reportPageEngineFailure("bfi", "cancel", e));
    }
  };
}
async function* releasing(chunks, release) {
  try {
    yield* chunks;
  } finally {
    release();
  }
}
function createBfiEngine(options) {
  const backends = options.backends ?? ["webgpu", "cpu"];
  let module2;
  let poisoned = false;
  const crashes = /* @__PURE__ */ new Set();
  const bfi = () => {
    if (!module2) {
      poisoned = false;
      const loading = options.loadBfi();
      module2 = loading;
      loading.catch(() => {
        if (module2 === loading) module2 = void 0;
      });
    }
    return module2;
  };
  const engines = /* @__PURE__ */ new Map();
  let resident;
  const queue = createEngineQueue();
  const served = /* @__PURE__ */ new Map();
  const trapped = (error) => {
    if (!isWasmTrap(error)) return false;
    if (poisoned) return true;
    poisoned = true;
    module2 = void 0;
    for (const engine of engines.values()) {
      try {
        engine.dispose?.();
      } catch (e) {
        reportPageEngineFailure("bfi", "unload", e);
      }
    }
    engines.clear();
    resident = void 0;
    prober.invalidate();
    reportPageEngineFailure("bfi", "trap", error);
    const failure = crashError(error);
    for (const end of [...crashes]) end(failure);
    options.onTrap?.(error);
    return true;
  };
  const gpuGone = (error) => {
    if (!errorMessage(error).startsWith("webgpu_unavailable")) return;
    const gpu = engines.get("webgpu");
    engines.delete("webgpu");
    if (resident?.backend === "webgpu") resident = void 0;
    try {
      gpu?.dispose?.();
    } catch (e) {
      reportPageEngineFailure("bfi", "unload", e);
    }
    prober.invalidate();
  };
  const withDeviceMemory = (s) => {
    const cpu = s.backends?.cpu;
    if (!cpu || cpu.deviceMemoryBytes !== void 0) return s;
    const deviceMemoryBytes = options.deviceMemoryBytes;
    return {
      ...s,
      backends: {
        ...s.backends,
        cpu: {
          ...cpu,
          ...deviceMemoryBytes !== void 0 ? { deviceMemoryBytes } : {},
          maxMemoryBytes: cpuMemoryCeiling(deviceMemoryBytes)
        }
      }
    };
  };
  const support = async () => {
    try {
      return options.supportFromEngine || await anyBfiModelDownloaded(options.store) ? withDeviceMemory(await (await bfi()).BfiEngine.support()) : await bfiSupportWithoutWasm(options.deviceMemoryBytes);
    } catch (e) {
      reportPageEngineFailure("bfi", "support", e);
      return BFI_UNSUPPORTED;
    }
  };
  const servable = async () => restrictBackends(await support(), backends);
  const residentEngine = async (row, backend) => {
    const current = engines.get(backend);
    if (current && resident?.ref === row.ref && resident.backend === backend) return current;
    if (resident) {
      const previous = engines.get(resident.backend);
      resident = void 0;
      try {
        previous?.unload();
      } catch (e) {
        reportPageEngineFailure("bfi", "unload", e);
      }
    }
    let engine = engines.get(backend);
    if (!engine) {
      engine = await (await bfi()).BfiEngine.create({ backend });
      engines.set(backend, engine);
    }
    const { stream, bytes } = await options.store.open(row.ref);
    const source = cancellable(stream);
    let info;
    try {
      info = await engine.load(source.stream, bytes);
    } finally {
      source.cancel();
    }
    resident = { ref: row.ref, backend };
    if (info.contextTokens > 0 && served.get(row.ref) !== info.contextTokens) {
      served.set(row.ref, info.contextTokens);
      prober.invalidate();
    }
    return engine;
  };
  const prober = memoizedProbe("bfi", async () => {
    const rows = localCatalogFor("bfi");
    const states = await Promise.all(rows.map((row) => options.store.status(row.ref)));
    const ready = new Set(rows.filter((_, i) => states[i] === "ready").map((row) => row.ref));
    if (ready.size === 0) return null;
    const device = await servable();
    const { BfiEngine } = await bfi();
    return catalogProbe(
      "bfi",
      BFI_ENGINE_BASE_URL,
      device,
      async (row) => ready.has(row.ref),
      (row, backend) => served.get(row.ref) ?? predictedContext(BfiEngine, row, device, backend)
    );
  }, options);
  async function chatCompletions(body, signal) {
    const row = localCatalogModel(formatLocalModelRef("bfi", typeof body.model === "string" ? body.model : ""));
    if (!row) throw new PageEngineError(404, "model_not_found");
    if (await options.store.status(row.ref) !== "ready") throw new PageEngineError(503, "model_not_downloaded");
    if (signal?.aborted) throw abortReason(signal);
    const fit = localModelFit(row, await servable());
    if (!fit.fits) throw new PageEngineError(503, "model_unfit", fit.reason);
    const release = await queue.acquire(signal);
    let live;
    try {
      live = await residentEngine(row, fit.backend);
    } catch (e) {
      release();
      if (trapped(e)) throw crashError(e);
      gpuGone(e);
      const mapped = bfiError(e);
      throw mapped instanceof PageEngineError ? mapped : new PageEngineError(503, "bfi_engine_unavailable", errorMessage(e));
    }
    const mapError = (e) => {
      if (trapped(e)) return crashError(e);
      gpuGone(e);
      return bfiError(e);
    };
    return releasing(bfiChunks(live, JSON.stringify({ ...body, stream: true }), signal, mapError, crashes), release);
  }
  return { runtime: "bfi", baseUrl: BFI_ENGINE_BASE_URL, ...prober, support, chatCompletions };
}

// src/pageEngines/hfModelStore.ts
var LOCAL_MODEL_CACHE = "builderforce-local-models";
function hfResolveUrl(repo, file) {
  return `https://huggingface.co/${repo}/resolve/main/${file}`;
}
var BYTES_HEADER = "x-builderforce-model-bytes";
function hfRow(ref) {
  const row = localCatalogModel(ref);
  if (!row || row.source.kind !== "hf-file") throw new Error(`unknown_model: ${ref}`);
  return row;
}
var urlOf = (ref) => {
  const { source } = hfRow(ref);
  return hfResolveUrl(source.repo, source.file);
};
function createHfModelStore(options = {}) {
  const storage = () => {
    const caches = options.caches ?? globalThis.caches;
    if (!caches) throw new Error("cache_storage_unavailable");
    return caches;
  };
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const entry = async (ref) => {
    const caches = storage();
    if (!await caches.has(LOCAL_MODEL_CACHE)) return void 0;
    return (await caches.open(LOCAL_MODEL_CACHE)).match(urlOf(ref));
  };
  return {
    async status(ref) {
      try {
        return await entry(ref) ? "ready" : "absent";
      } catch (e) {
        reportPageEngineFailure("bfi", "cache_lookup", e);
        return "absent";
      }
    },
    async download(ref, onProgress, signal) {
      const row = hfRow(ref);
      const url = urlOf(ref);
      await globalThis.navigator?.storage?.persist?.().catch((e) => reportPageEngineFailure("bfi", "persist", e));
      const res = await fetchImpl(url, { credentials: "omit", ...signal ? { signal } : {} });
      if (!res.ok || !res.body) throw new Error(`download_failed: HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || row.bytes;
      let loaded2 = 0;
      const counted = res.body.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            loaded2 += chunk.byteLength;
            onProgress?.(Math.min(1, loaded2 / total));
            controller.enqueue(chunk);
          }
        })
      );
      const cache = await storage().open(LOCAL_MODEL_CACHE);
      await cache.put(
        url,
        new Response(counted, {
          headers: { "content-type": "application/octet-stream", [BYTES_HEADER]: String(total) }
        })
      );
      if (loaded2 !== total) {
        await cache.delete(url);
        throw new Error(`download_incomplete: ${loaded2} of ${total} bytes`);
      }
    },
    async remove(ref) {
      const caches = storage();
      if (!await caches.has(LOCAL_MODEL_CACHE)) return;
      await (await caches.open(LOCAL_MODEL_CACHE)).delete(urlOf(ref));
    },
    async open(ref) {
      const res = await entry(ref);
      if (!res?.body) throw new Error(`model_not_downloaded: ${ref}`);
      const bytes = Number(res.headers.get(BYTES_HEADER)) || hfRow(ref).bytes;
      return { stream: res.body, bytes };
    }
  };
}

// src/pageEngines/bfiWorkerEngine.ts
var bfiWorkerFrame = (data) => data && typeof data === "object" && typeof data.type === "string" && data.type.startsWith("bfi.") ? data : void 0;

// src/pageEngines/bfiWorker.ts
function relayedStore(post) {
  let seq = 0;
  const waiting = /* @__PURE__ */ new Map();
  const ask = (op, args) => new Promise((resolve, reject) => {
    const id = `q${++seq}`;
    waiting.set(id, { resolve, reject });
    post({ type: "bfi.store", id, op, ...args });
  });
  return {
    store: {
      status: (ref) => ask("status", { ref }),
      async open(ref) {
        const { handle, bytes } = await ask("open", { ref });
        const stream = new ReadableStream({
          async pull(controller) {
            const chunk = await ask("read", { handle });
            if (!chunk || chunk.byteLength === 0) controller.close();
            else controller.enqueue(chunk);
          },
          cancel() {
            post({ type: "bfi.store", id: "", op: "close", handle });
          }
        });
        return { stream, bytes };
      }
    },
    answer(frame) {
      const w = waiting.get(frame.id);
      if (!w) return;
      waiting.delete(frame.id);
      if (frame.ok) w.resolve(frame.result);
      else w.reject(new Error(frame.error ?? "store_failed"));
    }
  };
}
function runBfiWorker(scope = globalThis, options = {}) {
  const post = (message2) => scope.postMessage(message2);
  const relay = relayedStore(post);
  let engine;
  let init;
  const load = async () => {
    const { wasmUrl, threads } = init;
    try {
      if (options.loadBfi) return await (threads ? options.loadBfi(wasmUrl, threads) : options.loadBfi(wasmUrl));
      return await loadBfiWeb(wasmUrl, void 0, threads ? { threads } : {});
    } catch (e) {
      if (isBfiThreadsError(e)) post({ type: "bfi.threadsFailed", message: errorMessage(e) });
      throw e;
    }
  };
  const served = serveEngineWorker(
    {
      post,
      listen: (onMessage) => {
        const listener = (event) => onMessage(event.data);
        scope.addEventListener("message", listener);
        return () => scope.removeEventListener("message", listener);
      },
      onUncaught(listener) {
        const realm = scope;
        realm.addEventListener?.("error", (event) => {
          if (listener(event.error)) event.preventDefault?.();
        });
        realm.addEventListener?.("unhandledrejection", (event) => {
          if (listener(event.reason)) event.preventDefault?.();
        });
      }
    },
    () => engine ? [engine] : [],
    (message2) => {
      const f = bfiWorkerFrame(message2);
      if (f?.type === "bfi.init") {
        if (engine) return;
        init = f;
        engine = createBfiEngine({
          loadBfi: load,
          store: f.relayStore ? relay.store : options.store ?? createHfModelStore(),
          ...f.backends ? { backends: f.backends } : {},
          onTrap: (error) => served.fatal(error)
        });
      } else if (f?.type === "bfi.support") {
        const answer = engine ? engine.support() : Promise.reject(new Error("bfi.init has not arrived"));
        void answer.then(
          (support) => post({ type: "bfi.supported", id: f.id, support }),
          () => post({ type: "bfi.supported", id: f.id })
        );
      } else if (f?.type === "bfi.stored") relay.answer(f);
    },
    { onFatal: forgetBfiWeb }
  );
}

// src/pageEngines/bfiLoader.ts
var BFI_THREADS_START_TIMEOUT_MS = 1e4;
var BfiThreadsError = class extends Error {
  constructor(message2) {
    super(`bfi_threads_failed: ${message2}`);
    this.name = "BfiThreadsError";
  }
};
var isBfiThreadsError = (e) => e instanceof Error && e.name === "BfiThreadsError";
function canUseBfiThreads(scope = globalThis) {
  const g = scope;
  return g.crossOriginIsolated === true && typeof g.SharedArrayBuffer === "function" && typeof g.Worker === "function";
}
async function hasWebGpuAdapter() {
  return (await webGpuSupport()).supported;
}
var importByUrl = (moduleUrl) => import(
  /* webpackIgnore: true */
  /* @vite-ignore */
  moduleUrl
);
var importBfiWeb = () => import("@seanhogg/bfi-web");
var loaded;
var loadedFrom;
function loadBfiWeb(wasmUrl, importer = importBfiWeb, options = {}) {
  const url = typeof wasmUrl === "string" || wasmUrl instanceof URL ? String(wasmUrl) : "wasm bytes";
  if (loaded) {
    if (loadedFrom !== url) console.warn(`bfi-web already initialized from ${loadedFrom}; ignoring ${url}`);
    return loaded;
  }
  loadedFrom = url;
  const attempt = (async () => {
    const threaded = await loadThreaded(options);
    if (threaded) return threaded;
    const module2 = await importer();
    await module2.default({ module_or_path: wasmUrl });
    return { BfiEngine: module2.BfiEngine };
  })();
  loaded = attempt;
  attempt.catch(() => {
    if (loaded === attempt) {
      loaded = void 0;
      loadedFrom = void 0;
    }
  });
  return attempt;
}
async function loadThreaded(options) {
  const { threads } = options;
  if (!threads || !canUseBfiThreads() || await hasWebGpuAdapter()) return null;
  try {
    const module2 = await (options.importThreads ?? importByUrl)(threads.moduleUrl);
    await module2.default({ module_or_path: threads.wasmUrl });
    const cores = globalThis.navigator?.hardwareConcurrency;
    const pool = module2.initThreads?.(Math.max(1, options.threadCount ?? cores ?? 1));
    if (pool) await withTimeout(pool, options.threadsTimeoutMs ?? BFI_THREADS_START_TIMEOUT_MS, "initThreads");
    return { BfiEngine: module2.BfiEngine };
  } catch (e) {
    throw new BfiThreadsError(e instanceof Error ? e.message : String(e));
  }
}
function forgetBfiWeb() {
  loaded = void 0;
  loadedFrom = void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BFI_THREADS_START_TIMEOUT_MS,
  BfiThreadsError,
  bfiSupportWithoutWasm,
  createBfiEngine,
  forgetBfiWeb,
  hfResolveUrl,
  isBfiThreadsError,
  isWasmTrap,
  loadBfiWeb,
  runBfiWorker,
  serveEngineWorker,
  servePageEngines
});
//# sourceMappingURL=bfi.cjs.map