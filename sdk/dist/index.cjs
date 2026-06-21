"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  BuilderforceApiError: () => BuilderforceApiError,
  BuilderforceClient: () => BuilderforceClient,
  ChatCompletionStream: () => ChatCompletionStream,
  EmbeddingsApi: () => EmbeddingsApi,
  ImagesApi: () => ImagesApi,
  ModelsApi: () => ModelsApi
});
module.exports = __toCommonJS(index_exports);

// src/infrastructure/sse.ts
async function* parseSseJson(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6).trim();
      if (data === "[DONE]") return;
      try {
        yield JSON.parse(data);
      } catch {
      }
    }
  }
}

// src/application/ChatCompletionsApi.ts
var ChatCompletionStream = class {
  stream;
  constructor(stream) {
    this.stream = stream;
  }
  [Symbol.asyncIterator]() {
    return parseSseJson(this.stream);
  }
  async toText() {
    let full = "";
    for await (const chunk of this) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string") {
        full += delta;
      }
    }
    return full;
  }
};
function splitTransportOptions(params) {
  const { timeoutMs, signal, idempotencyKey, ...rest } = params;
  const headers = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return {
    body: rest,
    request: {
      timeoutMs,
      signal,
      ...Object.keys(headers).length > 0 ? { headers } : {}
    }
  };
}
var ChatCompletionsApi = class {
  http;
  constructor(http) {
    this.http = http;
  }
  async create(params) {
    const { body, request } = splitTransportOptions(params);
    if (params.stream) {
      const response = await this.http.postRaw("/llm/v1/chat/completions", body, request);
      if (!response.body) {
        throw new Error("Streaming response body is missing");
      }
      return new ChatCompletionStream(response.body);
    }
    return this.http.postJson("/llm/v1/chat/completions", body, request);
  }
};

// src/application/EmbeddingsApi.ts
function splitTransportOptions2(params) {
  const { timeoutMs, signal, idempotencyKey, ...rest } = params;
  const headers = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return {
    body: rest,
    request: {
      timeoutMs,
      signal,
      ...Object.keys(headers).length > 0 ? { headers } : {}
    }
  };
}
var EmbeddingsApi = class {
  http;
  constructor(http) {
    this.http = http;
  }
  /**
   * Create one or more text embeddings. Wired to OpenRouter (default model
   * `nvidia/llama-nemotron-embed-vl-1b-v2:free`). Override via `model`.
   */
  create(params) {
    const { body, request } = splitTransportOptions2(params);
    return this.http.postJson("/llm/v1/embeddings", body, request);
  }
};

// src/application/ImagesApi.ts
function splitTransportOptions3(params) {
  const { timeoutMs, signal, idempotencyKey, ...rest } = params;
  const headers = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return {
    body: rest,
    request: {
      timeoutMs,
      signal,
      ...Object.keys(headers).length > 0 ? { headers } : {}
    }
  };
}
var ImagesApi = class {
  http;
  constructor(http) {
    this.http = http;
  }
  generate(params) {
    const { body, request } = splitTransportOptions3(params);
    return this.http.postJson("/llm/v1/images/generations", body, request);
  }
};

// src/application/ModelsApi.ts
var ModelsApi = class {
  http;
  constructor(http) {
    this.http = http;
  }
  /** Raw `/llm/v1/models` response — pool status, capabilities, plan, cooldowns. */
  list() {
    return this.http.getJson("/llm/v1/models");
  }
  /**
   * Models in the tenant's plan pool, as structured entries. Empty when the
   * gateway is unconfigured for this tenant (no `data` branch — nothing servable).
   */
  async listInfo() {
    const res = await this.list();
    return res.data ?? [];
  }
  /**
   * Models whose `capabilities` include `capability`. By default only
   * currently-servable models are returned (`available: true`); pass
   * `{ includeUnavailable: true }` to include cooled / key-unbound ones too.
   */
  async listByCapability(capability, opts) {
    const includeUnavailable = opts?.includeUnavailable ?? false;
    const all = await this.listInfo();
    return all.filter(
      (m) => (m.capabilities?.includes(capability) ?? false) && (includeUnavailable || m.available)
    );
  }
  /**
   * Models that can read images and (page-rasterized) PDFs — i.e. those with the
   * `vision` OR `ocr` capability. This is the set a consumer that needs to ingest
   * images / documents (e.g. hired.video) should pick from.
   */
  async listImageCapable(opts) {
    const includeUnavailable = opts?.includeUnavailable ?? false;
    const all = await this.listInfo();
    return all.filter(
      (m) => ((m.capabilities?.includes("vision") ?? false) || (m.capabilities?.includes("ocr") ?? false)) && (includeUnavailable || m.available)
    );
  }
  /** Models tuned for text extraction from images / documents (`ocr` capability). */
  listOcr(opts) {
    return this.listByCapability("ocr", opts);
  }
  /** Models that accept image content blocks (`vision` capability). */
  listVision(opts) {
    return this.listByCapability("vision", opts);
  }
};

// src/application/UsageApi.ts
var UsageApi = class {
  http;
  constructor(http) {
    this.http = http;
  }
  get(params = {}) {
    const query = typeof params.days === "number" ? `?days=${encodeURIComponent(String(params.days))}` : "";
    return this.http.getJson(`/llm/v1/usage${query}`);
  }
};

// src/infrastructure/httpClient.ts
var BuilderforceApiError = class extends Error {
  status;
  code;
  details;
  requestId;
  /**
   * `true` when the gateway has signalled this error will not resolve by
   * retrying on a different model — e.g. plan or per-claw daily token cap
   * exhausted (those caps are per-tenant, not per-model). Consumer-side
   * fallback chains should short-circuit when this is set.
   */
  terminal;
  /** Seconds the consumer should wait before retrying — server-supplied. */
  retryAfter;
  /**
   * Cascade attempts that failed before this error was returned — populated
   * when the gateway returns `429 cascade_exhausted` with a `details.failovers`
   * array. Each entry includes the vendor that owns the model so callers can
   * detect single-vendor saturation (e.g. all attempts on `openrouter`).
   */
  failovers;
  /**
   * Upstream vendor the gateway dispatched against (`'openrouter' | 'cerebras'
   * | 'nvidia' | 'ollama' | 'googleai' | …`). Set on every error where the
   * gateway selected an upstream — including single-attempt failures that
   * never ran a cascade (timeouts, single-vendor 429s, `model_unavailable`).
   *
   * Unset only for pre-dispatch errors where no vendor was ever selected:
   * `401`/`403` auth failures, `400` validation failures, `409` idempotent
   * replay, and tenant-cap 429s (`plan_token_limit_exceeded`,
   * `claw_token_limit_exceeded`) — those caps are per-tenant, not per-model.
   *
   * Sourced from the gateway's catalog lookup so consumers never have to
   * parse the model id to recover vendor identity.
   */
  vendor;
  /**
   * Model id the gateway dispatched against — set whenever `vendor` is set.
   * Pair with `vendor` for per-attempt observability without prefix parsing.
   */
  model;
  constructor(message, status, code, details, requestId, extras) {
    super(message);
    this.name = "BuilderforceApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.terminal = extras?.terminal;
    this.retryAfter = extras?.retryAfter;
    this.vendor = extras?.vendor;
    this.model = extras?.model;
    if (details && typeof details === "object") {
      const f = details.failovers;
      if (Array.isArray(f)) {
        const cleaned = [];
        for (const entry of f) {
          if (entry && typeof entry === "object") {
            const e = entry;
            if (typeof e.model === "string" && typeof e.vendor === "string" && typeof e.code === "number") {
              const ev = entry;
              cleaned.push({
                model: e.model,
                vendor: e.vendor,
                code: e.code,
                ...typeof ev.durationMs === "number" ? { durationMs: ev.durationMs } : {},
                ...typeof ev.kind === "string" ? { kind: ev.kind } : {}
              });
            }
          }
        }
        if (cleaned.length > 0) this.failovers = cleaned;
      }
    }
  }
};
var HttpClient = class {
  apiKey;
  baseUrl;
  fetchFn;
  defaultTimeoutMs;
  constructor(options) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    const fetchImpl = options.fetchFn ?? fetch;
    this.fetchFn = fetchImpl.bind(globalThis);
    this.defaultTimeoutMs = options.timeoutMs ?? 18e4;
  }
  async getJson(path, options) {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: this.mergeHeaders(options)
    }, options);
    return this.parseJsonResponse(res);
  }
  async postJson(path, body, options) {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.mergeHeaders(options, { "Content-Type": "application/json" }),
      body: JSON.stringify(body)
    }, options);
    return this.parseJsonResponse(res);
  }
  async postRaw(path, body, options) {
    const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.mergeHeaders(options, { "Content-Type": "application/json" }),
      body: JSON.stringify(body)
    }, options);
    if (!res.ok) {
      throw await this.toApiError(res);
    }
    return res;
  }
  mergeHeaders(options, base) {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      ...base ?? {},
      ...options?.headers ?? {}
    };
  }
  /**
   * Wrap a fetch in a combined abort signal: an internal timeout AND any
   * caller-provided signal. Either firing aborts the request. Single source of
   * abort plumbing — every method routes through here (DRY).
   */
  async fetchWithTimeout(input, init, options) {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const timeoutCtl = new AbortController();
    const timer = setTimeout(() => timeoutCtl.abort(), timeoutMs);
    const signal = combineSignals(timeoutCtl.signal, options?.signal);
    try {
      return await this.fetchFn(input, { ...init, signal });
    } catch (error) {
      if (timeoutCtl.signal.aborted) {
        throw new BuilderforceApiError(`Request timed out after ${timeoutMs}ms`, 408, "timeout");
      }
      if (options?.signal?.aborted) {
        throw new BuilderforceApiError("Request aborted by caller", 499, "aborted");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async parseJsonResponse(res) {
    if (!res.ok) {
      throw await this.toApiError(res);
    }
    return res.json();
  }
  async toApiError(res) {
    const fallback = `Request failed (${res.status})`;
    const requestId = res.headers.get("x-request-id") ?? void 0;
    const headerRetryAfter = parsePositiveInt(res.headers.get("retry-after"));
    try {
      const payload = await res.json();
      const errorObj = payload !== null && typeof payload === "object" && typeof payload.error === "object" && payload.error !== null ? payload.error : null;
      const isWrapped = payload !== null && typeof payload === "object" && payload.success === false && errorObj !== null;
      const inner = isWrapped || errorObj !== null ? errorObj : payload;
      const message = typeof inner?.message === "string" && inner.message || typeof inner?.error === "string" && inner.error || fallback;
      const code = typeof inner?.code === "number" ? String(inner.code) : inner?.code;
      const detailsObj = inner?.details && typeof inner.details === "object" ? inner.details : null;
      const vendor = typeof inner?.vendor === "string" ? inner.vendor : typeof detailsObj?.vendor === "string" ? detailsObj.vendor : void 0;
      const model = typeof inner?.model === "string" ? inner.model : typeof detailsObj?.model === "string" ? detailsObj.model : typeof detailsObj?.requestedModel === "string" ? detailsObj.requestedModel : void 0;
      return new BuilderforceApiError(
        message,
        res.status,
        code,
        inner?.details,
        requestId,
        {
          terminal: inner?.terminal,
          retryAfter: headerRetryAfter ?? inner?.retryAfter,
          vendor,
          model
        }
      );
    } catch {
      const text = await res.text().catch(() => "");
      return new BuilderforceApiError(
        text || fallback,
        res.status,
        void 0,
        void 0,
        requestId,
        headerRetryAfter !== void 0 ? { retryAfter: headerRetryAfter } : void 0
      );
    }
  }
};
function parsePositiveInt(s) {
  if (s == null) return void 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : void 0;
}
function combineSignals(...signals) {
  const live = signals.filter((s) => s !== void 0);
  if (live.length === 1) return live[0];
  const anyImpl = AbortSignal.any;
  if (typeof anyImpl === "function") {
    return anyImpl(live);
  }
  const ctl = new AbortController();
  for (const s of live) {
    if (s.aborted) {
      ctl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctl.abort(s.reason), { once: true });
  }
  return ctl.signal;
}

// src/BuilderforceClient.ts
var BuilderforceClient = class {
  chat;
  embeddings;
  images;
  models;
  usage;
  constructor(options) {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
      throw new BuilderforceApiError(
        "BuilderforceClient requires a non-empty apiKey",
        400,
        "missing_api_key"
      );
    }
    const http = new HttpClient({
      apiKey,
      baseUrl: options.baseUrl ?? "https://api.builderforce.ai",
      fetchFn: options.fetch,
      timeoutMs: options.timeoutMs
    });
    this.chat = {
      completions: new ChatCompletionsApi(http)
    };
    this.embeddings = new EmbeddingsApi(http);
    this.images = new ImagesApi(http);
    this.models = new ModelsApi(http);
    this.usage = new UsageApi(http);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BuilderforceApiError,
  BuilderforceClient,
  ChatCompletionStream,
  EmbeddingsApi,
  ImagesApi,
  ModelsApi
});
//# sourceMappingURL=index.cjs.map