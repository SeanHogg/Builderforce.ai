import {
  BFI_ENGINE_BASE_URL,
  BFI_UNSUPPORTED,
  PageEngineError,
  abortReason,
  anyBfiModelDownloaded,
  bfiSupportWithoutWasm,
  bfiWorkerFrame,
  catalogProbe,
  cpuMemoryCeiling,
  createHfModelStore,
  errorMessage,
  formatLocalModelRef,
  hfResolveUrl,
  isWasmTrap,
  localCatalogFor,
  localCatalogModel,
  localModelFit,
  memoizedProbe,
  reportPageEngineFailure,
  restrictBackends,
  serveEngineWorker,
  servePageEngines,
  webGpuSupport,
  withTimeout
} from "./chunk-5OZKOHPX.mjs";

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

// src/pageEngines/bfiEngine.ts
var BFI_STATUS = {
  webgpu_unavailable: 503,
  cpu_memory_exceeded: 503,
  context_exceeded: 413,
  invalid_request: 400
};
function bfiError(e) {
  if (e instanceof PageEngineError) return e;
  const message = errorMessage(e);
  const code = /^([a-z_]+):/.exec(message)?.[1];
  return code && BFI_STATUS[code] ? new PageEngineError(BFI_STATUS[code], code, message) : e;
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
  let module;
  let poisoned = false;
  const crashes = /* @__PURE__ */ new Set();
  const bfi = () => {
    if (!module) {
      poisoned = false;
      const loading = options.loadBfi();
      module = loading;
      loading.catch(() => {
        if (module === loading) module = void 0;
      });
    }
    return module;
  };
  const engines = /* @__PURE__ */ new Map();
  let resident;
  const queue = createEngineQueue();
  const served = /* @__PURE__ */ new Map();
  const trapped = (error) => {
    if (!isWasmTrap(error)) return false;
    if (poisoned) return true;
    poisoned = true;
    module = void 0;
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
  const post = (message) => scope.postMessage(message);
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
    (message) => {
      const f = bfiWorkerFrame(message);
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
  constructor(message) {
    super(`bfi_threads_failed: ${message}`);
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
    const module = await importer();
    await module.default({ module_or_path: wasmUrl });
    return { BfiEngine: module.BfiEngine };
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
    const module = await (options.importThreads ?? importByUrl)(threads.moduleUrl);
    await module.default({ module_or_path: threads.wasmUrl });
    const cores = globalThis.navigator?.hardwareConcurrency;
    const pool = module.initThreads?.(Math.max(1, options.threadCount ?? cores ?? 1));
    if (pool) await withTimeout(pool, options.threadsTimeoutMs ?? BFI_THREADS_START_TIMEOUT_MS, "initThreads");
    return { BfiEngine: module.BfiEngine };
  } catch (e) {
    throw new BfiThreadsError(e instanceof Error ? e.message : String(e));
  }
}
function forgetBfiWeb() {
  loaded = void 0;
  loadedFrom = void 0;
}
export {
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
};
//# sourceMappingURL=bfi.mjs.map