// ../packages/local-inference/src/runtimes.ts
var BROWSER_ENGINE_BASE_URL = "http://browser.local";
var BFI_ENGINE_BASE_URL = "http://bfi.local";
var WEBLLM_ENGINE_BASE_URL = "http://webllm.local";
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
  { id: "kimi-code", automaticRank: Number.POSITIVE_INFINITY, label: "Kimi Code", onDevice: false, catalog: "declared", tools: "all", reach: "http", gatewayVendor: "kimi-code", providerSampling: true, accountProvider: "kimi" }
];
var HTTP_LOCAL_RUNTIMES = LOCAL_RUNTIMES.filter((r) => r.reach === "http");
var LOCAL_RUNTIME_IDS = LOCAL_RUNTIMES.map((r) => r.id);
function isLocalRuntimeId(value) {
  return typeof value === "string" && LOCAL_RUNTIME_IDS.includes(value);
}
function localRuntime(id) {
  return LOCAL_RUNTIMES.find((r) => r.id === id);
}
var HOST_FALLBACK_RUNTIMES = LOCAL_RUNTIMES.filter((r) => r.fallbackReach === "host");

// ../packages/local-inference/src/ref.ts
var LOCAL_MODEL_PREFIX = "local/";
var GATEWAY_DIRECT_PREFIX = "direct/";
function formatLocalModelRef(runtime, model) {
  return `${LOCAL_MODEL_PREFIX}${runtime}/${model}`;
}
function parseLocalModelRef(ref) {
  if (!ref || !ref.startsWith(LOCAL_MODEL_PREFIX)) return null;
  const rest = ref.slice(LOCAL_MODEL_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const provider = rest.slice(0, slash);
  const model = rest.slice(slash + 1);
  if (!model || !isLocalRuntimeId(provider)) return null;
  return { provider, model };
}
function clientPinOf(ref) {
  const local = parseLocalModelRef(ref);
  if (local || !ref || !ref.startsWith(GATEWAY_DIRECT_PREFIX)) return local;
  const rest = ref.slice(GATEWAY_DIRECT_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const vendor = rest.slice(0, slash);
  const model = rest.slice(slash + 1);
  const runtime = LOCAL_RUNTIMES.find((r) => r.gatewayVendor === vendor);
  return runtime && model ? { provider: runtime.id, model } : null;
}
function isLocalModelRef(ref) {
  return parseLocalModelRef(ref) !== null;
}
function runsOnDevice(ref) {
  const parsed = parseLocalModelRef(ref);
  return !!parsed && localRuntime(parsed.provider).onDevice;
}

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

// ../packages/local-inference/src/catalogPicker.ts
var LOCAL_PICKER_GROUPS = ["tools", "chat", "coding", "reasoning", "math"];
function localPickerGroup(row) {
  if (row.tools) return "tools";
  for (const group of ["coding", "reasoning", "math"]) if (row.uses.includes(group)) return group;
  return "chat";
}
function localPickerView(rows, options = {}) {
  const { fits = () => true, pinned = () => false } = options;
  const byGroup = /* @__PURE__ */ new Map();
  const more = [];
  const hidden = [];
  for (const row of rows) {
    if (!isLocalChatModel(row)) continue;
    const held = pinned(row);
    if (!fits(row) && !held) {
      hidden.push(row);
      continue;
    }
    if (!row.recommended && !held) {
      more.push(row);
      continue;
    }
    const group = localPickerGroup(row);
    byGroup.set(group, [...byGroup.get(group) ?? [], row]);
  }
  const groups = LOCAL_PICKER_GROUPS.flatMap((group) => {
    const listed = byGroup.get(group);
    return listed ? [{ group, rows: listed }] : [];
  });
  return { groups, more, hidden };
}

// ../packages/local-inference/src/endpoint.ts
function normalizeLocalBaseUrl(raw) {
  return raw.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}
function localChatCompletionsUrl(baseUrl) {
  return `${normalizeLocalBaseUrl(baseUrl)}/v1/chat/completions`;
}
var GATEWAY_COMPLETIONS_PATH = "/llm/v1/chat/completions";
var LOCAL_COMPLETIONS_PATH = "/v1/chat/completions";
function rewriteToLocalUrl(url) {
  return url.endsWith(GATEWAY_COMPLETIONS_PATH) ? `${url.slice(0, -GATEWAY_COMPLETIONS_PATH.length)}${LOCAL_COMPLETIONS_PATH}` : url;
}
async function fetchLocal(endpoint, fetchImpl, url, init) {
  const credential = endpoint.credential;
  if (!credential) return fetchImpl(url, init);
  const send = (token2) => fetchImpl(url, { ...init, headers: withBearer(init.headers, token2) });
  const token = await credential();
  const res = await send(token);
  if (res.status !== 401 || !token) return res;
  const replacement = await credential(token);
  if (!replacement || replacement === token) return res;
  await res.body?.cancel().catch(() => void 0);
  return send(replacement);
}
function withBearer(headers, token) {
  const out = {};
  new Headers(headers).forEach((value, key) => {
    if (key !== "authorization") out[key] = value;
  });
  if (token) out.authorization = `Bearer ${token}`;
  return out;
}
function localAuthHeaders(endpoint) {
  return endpoint.token ? { authorization: `Bearer ${endpoint.token}` } : {};
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

// ../packages/local-inference/src/plan.ts
function localModelUnfitReason(model, workload) {
  if (workload.agentic && model.tools !== true) return "tools";
  if (model.contextTokens !== void 0 && model.contextTokens < workload.inputTokens + workload.outputTokens) {
    return "context";
  }
  return null;
}
function localFirstPlan(input) {
  const onDevice = new Set(LOCAL_RUNTIMES.filter((r) => r.onDevice).map((r) => r.id));
  const rank = (id) => LOCAL_RUNTIMES.find((r) => r.id === id)?.automaticRank ?? Number.POSITIVE_INFINITY;
  const candidates = input.probes.filter((p) => p.reachable && onDevice.has(p.provider)).sort((a, b) => rank(a.provider) - rank(b.provider)).flatMap(
    (p) => p.models.filter((m) => localModelUnfitReason(m, input.workload) === null).map((m) => ({
      kind: "local",
      ref: m.ref,
      provider: p.provider,
      model: m.model,
      endpoint: p.endpoint
    }))
  );
  const preferredIndex = input.preferred ? candidates.findIndex((c) => c.kind === "local" && c.ref === input.preferred) : -1;
  if (preferredIndex > 0) candidates.unshift(...candidates.splice(preferredIndex, 1));
  const local = candidates.slice(0, Math.max(0, input.maxLocalAttempts ?? 1));
  const accounts = (input.accounts ?? []).map((account) => ({ kind: "local", ...account }));
  const leading = [...local, ...accounts];
  return input.cloud ? [...leading, { kind: "cloud", ...input.cloud.model ? { model: input.cloud.model } : {} }] : leading;
}

// ../packages/local-inference/src/failover.ts
var LocalFirstUnavailableError = class extends Error {
  constructor() {
    super("local_first_unavailable: no local model fits this call and no cloud fallback is available");
    this.name = "LocalFirstUnavailableError";
  }
};
async function runLocalFirst(plan, run, options = {}) {
  if (plan.length === 0) throw new LocalFirstUnavailableError();
  const attempts = [];
  const record = (entry) => {
    attempts.push(entry);
    options.onAttempt?.(entry);
  };
  for (let i = 0; i < plan.length; i++) {
    const attempt = plan[i];
    const isLast = i === plan.length - 1;
    const state = { committed: false };
    try {
      const result = await run(attempt, () => {
        state.committed = true;
      });
      if (state.committed || isLast || (options.accept?.(result) ?? true)) {
        record({ attempt, outcome: "served" });
        return { result, served: attempt, attempts };
      }
      record({ attempt, outcome: "refused", detail: "empty_response" });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      record({ attempt, outcome: "failed", detail });
      if (options.signal?.aborted || state.committed || isLast) throw e;
    }
  }
  throw new LocalFirstUnavailableError();
}

// src/pageEngines/engineFailure.ts
function reportPageEngineFailure(runtime, stage, error) {
  console.warn(`BuilderForce page engine: ${runtime} ${stage} failed (${errorMessage(error)})`);
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
var hasTools = (body) => Array.isArray(body.tools) && body.tools.length > 0;
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

// src/pageEngines/remote/protocol.ts
var PAGE_ENGINE_REQUEST_TYPES = ["pageEngine.probe", "pageEngine.chat", "pageEngine.abort"];
var PAGE_ENGINE_REPLY_TYPES = ["pageEngine.probed", "pageEngine.chunk", "pageEngine.end", "pageEngine.error", "pageEngine.alive"];
var PAGE_ENGINE_HEARTBEAT_MS = 3e4;
var has = (types, message2, idRequired) => {
  if (!message2 || typeof message2 !== "object") return false;
  const { type, id } = message2;
  return typeof type === "string" && types.includes(type) && (!idRequired || typeof id === "string");
};
function isPageEngineReply(message2) {
  return has(PAGE_ENGINE_REPLY_TYPES, message2, true);
}
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

// src/pageEngines/remote/client.ts
var PAGE_ENGINE_CHAT_IDLE_MS = 12e4;
var PAGE_ENGINE_DETACHED = "page_engine_detached";
var ChunkQueue = class {
  items = [];
  finished = false;
  failure;
  waiter;
  get settled() {
    return this.finished || this.failure !== void 0;
  }
  push(chunk) {
    if (this.settled) return;
    if (this.waiter) {
      const { resolve } = this.waiter;
      this.waiter = void 0;
      resolve({ done: false, value: chunk });
    } else this.items.push(chunk);
  }
  end() {
    if (this.settled) return;
    this.finished = true;
    if (this.waiter && this.items.length === 0) {
      const { resolve } = this.waiter;
      this.waiter = void 0;
      resolve({ done: true, value: void 0 });
    }
  }
  fail(error) {
    if (this.settled) return;
    this.failure = { error };
    if (this.waiter) {
      const { reject } = this.waiter;
      this.waiter = void 0;
      reject(error);
    }
  }
  next() {
    const item = this.items.shift();
    if (item) return Promise.resolve({ done: false, value: item });
    if (this.failure) return Promise.reject(this.failure.error);
    if (this.finished) return Promise.resolve({ done: true, value: void 0 });
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
  }
};
var LATE_PROBES_KEPT = 64;
function createPageEngineClient(options) {
  let seq = 0;
  const newId = options.newId ?? (() => `pe${++seq}`);
  const chatIdleMs = options.chatIdleMs ?? PAGE_ENGINE_CHAT_IDLE_MS;
  const pending = /* @__PURE__ */ new Map();
  const late = /* @__PURE__ */ new Map();
  let clock = 0;
  const heardAt = /* @__PURE__ */ new Map();
  const heard = (port) => {
    heardAt.set(port, ++clock);
    options.onHeard?.(port);
  };
  const detached = (message2) => new PageEngineError(503, PAGE_ENGINE_DETACHED, `${PAGE_ENGINE_DETACHED}: ${message2}`);
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
          return new Promise((resolve) => {
            const timer = setTimeout(() => {
              settle(null);
              late.set(id, port);
              if (late.size > LATE_PROBES_KEPT) late.delete(late.keys().next().value);
              if ((heardAt.get(port) ?? -1) <= sentAt) options.onProbeTimeout?.(port);
            }, probeTimeoutMs);
            function settle(probe) {
              clearTimeout(timer);
              pending.delete(id);
              resolve(probe);
            }
            pending.set(id, { kind: "probe", port, settle });
            port.post({ type: "pageEngine.probe", id, runtime, ...probeOptions.fresh ? { fresh: true } : {} });
          });
        },
        invalidate() {
        },
        async chatCompletions(body, signal) {
          if (signal?.aborted) throw abortReason(signal);
          const port = portFor();
          if (!port) throw new PageEngineError(503, `${runtime}_unavailable`, options.unavailableMessage ?? `${runtime} is not available here.`);
          const id = newId();
          const queue = new ChunkQueue();
          let idle;
          const disarm = () => {
            if (idle) clearTimeout(idle);
            idle = void 0;
          };
          const stop = (reason) => {
            disarm();
            if (!pending.has(id)) return;
            pending.delete(id);
            port.post({ type: "pageEngine.abort", id });
            queue.fail(reason);
          };
          const arm = () => {
            disarm();
            if (chatIdleMs > 0 && Number.isFinite(chatIdleMs)) {
              idle = setTimeout(() => stop(detached(`no reply from the engine for ${Math.round(chatIdleMs / 1e3)} s`)), chatIdleMs);
            }
          };
          pending.set(id, { kind: "chat", port, queue, arm, disarm });
          arm();
          signal?.addEventListener("abort", () => stop(abortReason(signal)), { once: true });
          port.post({ type: "pageEngine.chat", id, runtime, body });
          return {
            [Symbol.asyncIterator]: () => ({
              next: () => queue.next(),
              // The consumer let go early (a cancelled body): stop the far engine.
              return: async () => {
                stop(new DOMException("Aborted", "AbortError"));
                return { done: true, value: void 0 };
              }
            })
          };
        }
      };
    },
    receive(message2) {
      if (!isPageEngineReply(message2)) return false;
      const entry = pending.get(message2.id);
      if (!entry) {
        const port = late.get(message2.id);
        if (port) {
          late.delete(message2.id);
          heard(port);
        }
        return true;
      }
      heard(entry.port);
      switch (message2.type) {
        case "pageEngine.probed":
          if (entry.kind === "probe") entry.settle(message2.probe);
          break;
        case "pageEngine.chunk":
          if (entry.kind === "chat") {
            entry.arm();
            entry.queue.push(message2.chunk);
          }
          break;
        case "pageEngine.alive":
          if (entry.kind === "chat") entry.arm();
          break;
        case "pageEngine.end":
          if (entry.kind === "chat") {
            entry.disarm();
            pending.delete(message2.id);
            entry.queue.end();
          }
          break;
        case "pageEngine.error":
          pending.delete(message2.id);
          if (entry.kind === "chat") {
            entry.disarm();
            entry.queue.fail(new PageEngineError(message2.status, message2.code, message2.message));
          } else entry.settle(null);
          break;
      }
      return true;
    },
    drop(port) {
      heardAt.delete(port);
      for (const [id, entry] of [...pending]) {
        if (entry.port !== port) continue;
        if (entry.kind === "probe") entry.settle(null);
        else {
          entry.disarm();
          pending.delete(id);
          entry.queue.fail(detached(options.detachedMessage ?? "The engine serving this model went away."));
        }
      }
    }
  };
}

// src/pageEngines/remote/engineWorker.ts
var ENGINE_WORKER_IDLE_MS = 5 * 6e4;
var ENGINE_WORKER_INVALIDATE = "engineWorker.invalidate";
var ENGINE_WORKER_FATAL = "engineWorker.fatal";
var ENGINE_WORKER_CRASH_LIMIT = 2;
var ENGINE_WORKER_CRASH_WINDOW_MS = 10 * 6e4;
var MODEL_KEEPS_CRASHING = "model_keeps_crashing";
var ORDERLY = /* @__PURE__ */ new Set(["idle", "disposed", "spawn_failed", "restart"]);
var modelKey = (runtime, model) => `${String(runtime)}/${typeof model === "string" ? model : ""}`;
function createEngineWorker(options) {
  const idleMs = options.idleMs ?? ENGINE_WORKER_IDLE_MS;
  const warn = options.warn ?? ((message2) => console.warn(message2));
  const now = options.now ?? (() => Date.now());
  let live;
  const crashes = /* @__PURE__ */ new Map();
  const failed = /* @__PURE__ */ new Set();
  const recordCrash = (key) => {
    const at = now();
    const recent = (crashes.get(key) ?? []).filter((t) => at - t < ENGINE_WORKER_CRASH_WINDOW_MS);
    recent.push(at);
    crashes.set(key, recent);
    if (recent.length >= ENGINE_WORKER_CRASH_LIMIT && !failed.has(key)) {
      failed.add(key);
      warn(`engine worker: ${key} crashed ${recent.length}\xD7 in ${ENGINE_WORKER_CRASH_WINDOW_MS / 6e4} min; not loading it again this session`);
    }
  };
  const stop = (gen, reason) => {
    if (live !== gen) return;
    live = void 0;
    if (gen.timer) clearTimeout(gen.timer);
    if (!ORDERLY.has(reason)) for (const key of new Set(gen.open.values())) recordCrash(key);
    void gen.handle.then((h) => h.terminate(), () => void 0);
    options.onStopped(gen.port, reason);
  };
  const touch = (gen) => {
    if (gen.timer) clearTimeout(gen.timer);
    gen.timer = void 0;
    if (gen.open.size === 0 && idleMs > 0 && Number.isFinite(idleMs)) gen.timer = setTimeout(() => stop(gen, "idle"), idleMs);
  };
  const withoutFailed = (message2) => {
    const probe = message2.probe;
    if (!probe || failed.size === 0) return message2;
    const models = probe.models.filter((m) => !failed.has(modelKey(probe.provider, m.model)));
    if (models.length === probe.models.length) return message2;
    return { ...message2, probe: models.length > 0 ? { ...probe, models } : null };
  };
  const start = () => {
    const gen = { open: /* @__PURE__ */ new Map() };
    const events = {
      onMessage(message2) {
        if (live !== gen) return;
        const m = message2;
        if (m && m.type === ENGINE_WORKER_FATAL) {
          warn(`engine worker trapped (${String(m.message ?? "fatal")}); starting a fresh one on the next request`);
          stop(gen, "fatal");
          return;
        }
        if (m && (m.type === "pageEngine.end" || m.type === "pageEngine.error") && typeof m.id === "string") gen.open.delete(m.id);
        options.onMessage(m && m.type === "pageEngine.probed" ? withoutFailed(m) : message2);
        touch(gen);
      },
      onGone(reason) {
        if (live !== gen) return;
        warn(`engine worker stopped (${reason})`);
        stop(gen, reason);
      }
    };
    gen.handle = Promise.resolve().then(() => options.spawn(events));
    gen.handle.catch((e) => {
      warn(`engine worker could not start (${e instanceof Error ? e.message : String(e)})`);
      stop(gen, "spawn_failed");
    });
    gen.port = {
      post(message2) {
        const m = message2;
        if (m.type === "pageEngine.chat" && typeof m.id === "string") {
          const key = modelKey(m.runtime, m.body?.model);
          if (failed.has(key)) {
            const id = m.id;
            queueMicrotask(
              () => options.onMessage({
                type: "pageEngine.error",
                id,
                status: 503,
                code: MODEL_KEEPS_CRASHING,
                message: `${MODEL_KEEPS_CRASHING}: ${key} crashed this device's engine ${ENGINE_WORKER_CRASH_LIMIT} times; remove it or try another model`
              })
            );
            return;
          }
          gen.open.set(m.id, key);
        }
        if (m.type === "pageEngine.abort" && typeof m.id === "string") gen.open.delete(m.id);
        touch(gen);
        void gen.handle.then((h) => h.post(message2), () => void 0);
      }
    };
    live = gen;
    touch(gen);
    return gen;
  };
  return {
    port: () => (live ?? start()).port,
    running: () => live !== void 0,
    invalidate() {
      live?.port.post({ type: ENGINE_WORKER_INVALIDATE });
    },
    dispose() {
      if (live) stop(live, "disposed");
    },
    restart(reason) {
      if (!live) return;
      warn(`engine worker restarting (${reason})`);
      stop(live, "restart");
    }
  };
}
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
function hasWebGPU() {
  return pageGpu() != null;
}
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
function withPeerBackends(own, backends, peer) {
  const local = restrictBackends(own, backends);
  if (!peer) return local;
  const top = backends.includes("webgpu") ? local : { ...local, ...topLevel(peer) };
  return {
    ...top,
    backends: {
      ...backends.includes("webgpu") ? pick(local, "webgpu") : pick(peer, "webgpu"),
      ...backends.includes("cpu") ? pick(local, "cpu") : pick(peer, "cpu")
    }
  };
}
function topLevel(s) {
  const { backends: _backends, ...rest } = s;
  return rest;
}
function pick(s, key) {
  const value = s.backends?.[key];
  return value ? { [key]: value } : {};
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

// src/pageEngines/bfiWorkerEngine.ts
var bfiWorkerFrame = (data) => data && typeof data === "object" && typeof data.type === "string" && data.type.startsWith("bfi.") ? data : void 0;
function createBfiWorkerEngine(options) {
  const timeoutMs = options.timeoutMs ?? 2e4;
  const backends = options.backends ?? ["webgpu", "cpu"];
  const client = createPageEngineClient({
    probeTimeoutMs: timeoutMs,
    unavailableMessage: "The bfi worker could not start.",
    detachedMessage: "The bfi worker stopped while answering."
  });
  const supports = /* @__PURE__ */ new Map();
  let seq = 0;
  let threadsOffered = true;
  let threadRestarts = 0;
  const reads = /* @__PURE__ */ new Map();
  const replyToStore = async (f) => {
    const store = options.store;
    if (!store) throw new Error("no store on this page");
    switch (f.op) {
      case "status":
        return store.status(f.ref);
      case "open": {
        if (!store.open) throw new Error("this page store cannot be read");
        const { stream, bytes } = await store.open(f.ref);
        const handle = `r${++seq}`;
        reads.set(handle, stream.getReader());
        return { handle, bytes };
      }
      case "read": {
        const reader = reads.get(f.handle);
        if (!reader) return null;
        const next = await reader.read();
        if (next.done) {
          reads.delete(f.handle);
          return null;
        }
        return next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
      }
      case "close": {
        const reader = reads.get(f.handle);
        reads.delete(f.handle);
        await reader?.cancel().catch((e) => reportPageEngineFailure("bfi", "cancel", e));
        return void 0;
      }
    }
  };
  const closeReads = () => {
    for (const reader of reads.values()) void reader.cancel().catch((e) => reportPageEngineFailure("bfi", "cancel", e));
    reads.clear();
  };
  const worker = createEngineWorker({
    async spawn(events) {
      const w = options.create();
      w.addEventListener("message", (event) => events.onMessage(event.data));
      w.addEventListener("error", (event) => events.onGone(event.message ?? "error"));
      w.addEventListener("messageerror", () => events.onGone("messageerror"));
      const threads = threadsOffered ? await options.threads?.() : void 0;
      const init = {
        type: "bfi.init",
        wasmUrl: String(await options.wasmUrl()),
        ...threads ? { threads } : {},
        ...options.backends ? { backends: options.backends } : {},
        ...options.relayStore ? { relayStore: true } : {}
      };
      w.postMessage(init);
      return { post: (message2) => w.postMessage(message2), terminate: () => w.terminate() };
    },
    onMessage(message2) {
      const f = bfiWorkerFrame(message2);
      if (!f) {
        client.receive(message2);
        return;
      }
      if (f.type === "bfi.supported") {
        supports.get(f.id)?.(f.support ?? BFI_UNSUPPORTED);
        supports.delete(f.id);
      } else if (f.type === "bfi.store") {
        void replyToStore(f).then(
          (result) => f.id && worker.running() && worker.port().post({ type: "bfi.stored", id: f.id, ok: true, result }),
          (e) => f.id && worker.running() && worker.port().post({ type: "bfi.stored", id: f.id, ok: false, error: errorMessage(e) })
        );
      } else if (f.type === "bfi.threadsFailed") {
        console.warn(`bfi: the threaded build did not start (${f.message}); restarting single-threaded`);
        threadsOffered = false;
        threadRestarts++;
        worker.restart("threads_failed");
      }
    },
    onStopped(port) {
      client.drop(port);
      closeReads();
      for (const settle of [...supports.values()]) settle(BFI_UNSUPPORTED);
      supports.clear();
    },
    ...options.idleMs !== void 0 ? { idleMs: options.idleMs } : {}
  });
  const anyDownloaded = () => options.store ? anyBfiModelDownloaded(options.store) : Promise.resolve(true);
  const onceMore = async (ask, failed) => {
    const before = threadRestarts;
    const value = await ask();
    return failed(value) && threadRestarts !== before ? ask() : value;
  };
  const ownSupport = () => {
    const id = `s${++seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(BFI_UNSUPPORTED), timeoutMs);
      function settle(support) {
        clearTimeout(timer);
        supports.delete(id);
        resolve(support);
      }
      supports.set(id, settle);
      worker.port().post({ type: "bfi.support", id });
    });
  };
  const engine = client.engine("bfi", BFI_ENGINE_BASE_URL, () => worker.port());
  async function* retried(body, signal) {
    for (let attempt = 0; ; attempt++) {
      const before = threadRestarts;
      let yielded = false;
      try {
        for await (const chunk of await engine.chatCompletions(body, signal)) {
          yielded = true;
          yield chunk;
        }
        return;
      } catch (e) {
        const cutOff = e instanceof PageEngineError && e.code === "page_engine_detached" && threadRestarts !== before;
        if (yielded || attempt > 0 || !cutOff || signal?.aborted) throw e;
      }
    }
  }
  return {
    ...engine,
    async probe(probeOptions) {
      if (!await anyDownloaded()) return null;
      return onceMore(() => engine.probe(probeOptions), (probe) => probe === null);
    },
    invalidate() {
      worker.invalidate();
    },
    // A refusal surfaces on the first `next()`, before anything streamed — where the
    // shim answers it with its status, exactly as an in-place engine's would.
    chatCompletions: async (body, signal) => retried(body, signal),
    async support() {
      const [own, peer] = await Promise.all([
        (async () => {
          if (!await anyDownloaded()) return bfiSupportWithoutWasm();
          return onceMore(ownSupport, (s) => s === BFI_UNSUPPORTED);
        })(),
        // A peer that cannot answer leaves this host's own record standing.
        options.peerSupport?.().catch((e) => {
          reportPageEngineFailure("bfi", "support", e);
          return void 0;
        })
      ]);
      return withPeerBackends(own, backends, peer);
    },
    dispose() {
      worker.dispose();
      closeReads();
    }
  };
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
      let loaded = 0;
      const counted = res.body.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            loaded += chunk.byteLength;
            onProgress?.(Math.min(1, loaded / total));
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
      if (loaded !== total) {
        await cache.delete(url);
        throw new Error(`download_incomplete: ${loaded} of ${total} bytes`);
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

export {
  BROWSER_ENGINE_BASE_URL,
  BFI_ENGINE_BASE_URL,
  WEBLLM_ENGINE_BASE_URL,
  localRuntime,
  formatLocalModelRef,
  parseLocalModelRef,
  clientPinOf,
  isLocalModelRef,
  runsOnDevice,
  normalizeLocalBaseUrl,
  localChatCompletionsUrl,
  rewriteToLocalUrl,
  fetchLocal,
  localAuthHeaders,
  LOCAL_MODEL_CATALOG,
  localCatalogModel,
  localCatalogFor,
  LOCAL_PICKER_GROUPS,
  localPickerView,
  cpuMemoryCeiling,
  localModelFit,
  localFirstPlan,
  runLocalFirst,
  reportPageEngineFailure,
  PageEngineError,
  abortReason,
  errorMessage,
  hasTools,
  memoizedProbe,
  PAGE_ENGINE_REQUEST_TYPES,
  PAGE_ENGINE_REPLY_TYPES,
  isPageEngineReply,
  isPageEngineRequest,
  servePageEngines,
  createPageEngineClient,
  ENGINE_WORKER_IDLE_MS,
  ENGINE_WORKER_INVALIDATE,
  ENGINE_WORKER_FATAL,
  createEngineWorker,
  serveEngineWorker,
  isWasmTrap,
  withTimeout,
  hasWebGPU,
  webGpuSupport,
  BFI_UNSUPPORTED,
  anyBfiModelDownloaded,
  restrictBackends,
  bfiSupportWithoutWasm,
  bfiWorkerFrame,
  createBfiWorkerEngine,
  hfResolveUrl,
  createHfModelStore,
  catalogProbe
};
//# sourceMappingURL=chunk-5OZKOHPX.mjs.map