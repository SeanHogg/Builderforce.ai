// src/pageEngines/engineFailure.ts
function reportPageEngineFailure(runtime, stage, error) {
  console.warn(`BuilderForce page engine: ${runtime} ${stage} failed (${errorMessage(error)})`);
}

// src/pageEngines/types.ts
var PageEngineError = class extends Error {
  status;
  code;
  constructor(status, code, message = code) {
    super(message);
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

export {
  reportPageEngineFailure,
  PageEngineError,
  abortReason,
  errorMessage,
  hasTools,
  memoizedProbe
};
//# sourceMappingURL=chunk-SLI7C3HD.mjs.map