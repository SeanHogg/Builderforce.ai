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
  AI_USE_CASES: () => AI_USE_CASES,
  BuilderforceApiError: () => BuilderforceApiError,
  BuilderforceClient: () => BuilderforceClient,
  ChatCompletionStream: () => ChatCompletionStream,
  isAIUseCase: () => isAIUseCase
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
var ChatCompletionsApi = class {
  http;
  constructor(http) {
    this.http = http;
  }
  async create(params) {
    if (params.stream) {
      const response = await this.http.postRaw("/llm/v1/chat/completions", params);
      if (!response.body) {
        throw new Error("Streaming response body is missing");
      }
      return new ChatCompletionStream(response.body);
    }
    return this.http.postJson("/llm/v1/chat/completions", params);
  }
};

// src/application/ModelsApi.ts
var ModelsApi = class {
  http;
  constructor(http) {
    this.http = http;
  }
  list() {
    return this.http.getJson("/llm/v1/models");
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
  constructor(message, status, code, details) {
    super(message);
    this.name = "BuilderforceApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
};
var HttpClient = class {
  apiKey;
  baseUrl;
  fetchFn;
  constructor(options) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
  }
  async getJson(path) {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: this.authHeaders()
    });
    return this.parseJsonResponse(res);
  }
  async postJson(path, body) {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    return this.parseJsonResponse(res);
  }
  async postRaw(path, body) {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw await this.toApiError(res);
    }
    return res;
  }
  authHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`
    };
  }
  async parseJsonResponse(res) {
    if (!res.ok) {
      throw await this.toApiError(res);
    }
    return res.json();
  }
  async toApiError(res) {
    const fallback = `Request failed (${res.status})`;
    try {
      const payload = await res.json();
      return new BuilderforceApiError(payload.error ?? fallback, res.status, payload.code, payload.details);
    } catch {
      const text = await res.text().catch(() => "");
      return new BuilderforceApiError(text || fallback, res.status);
    }
  }
};

// src/BuilderforceClient.ts
var BuilderforceClient = class {
  chat;
  models;
  usage;
  constructor(options) {
    const http = new HttpClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? "https://api.builderforce.ai",
      fetchFn: options.fetch
    });
    this.chat = {
      completions: new ChatCompletionsApi(http)
    };
    this.models = new ModelsApi(http);
    this.usage = new UsageApi(http);
  }
};

// src/domain/aiUseCases.ts
var AI_USE_CASES = [
  "ide.chat",
  "ide.code_complete",
  "training.dataset_generate",
  "training.dataset_evaluate",
  "agent.inference",
  "coder.code",
  "coder.review",
  "coder.test",
  "coder.debug",
  "coder.refactor",
  "coder.document",
  "coder.architect",
  "coach.chat",
  "coach.insight",
  "coach.classify",
  "studio.compose",
  "studio.script",
  "studio.brief",
  "pitch_deck.generate",
  "investor.update",
  "ask.general",
  "tool.classify_email",
  "tool.categorize_expense",
  "tool.contract_analyze",
  "tool.competitor_scan",
  "tool.feature_score",
  "tool.market_research",
  "tool.health_score",
  "tool.journey_insight",
  "vision.describe",
  "ocr.extract",
  "embed.text",
  "match",
  "match_tailor",
  "match_insights",
  "resume_roast",
  "skill_extract",
  "job_parser",
  "autofill",
  "article_writer",
  "studio_script",
  "studio_edit_script",
  "studio_misc",
  "linkedin_post",
  "interview_questions",
  "interview_analyze",
  "chat",
  "career",
  "discovery",
  "dashboard_summary"
];
function isAIUseCase(value) {
  return AI_USE_CASES.includes(value);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AI_USE_CASES,
  BuilderforceApiError,
  BuilderforceClient,
  ChatCompletionStream,
  isAIUseCase
});
//# sourceMappingURL=index.cjs.map