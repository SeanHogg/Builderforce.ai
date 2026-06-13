// src/client-provider.ts
var ClientCloneProvider = class {
  id = "clone-client";
  engine;
  speaker;
  constructor(opts) {
    this.engine = opts.engine;
    this.speaker = opts.speaker;
  }
  async isAvailable() {
    return Boolean(this.engine) && Array.isArray(this.speaker?.data) && this.speaker.data.length > 0;
  }
  async unavailableReason() {
    if (await this.isAvailable()) return null;
    return "On-device clone engine or speaker embedding not provided.";
  }
  async synthesize(req) {
    const result = await this.engine.synthesize({
      text: req.text,
      speaker: this.speaker,
      ...req.speed !== void 0 ? { speed: req.speed } : {},
      ...req.signal ? { signal: req.signal } : {}
    });
    return {
      engineId: this.id,
      cloned: true,
      pcm: result.pcm,
      sampleRate: result.sampleRate,
      durationMs: result.durationMs,
      wordTimestamps: result.wordTimestamps ?? []
    };
  }
};

// src/resolve.ts
function rank(provider) {
  if (provider.id === "clone-client") return 0;
  if (provider.id === "clone-server") return 1;
  return 2;
}
async function getEngineUnavailableReason(providers) {
  const clone = providers.filter((p) => p.id === "clone-client" || p.id === "clone-server");
  if (clone.length === 0) return "No clone provider configured.";
  const reasons = [];
  for (const p of clone) {
    if (await p.isAvailable()) return null;
    reasons.push(`${p.id}: ${await p.unavailableReason() ?? "unavailable"}`);
  }
  return `Cloning unavailable \u2014 ${reasons.join("; ")}`;
}
async function resolveNarrationEngine(options) {
  const { voiceId, fallback } = options;
  const preferClone = options.preferClone ?? true;
  if (preferClone) {
    const ordered = [...options.providers].sort((a, b) => rank(a) - rank(b));
    for (const provider of ordered) {
      if (await provider.isAvailable()) {
        return wrap(provider, { voiceId, cloned: true, fallbackReason: null });
      }
    }
  }
  const reason = preferClone ? await getEngineUnavailableReason(options.providers) : "Cloning skipped for this voice.";
  if (fallback && await fallback.isAvailable()) {
    return wrap(fallback, { voiceId, cloned: false, fallbackReason: reason });
  }
  const fallbackReason = reason ?? await fallback?.unavailableReason() ?? "No narration engine available.";
  return {
    engineId: "fallback",
    cloned: false,
    fallbackReason,
    voiceId,
    synthesize: async () => {
      throw new Error(fallbackReason);
    }
  };
}
function wrap(provider, meta) {
  return {
    engineId: provider.id,
    cloned: meta.cloned,
    fallbackReason: meta.fallbackReason,
    voiceId: meta.voiceId,
    synthesize: (req) => provider.synthesize(req)
  };
}

// src/http.ts
var VoiceApiError = class extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "VoiceApiError";
  }
  status;
  code;
};
var Http = class {
  apiKey;
  baseUrl;
  fetchFn;
  timeoutMs;
  constructor(opts) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 6e4;
    if (typeof this.fetchFn !== "function") {
      throw new VoiceApiError("No fetch implementation available", 0, "no_fetch");
    }
  }
  async postJson(path, body, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const composite = composeSignals(controller.signal, signal);
    try {
      const res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: composite
      });
      if (!res.ok) throw await toError(res);
      return await res.json();
    } catch (err) {
      if (controller.signal.aborted && !(signal?.aborted ?? false)) {
        throw new VoiceApiError(`Request timed out after ${this.timeoutMs}ms`, 408, "timeout");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
};
async function toError(res) {
  let message = `Request failed with ${res.status}`;
  let code;
  try {
    const body = await res.json();
    if (typeof body.error === "string") message = body.error;
    else if (body.error?.message) message = body.error.message;
    code = (typeof body.error === "object" ? body.error.code : void 0) ?? body.code;
  } catch {
  }
  return new VoiceApiError(message, res.status, code);
}
function composeSignals(a, b) {
  if (!b) return a;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([a, b]);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

// src/server-provider.ts
var ServerCloneProvider = class {
  id = "clone-server";
  http;
  voiceId;
  constructor(opts) {
    this.voiceId = opts.voiceId;
    this.http = new Http({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl ?? "https://api.builderforce.ai",
      ...opts.fetchFn ? { fetchFn: opts.fetchFn } : {},
      ...opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}
    });
  }
  async isAvailable() {
    return Boolean(this.voiceId);
  }
  async unavailableReason() {
    return this.voiceId ? null : "No voice id configured for server synthesis.";
  }
  async synthesize(req) {
    const body = { text: req.text };
    if (req.speed !== void 0) body.speed = req.speed;
    if (req.language !== void 0) body.language = req.language;
    const res = await this.http.postJson(
      `/api/studio/voice-clones/${encodeURIComponent(this.voiceId)}/synthesize`,
      body,
      req.signal
    );
    return {
      engineId: this.id,
      cloned: true,
      audioUrl: res.audioUrl,
      audioKey: res.audioKey,
      durationMs: res.durationMs,
      wordTimestamps: res.wordTimestamps ?? []
    };
  }
};
function isEntitlementError(err) {
  return err instanceof VoiceApiError && (err.status === 402 || err.status === 403);
}

// src/client.ts
var VoiceClient = class {
  constructor(options) {
    this.options = options;
    if (!options.apiKey?.trim()) {
      throw new Error("VoiceClient requires a non-empty apiKey");
    }
  }
  options;
  /** Build the candidate providers for a voice + resolve the best available. */
  resolve(voiceId, opts = {}) {
    const providers = [];
    if (this.options.clientEngine && opts.speaker) {
      providers.push(
        new ClientCloneProvider({ engine: this.options.clientEngine, speaker: opts.speaker })
      );
    }
    providers.push(
      new ServerCloneProvider({
        apiKey: this.options.apiKey,
        voiceId,
        ...this.options.baseUrl ? { baseUrl: this.options.baseUrl } : {},
        ...this.options.fetchFn ? { fetchFn: this.options.fetchFn } : {},
        ...this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}
      })
    );
    return resolveNarrationEngine({
      voiceId,
      providers,
      ...this.options.fallback ? { fallback: this.options.fallback } : {},
      preferClone: opts.preferClone ?? true
    });
  }
  /** One-shot: resolve then synthesize. The convenience the LLM flows call. */
  async narrate(voiceId, req, opts = {}) {
    const engine = await this.resolve(voiceId, opts);
    return engine.synthesize(req);
  }
};

// src/fallback-provider.ts
var FallbackVoiceProvider = class {
  id = "fallback";
  voiceName;
  delegate;
  constructor(opts) {
    this.voiceName = opts.voiceName;
    this.delegate = opts.synthesize;
  }
  async isAvailable() {
    return typeof this.delegate === "function";
  }
  async unavailableReason() {
    return this.delegate ? null : `No fallback voice ("${this.voiceName}") synthesizer configured.`;
  }
  async synthesize(req) {
    if (!this.delegate) {
      throw new Error(`Fallback voice "${this.voiceName}" has no synthesizer.`);
    }
    const base = await this.delegate(req);
    return { ...base, engineId: this.id, cloned: false };
  }
};
export {
  ClientCloneProvider,
  FallbackVoiceProvider,
  ServerCloneProvider,
  VoiceApiError,
  VoiceClient,
  getEngineUnavailableReason,
  isEntitlementError,
  resolveNarrationEngine
};
//# sourceMappingURL=index.mjs.map