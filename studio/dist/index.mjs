import {
  hasWebGPUSupport,
  probeDevice
} from "./chunk-Q5Y27QLY.mjs";

// src/engine/diffusion-engine.ts
import * as ort4 from "onnxruntime-web";
import { AutoTokenizer } from "@huggingface/transformers";

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/shared/idb.js
var blockedOpens = /* @__PURE__ */ new WeakMap();
function isBlocked(factory, name) {
  return blockedOpens.get(factory)?.has(name) ?? false;
}
function markBlocked(factory, name) {
  let names = blockedOpens.get(factory);
  if (!names) {
    names = /* @__PURE__ */ new Set();
    blockedOpens.set(factory, names);
  }
  names.add(name);
}
function clearBlocked(factory, name) {
  blockedOpens.get(factory)?.delete(name);
}
function openRaw(factory, name, version, storeName) {
  return new Promise((resolve) => {
    if (isBlocked(factory, name)) {
      resolve(void 0);
      return;
    }
    let request;
    try {
      request = version === void 0 ? factory.open(name) : factory.open(name, version);
    } catch {
      resolve(void 0);
      return;
    }
    let gaveUp = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName))
        db.createObjectStore(storeName);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (gaveUp) {
        db.close();
        clearBlocked(factory, name);
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      if (gaveUp)
        clearBlocked(factory, name);
      resolve(void 0);
    };
    request.onblocked = () => {
      if (!gaveUp)
        markBlocked(factory, name);
      gaveUp = true;
      resolve(void 0);
    };
  });
}
function storeOf(db, storeName, onClosed) {
  let closed = false;
  const close = () => {
    if (closed)
      return;
    closed = true;
    db.close();
    onClosed?.();
  };
  db.onversionchange = close;
  db.onclose = close;
  return {
    run(mode, fn) {
      return new Promise((resolve, reject) => {
        let tx;
        let req;
        try {
          tx = db.transaction(storeName, mode);
        } catch (error) {
          reject(error);
          return;
        }
        const failure = () => tx.error ?? req?.error ?? new Error(`IndexedDB transaction on ${storeName} failed`);
        tx.oncomplete = () => resolve(req.result);
        tx.onabort = () => reject(failure());
        tx.onerror = () => reject(failure());
        try {
          req = fn(tx.objectStore(storeName));
        } catch (error) {
          try {
            tx.abort();
          } catch {
          }
          reject(error);
        }
      });
    },
    close
  };
}
async function openIdbStore(factory, config, onClosed) {
  if (!factory)
    return void 0;
  let db = await openRaw(factory, config.dbName, config.version, config.storeName);
  if (!db) {
    db = await openRaw(factory, config.dbName, void 0, config.storeName);
    if (!db)
      return void 0;
  }
  if (!db.objectStoreNames.contains(config.storeName)) {
    const next = db.version + 1;
    db.close();
    db = await openRaw(factory, config.dbName, next, config.storeName);
    if (!db || !db.objectStoreNames.contains(config.storeName))
      return void 0;
  }
  return storeOf(db, config.storeName, onClosed);
}
function lazyIdbStore(factory, config) {
  let opened;
  return () => {
    if (opened)
      return opened;
    const attempt = openIdbStore(factory, config, () => {
      if (opened === attempt)
        opened = void 0;
    });
    opened = attempt;
    void attempt.then((store) => {
      if (!store && opened === attempt)
        opened = void 0;
    });
    return attempt;
  };
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/inference/modelCache.js
function isArrayBuffer(value) {
  return value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}
function toEntry(id, value) {
  if (value === void 0 || value === null)
    return void 0;
  if (isArrayBuffer(value))
    return { id, bytes: value, size: value.byteLength, storedAt: 0 };
  return value;
}
function createModelCache(options = {}) {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const config = {
    dbName: options.dbName ?? "bfwc-inference-models",
    storeName: options.storeName ?? "models",
    version: options.dbVersion ?? 1
  };
  const raw = options.valueFormat === "raw";
  const open = lazyIdbStore(factory, config);
  return {
    async get(id) {
      const store = await open();
      if (!store)
        return void 0;
      return toEntry(id, await store.run("readonly", (s) => s.get(id)));
    },
    async put(id, entry) {
      const store = await open();
      if (!store)
        return;
      const value = raw ? entry.bytes : { ...entry, id, storedAt: Date.now() };
      await store.run("readwrite", (s) => s.put(value, id));
    },
    async has(id) {
      const store = await open();
      if (!store)
        return false;
      return await store.run("readonly", (s) => s.count(id)) > 0;
    },
    async delete(id) {
      await (await open())?.run("readwrite", (s) => s.delete(id));
    },
    async keys() {
      const store = await open();
      if (!store)
        return [];
      return (await store.run("readonly", (s) => s.getAllKeys())).map(String);
    }
  };
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/shared/hardwareProbe.js
var SIMD_PROBE = new Uint8Array([
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  1,
  4,
  1,
  96,
  0,
  0,
  3,
  2,
  1,
  0,
  10,
  9,
  1,
  7,
  0,
  65,
  0,
  253,
  15,
  26,
  11
]);
var GIB = 1024 * 1024 * 1024;
function probeDeviceMemoryBytes() {
  const deviceMemory = globalThis.navigator?.deviceMemory;
  return typeof deviceMemory === "number" && deviceMemory > 0 ? deviceMemory * GIB : void 0;
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/memory/estimates.js
var DEFAULT_THROUGHPUT = {
  // A RAM hit is not a reload; callers should not ask. Kept non-zero for safety.
  ram: 1e6,
  // VRAM copy over the optional GPU path. Hint only.
  vram: 2e5,
  // IndexedDB read on a typical laptop-class disk.
  storage: 5e4,
  // Re-download. Slow, and the reason cost-aware keeps hot weights.
  network: 2e3
};
function estimateReloadCostMs(input) {
  const bytes = Number.isFinite(input.bytes) && input.bytes > 0 ? input.bytes : 0;
  const throughput = input.bytesPerMs && input.bytesPerMs > 0 ? input.bytesPerMs : DEFAULT_THROUGHPUT[input.from];
  return bytes / throughput;
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/shared/clock.js
function now() {
  const g = globalThis;
  return g.performance?.now?.() ?? Date.now();
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/memory/envProbe.js
var DEFAULT_RAM_BYTES = 4 * 1024 * 1024 * 1024;
function probeRamBytes() {
  return probeDeviceMemoryBytes() ?? DEFAULT_RAM_BYTES;
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/memory/eviction.js
function byNumber(pick, direction2) {
  const sign = direction2 === "asc" ? 1 : -1;
  return (a, b) => {
    const delta = pick(a) - pick(b);
    if (delta !== 0)
      return sign * delta;
    return a.admittedAt - b.admittedAt;
  };
}
function retentionValue(entry) {
  const footprint = entry.bytes > 0 ? entry.bytes : 1;
  const expectedReload = clamp01(entry.reuseProbability) * Math.max(0, entry.reloadCostMs);
  return expectedReload / footprint;
}
function costAwareStrategy() {
  return {
    name: "cost-aware",
    rank(candidates) {
      return [...candidates].sort(byNumber((e) => retentionValue(e), "asc"));
    }
  };
}
function clamp01(value) {
  if (Number.isNaN(value))
    return 0;
  return Math.min(1, Math.max(0, value));
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/memory/pressure.js
function detectPressure(input) {
  const budget = input.byteBudget > 0 ? input.byteBudget : 1;
  const used = Math.max(0, input.usedBytes);
  const utilization = used / budget;
  const threshold = clamp012(input.pressureThreshold);
  const watermark = Math.min(threshold, clamp012(input.targetWatermark));
  const pressured = utilization >= threshold;
  const targetBytes = watermark * budget;
  const reclaimBytes = pressured ? Math.max(0, Math.ceil(used - targetBytes)) : 0;
  return {
    utilization,
    pressured,
    reclaimBytes,
    vramBytes: Math.max(0, input.vramBytes),
    ramBytes: Math.max(0, input.ramBytes),
    storageQuotaBytes: Math.max(0, input.storageQuotaBytes)
  };
}
function planWorkspace(input) {
  const minBytes = Math.max(0, input.bounds.minBytes);
  const maxBytes = Math.max(minBytes, input.bounds.maxBytes);
  const current = clamp(input.currentBytes, minBytes, maxBytes);
  const residual = Math.max(0, input.byteBudget - Math.max(0, input.usedBytes));
  const ceiling = Math.min(maxBytes, current + residual);
  if (input.pressure.pressured) {
    const shrinkBy = Math.max(input.pressure.reclaimBytes, Math.ceil((current - minBytes) / 2));
    const next = clamp(current - shrinkBy, minBytes, ceiling);
    return {
      nextBytes: next,
      deltaBytes: next - current,
      reason: next < current ? `pressure at ${(input.pressure.utilization * 100).toFixed(1)}% \u2014 shrink workspace by ${current - next} bytes` : "pressure but workspace already at its floor"
    };
  }
  if (input.onHit && current < ceiling) {
    const step = input.growStepBytes && input.growStepBytes > 0 ? input.growStepBytes : Math.max(1, Math.ceil((maxBytes - minBytes) / 8));
    const next = clamp(current + step, minBytes, ceiling);
    return {
      nextBytes: next,
      deltaBytes: next - current,
      reason: next > current ? `headroom \u2014 grow workspace by ${next - current} bytes` : "workspace already at its ceiling"
    };
  }
  return { nextBytes: current, deltaBytes: 0, reason: "workspace held" };
}
function clamp(value, min, max) {
  if (Number.isNaN(value))
    return min;
  return Math.min(max, Math.max(min, value));
}
function clamp012(value) {
  if (Number.isNaN(value))
    return 0;
  return Math.min(1, Math.max(0, value));
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/memory/spillTier.js
function resolveStorageBudget(configured2, storageQuotaBytes, byteBudget) {
  if (configured2 === 0)
    return 0;
  if (typeof configured2 === "number" && Number.isFinite(configured2) && configured2 > 0)
    return configured2;
  if (storageQuotaBytes > 0)
    return storageQuotaBytes;
  return byteBudget * 4;
}
function createSpillTier(options) {
  const { storage, budgetBytes } = options;
  const enabled = storage !== void 0 && budgetBytes > 0;
  const index = /* @__PURE__ */ new Map();
  let committed = 0;
  let reserved = 0;
  function setIndex(record) {
    removeIndex(record.id);
    index.set(record.id, record);
    committed += record.bytes;
  }
  function removeIndex(id) {
    const record = index.get(id);
    if (!record)
      return void 0;
    index.delete(id);
    committed -= record.bytes;
    return record;
  }
  async function deleteQuietly(record) {
    try {
      await storage?.delete(record);
    } catch {
    }
  }
  function fits(incomingBytes) {
    return committed + reserved + incomingBytes <= budgetBytes;
  }
  async function trim(incomingBytes) {
    const ordered = [...index.values()].sort((a, b) => a.spilledAt - b.spilledAt || a.id.localeCompare(b.id));
    for (const oldest of ordered) {
      if (fits(incomingBytes))
        return;
      if (index.get(oldest.id) !== oldest)
        continue;
      removeIndex(oldest.id);
      await deleteQuietly(oldest);
    }
  }
  return {
    enabled,
    get: (id) => index.get(id),
    has: (id) => index.has(id),
    get count() {
      return index.size;
    },
    bytes: () => committed,
    async retain(entry, reason) {
      if (!enabled || !storage)
        return false;
      if (!(entry.bytes >= 0) || entry.bytes > budgetBytes)
        return false;
      const previous = removeIndex(entry.id);
      if (previous)
        await deleteQuietly(previous);
      await trim(entry.bytes);
      if (!fits(entry.bytes))
        return false;
      reserved += entry.bytes;
      try {
        const stored = await storage.spill({ ...entry, tier: "storage" }, options.now());
        setIndex(stored);
        options.onSpill(entry, reason);
        return true;
      } catch {
        return false;
      } finally {
        reserved -= entry.bytes;
      }
    },
    async forget(id) {
      const record = removeIndex(id);
      if (!record)
        return false;
      await deleteQuietly(record);
      return true;
    },
    async reload(id) {
      const record = index.get(id);
      if (!record || !storage)
        return void 0;
      let restored;
      try {
        restored = await storage.reload(record);
      } catch {
        restored = void 0;
      }
      if (!restored) {
        if (index.get(id) === record)
          removeIndex(id);
        return void 0;
      }
      return { ...restored, id, tier: "ram", bytes: record.bytes };
    }
  };
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/memory/victims.js
function quotaApplies(quota, entry) {
  if (quota.group !== entry.group)
    return false;
  if (quota.component !== void 0 && quota.component !== entry.component)
    return false;
  return true;
}
function selectVictims(query) {
  const { incoming, except } = query;
  const applicable = query.quotas.filter((quota) => quotaApplies(quota, incoming));
  const quotaUsed = applicable.map(() => 0);
  let total = 0;
  const evictable = [];
  for (const entry of query.residents) {
    if (except.has(entry.id))
      continue;
    total += entry.bytes;
    for (let i = 0; i < applicable.length; i++) {
      if (quotaApplies(applicable[i], entry))
        quotaUsed[i] = (quotaUsed[i] ?? 0) + entry.bytes;
    }
    if (!entry.pinned)
      evictable.push(entry);
  }
  const fits = () => {
    if (total + query.workspaceBytes + incoming.bytes > query.byteBudget)
      return false;
    for (let i = 0; i < applicable.length; i++) {
      if ((quotaUsed[i] ?? 0) + incoming.bytes > applicable[i].byteCap)
        return false;
    }
    return true;
  };
  if (fits())
    return [];
  const ranked = query.strategy.rank(evictable);
  const sameGroup = ranked.filter((entry) => entry.group === incoming.group);
  const rest = ranked.filter((entry) => entry.group !== incoming.group);
  const chosen = [];
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of [...sameGroup, ...rest]) {
    if (seen.has(candidate.id))
      continue;
    seen.add(candidate.id);
    total -= candidate.bytes;
    for (let i = 0; i < applicable.length; i++) {
      if (quotaApplies(applicable[i], candidate))
        quotaUsed[i] = (quotaUsed[i] ?? 0) - candidate.bytes;
    }
    chosen.push(candidate);
    if (fits())
      return chosen.map((entry) => ({ ...entry }));
  }
  return void 0;
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/memory/workspace.js
function createWorkspaceController(options) {
  const { bounds, byteBudget } = options;
  const active = bounds.maxBytes > 0 || bounds.minBytes > 0;
  function clamp3(bytes) {
    if (!active)
      return 0;
    const cap = Math.min(bounds.maxBytes, byteBudget);
    const floor = Math.min(bounds.minBytes, cap);
    const value = Number.isFinite(bytes) ? bytes : floor;
    return Math.min(cap, Math.max(floor, value));
  }
  let current = clamp3(options.initialBytes ?? bounds.minBytes);
  return {
    bytes: () => current,
    apply({ onHit, pressure, residentBytes }) {
      if (!active)
        return void 0;
      const decision = planWorkspace({
        currentBytes: current,
        bounds,
        pressure,
        byteBudget,
        usedBytes: residentBytes + current,
        onHit
      });
      if (decision.deltaBytes === 0)
        return void 0;
      const next = clamp3(decision.nextBytes);
      if (next === current)
        return void 0;
      if (residentBytes + next > byteBudget)
        return void 0;
      const delta = next - current;
      current = next;
      return {
        kind: delta > 0 ? "workspace-grow" : "workspace-shrink",
        bytes: Math.abs(delta),
        reason: decision.reason
      };
    }
  };
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/memory/manager.js
var DEFAULT_PRESSURE = 0.85;
var DEFAULT_WATERMARK = 0.7;
var DEFAULT_EVENT_LIMIT = 256;
function createMemoryManager(options) {
  if (!(options.byteBudget > 0) || !Number.isFinite(options.byteBudget)) {
    throw new Error("createMemoryManager: byteBudget must be a finite number > 0");
  }
  const byteBudget = options.byteBudget;
  const strategy = options.strategy ?? costAwareStrategy();
  const pressureThreshold = options.pressureThreshold ?? DEFAULT_PRESSURE;
  const targetWatermark = Math.min(pressureThreshold, options.targetWatermark ?? DEFAULT_WATERMARK);
  const eventLogLimit = options.eventLogLimit ?? DEFAULT_EVENT_LIMIT;
  const now2 = options.now ?? (() => Date.now());
  const ramBytes = options.ramBytes ?? probeRamBytes();
  const vramBytes = Math.max(0, options.vramBudgetBytes ?? 0);
  const storageQuotaBytes = options.storageQuotaBytes ?? 0;
  const quotas = options.quotas ?? [];
  const residents = /* @__PURE__ */ new Map();
  const log = [];
  let residentTotal = 0;
  let seq = 0;
  let hits = 0;
  let misses = 0;
  let admissions = 0;
  let evictions = 0;
  let spills = 0;
  let reloads = 0;
  const spill = createSpillTier({
    storage: options.storage,
    budgetBytes: resolveStorageBudget(options.storageBudgetBytes, storageQuotaBytes, byteBudget),
    now: now2,
    onSpill(entry, reason) {
      spills += 1;
      record({ kind: "spill", id: entry.id, bytes: entry.bytes, reason });
    }
  });
  const workspace = createWorkspaceController({
    bounds: {
      minBytes: Math.max(0, options.workspace?.minBytes ?? 0),
      maxBytes: Math.max(0, options.workspace?.maxBytes ?? 0)
    },
    byteBudget,
    initialBytes: options.workspace?.initialBytes
  });
  function putResident(entry) {
    const previous = residents.get(entry.id);
    if (previous)
      residentTotal -= previous.bytes;
    residents.set(entry.id, entry);
    residentTotal += entry.bytes;
  }
  function removeResident(id) {
    const previous = residents.get(id);
    if (!previous)
      return;
    residents.delete(id);
    residentTotal -= previous.bytes;
  }
  function usedBytes() {
    return residentTotal + workspace.bytes();
  }
  function record(event) {
    log.push({ ...event, at: now2() });
    if (log.length > eventLogLimit)
      log.splice(0, log.length - eventLogLimit);
  }
  function pressureNow() {
    return detectPressure({
      usedBytes: usedBytes(),
      byteBudget,
      pressureThreshold,
      targetWatermark,
      ramBytes,
      vramBytes,
      storageQuotaBytes
    });
  }
  function applyWorkspace(onHit) {
    const change = workspace.apply({ onHit, pressure: pressureNow(), residentBytes: residentTotal });
    if (change)
      record(change);
  }
  function drop(entry, reason) {
    removeResident(entry.id);
    evictions += 1;
    strategy.observe?.({ kind: "evict", entry });
    record({ kind: "evict", id: entry.id, bytes: entry.bytes, reason });
  }
  function placeTier(entry) {
    if (entry.tier === "vram" && vramBytes > 0)
      return "vram";
    return "ram";
  }
  function rate() {
    const total = hits + misses;
    return total === 0 ? 0 : hits / total;
  }
  function notAdmitted(spilledOk, spilledReason, rejectedReason) {
    return {
      admitted: false,
      spilled: spilledOk,
      replaced: false,
      evicted: [],
      reason: spilledOk ? spilledReason : rejectedReason
    };
  }
  const manager = {
    async admit(entry, admitOptions) {
      if (!(entry.bytes >= 0) || !Number.isFinite(entry.bytes)) {
        return { admitted: false, spilled: false, replaced: false, evicted: [], reason: "invalid footprint" };
      }
      const wantSpill = admitOptions?.spill !== false && spill.enabled;
      if (entry.bytes > byteBudget) {
        const spilledOk = wantSpill && await spill.retain(entry, "entry exceeds the hard byte budget");
        return notAdmitted(spilledOk, "spilled: entry larger than byte budget", "rejected: entry larger than byte budget");
      }
      const existing = residents.get(entry.id);
      const except = /* @__PURE__ */ new Set();
      if (existing)
        except.add(existing.id);
      const victims = selectVictims({
        incoming: entry,
        residents: residents.values(),
        except,
        strategy,
        quotas,
        byteBudget,
        workspaceBytes: workspace.bytes()
      });
      if (!victims) {
        const spilledOk = wantSpill && await spill.retain(entry, "pinned residents fill the budget");
        return notAdmitted(spilledOk, "spilled: budget held by pinned residents", "rejected: budget held by pinned residents");
      }
      const spilledVictims = [];
      for (const victim of victims) {
        const live = residents.get(victim.id);
        if (!live)
          continue;
        drop(live, `make room for ${entry.id}`);
        spilledVictims.push(live);
      }
      if (existing)
        removeResident(existing.id);
      const tick = ++seq;
      const tracked = {
        ...entry,
        tier: placeTier(entry),
        pinned: admitOptions?.pin === true || entry.pinned === true,
        admittedAt: existing?.admittedAt ?? tick,
        lastUsedAt: tick,
        hits: 0,
        arcList: "t1"
      };
      putResident(tracked);
      const forgettingPriorSpill = spill.forget(entry.id);
      admissions += 1;
      strategy.observe?.({ kind: "admit", entry: tracked });
      record({
        kind: "admit",
        id: entry.id,
        bytes: entry.bytes,
        reason: victims.length > 0 ? `admitted after evicting ${victims.length}` : "admitted within budget"
      });
      await forgettingPriorSpill;
      if (wantSpill) {
        for (const live of spilledVictims) {
          await spill.retain(live, `evicted to make room for ${entry.id}`);
        }
      }
      const reading = pressureNow();
      if (reading.pressured) {
        record({
          kind: "pressure",
          bytes: reading.reclaimBytes,
          reason: `utilization ${(reading.utilization * 100).toFixed(1)}%`
        });
        applyWorkspace(false);
      }
      return {
        admitted: true,
        spilled: false,
        replaced: existing !== void 0,
        evicted: victims,
        reason: victims.length > 0 ? `evicted ${victims.length} to fit` : "fit within budget"
      };
    },
    get(id) {
      const entry = residents.get(id);
      if (!entry) {
        misses += 1;
        const spilled = spill.get(id);
        const ghost = {
          id,
          group: spilled?.group ?? "",
          component: spilled?.component,
          bytes: spilled?.bytes ?? 0,
          reloadCostMs: spilled?.reloadCostMs ?? 0,
          reuseProbability: spilled?.reuseProbability ?? 0,
          tier: "storage",
          admittedAt: 0,
          lastUsedAt: 0,
          hits: 0
        };
        strategy.observe?.({ kind: "miss", entry: ghost });
        record({ kind: "miss", id, reason: spilled ? "miss: spilled to storage" : "miss: not resident" });
        return { hit: false };
      }
      const tick = ++seq;
      const touched = {
        ...entry,
        lastUsedAt: tick,
        hits: entry.hits + 1,
        arcList: entry.hits + 1 > 1 ? "t2" : "t1"
      };
      putResident(touched);
      hits += 1;
      strategy.observe?.({ kind: "hit", entry: touched });
      record({ kind: "hit", id, reason: `hit #${touched.hits}` });
      applyWorkspace(true);
      return { hit: true, entry: snapshot(touched) };
    },
    hitRate() {
      return rate();
    },
    async reload(id) {
      const already = residents.get(id);
      if (already)
        return { hit: true, entry: snapshot(already) };
      const restored = spill.has(id) ? await spill.reload(id) : void 0;
      if (!restored) {
        misses += 1;
        return { hit: false };
      }
      const result = await manager.admit(restored, { spill: false });
      if (!result.admitted) {
        misses += 1;
        return { hit: false };
      }
      reloads += 1;
      record({ kind: "reload", id, reason: "reloaded from browser storage" });
      const entry = residents.get(id);
      return entry ? { hit: true, entry: snapshot(entry) } : { hit: false };
    },
    pin(id) {
      const entry = residents.get(id);
      if (!entry)
        return false;
      putResident({ ...entry, pinned: true });
      record({ kind: "pin", id, reason: "pinned" });
      return true;
    },
    unpin(id) {
      const entry = residents.get(id);
      if (!entry)
        return false;
      putResident({ ...entry, pinned: false });
      record({ kind: "unpin", id, reason: "unpinned" });
      return true;
    },
    async release(id) {
      const entry = residents.get(id);
      if (entry) {
        drop(entry, "released");
        return true;
      }
      return spill.forget(id);
    },
    pressure() {
      return pressureNow();
    },
    stats() {
      return {
        hits,
        misses,
        admissions,
        evictions,
        spills,
        reloads,
        usedBytes: usedBytes(),
        byteBudget,
        workspaceBytes: workspace.bytes(),
        residentCount: residents.size,
        spilledCount: spill.count,
        spilledBytes: spill.bytes(),
        hitRate: rate()
      };
    },
    events() {
      return log;
    },
    residentIds() {
      return [...residents.keys()];
    },
    peek(id) {
      const entry = residents.get(id);
      return entry ? snapshot(entry) : void 0;
    }
  };
  return manager;
}
function snapshot(entry) {
  return { ...entry };
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/prefetch/admission.js
function createAdmissionGate(options) {
  const { ledger } = options;
  const counters = ledger.counters;
  function refuse(target, strategy, outcome, skipReason) {
    if (outcome === "throttled")
      counters.throttled += 1;
    else
      counters.skipped += 1;
    ledger.record({ id: target.id, strategy, outcome, durationMs: 0, skipReason });
    return { admit: false, result: outcome === "duplicate" ? "duplicate" : "throttled", skipReason };
  }
  return function decideAdmission(target, strategy) {
    counters.attempts += 1;
    if (!options.isEnabled())
      return refuse(target, strategy, "skipped", "disabled");
    if (options.isPressure()) {
      options.relievePressure();
      return refuse(target, strategy, "throttled", "pressure");
    }
    if (!options.isKnown(target.id))
      return refuse(target, strategy, "skipped", "unknown-target");
    if (options.isResident(target.id))
      return refuse(target, strategy, "duplicate", "already-loaded");
    if (options.isLoading(target.id))
      return refuse(target, strategy, "duplicate", "already-loading");
    if (options.speculativeCount() >= options.maxConcurrent) {
      return refuse(target, strategy, "skipped", "concurrency-limit");
    }
    return { admit: true };
  };
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/prefetch/loadRegistry.js
function abortErrorOf(signal) {
  const reason = signal.reason;
  if (reason instanceof Error)
    return reason;
  if (typeof DOMException === "function")
    return new DOMException("aborted", "AbortError");
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}
function isAbortError(error) {
  return typeof error === "object" && error !== null && error.name === "AbortError";
}
function createLoadRegistry(options) {
  const inFlight = /* @__PURE__ */ new Map();
  function settle(rec) {
    rec.completed = true;
    rec.loadMs = Math.max(0, options.now() - rec.startedAt);
    if (inFlight.get(rec.id) === rec)
      inFlight.delete(rec.id);
  }
  function start(target, startOptions) {
    const controller = new AbortController();
    const startedAt = options.now();
    const signal = startOptions.signal;
    const forward = () => controller.abort();
    let promise;
    if (signal?.aborted) {
      controller.abort();
      promise = Promise.reject(abortErrorOf(signal));
    } else {
      signal?.addEventListener("abort", forward, { once: true });
      promise = (async () => options.loader(target, controller.signal))();
    }
    const rec = {
      id: target.id,
      controller,
      promise,
      bytes: target.bytes,
      strategy: startOptions.strategy,
      speculative: startOptions.speculative,
      joined: false,
      completed: false,
      loadMs: 0,
      startedAt
    };
    inFlight.set(target.id, rec);
    promise.then((value) => {
      signal?.removeEventListener("abort", forward);
      settle(rec);
      options.onLoaded(rec, value);
    }, (error) => {
      signal?.removeEventListener("abort", forward);
      settle(rec);
      options.onFailed(rec, rec.controller.signal.aborted || isAbortError(error));
    });
    return rec;
  }
  return {
    get: (id) => inFlight.get(id),
    has: (id) => inFlight.has(id),
    get size() {
      return inFlight.size;
    },
    start,
    speculativeCount() {
      let count = 0;
      for (const rec of inFlight.values())
        if (rec.speculative)
          count += 1;
      return count;
    },
    dropUnjoined() {
      let dropped = 0;
      for (const rec of [...inFlight.values()]) {
        if (!rec.speculative || rec.joined)
          continue;
        rec.controller.abort();
        dropped += 1;
      }
      return dropped;
    },
    abortSpeculative() {
      for (const rec of [...inFlight.values()]) {
        if (rec.speculative)
          rec.controller.abort();
      }
    },
    async whenIdle() {
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight.values()].map((rec) => rec.promise));
      }
    }
  };
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/prefetch/predictor.js
function targetFor(index, id) {
  const known = index.get(id);
  if (known)
    return known;
  return { id, bytes: 0 };
}
function predictFromGraph(rootId, graph, index) {
  if (!graph || graph.edges.length === 0)
    return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set([rootId]);
  const confidence = /* @__PURE__ */ new Map([[rootId, 1]]);
  let frontier = [rootId];
  for (let depth = 0; depth < 8 && frontier.length > 0; depth += 1) {
    const next = [];
    for (const from of frontier) {
      const fromConfidence = confidence.get(from) ?? 1;
      for (const edge of graph.edges) {
        if (edge.from !== from)
          continue;
        if (seen.has(edge.to))
          continue;
        const weight = clamp013(edge.weight ?? 1);
        const conf = clamp013(fromConfidence * weight);
        seen.add(edge.to);
        confidence.set(edge.to, conf);
        next.push(edge.to);
        out.push({
          target: targetFor(index, edge.to),
          strategy: "static-graph",
          confidence: conf,
          reason: `static graph: ${from} -> ${edge.to} (depth ${depth + 1})`
        });
      }
    }
    frontier = next;
  }
  return out;
}
function predictFromHistory(history, index) {
  if (history.length < 2)
    return [];
  const last = history[history.length - 1];
  if (last === void 0)
    return [];
  const counts = /* @__PURE__ */ new Map();
  let total = 0;
  for (let i = 1; i < history.length; i += 1) {
    const from = history[i - 1];
    const to = history[i];
    if (from !== last || to === void 0)
      continue;
    counts.set(to, (counts.get(to) ?? 0) + 1);
    total += 1;
  }
  if (total === 0)
    return [];
  const out = [];
  for (const [id, count] of counts) {
    if (id === last)
      continue;
    const probability = count / total;
    const confidence = clamp013(probability * (1 - 1 / (total + 1)));
    out.push({
      target: targetFor(index, id),
      strategy: "history",
      confidence,
      reason: `history: ${count}/${total} accesses followed ${last} with ${id}`
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}
function predictFromContext(context, index) {
  const out = [];
  const profile = context.profile;
  for (const id of profile?.expects ?? []) {
    if (id === context.target)
      continue;
    out.push({
      target: targetFor(index, id),
      strategy: "context",
      confidence: 1,
      reason: `context: workload explicitly expects ${id}`
    });
  }
  const stageExpectation = {
    prefill: "stage:decode",
    decode: "stage:postprocess",
    postprocess: void 0
  };
  const nextStage = profile?.stage ? stageExpectation[profile.stage] : void 0;
  if (nextStage && index.has(nextStage)) {
    out.push({
      target: targetFor(index, nextStage),
      strategy: "context",
      confidence: 0.6,
      reason: `context: stage ${profile?.stage} implies ${nextStage}`
    });
  }
  const labels = profile?.labels ?? [];
  if (labels.length > 0) {
    for (const candidate of index.values()) {
      const candidateLabels = candidate.meta?.labels;
      if (!Array.isArray(candidateLabels))
        continue;
      const overlap = labels.filter((l) => candidateLabels.includes(l));
      if (overlap.length === 0)
        continue;
      out.push({
        target: candidate,
        strategy: "context",
        confidence: clamp013(0.3 + 0.2 * overlap.length),
        reason: `context: shares workload label(s) ${overlap.join(", ")}`
      });
    }
  }
  return out;
}
function mergePredictions(groups, minConfidence) {
  const best = /* @__PURE__ */ new Map();
  for (const group of groups) {
    for (const prediction of group) {
      if (prediction.confidence < minConfidence)
        continue;
      const existing = best.get(prediction.target.id);
      if (!existing || prediction.confidence > existing.confidence) {
        best.set(prediction.target.id, prediction);
      }
    }
  }
  return [...best.values()].sort((a, b) => b.confidence - a.confidence);
}
function clamp013(value) {
  if (!Number.isFinite(value))
    return 0;
  return Math.min(1, Math.max(0, value));
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/prefetch/residentStore.js
function isUnclaimedPrefetch(entry) {
  return entry.source === "prefetch" && !entry.claimed;
}
function createResidentStore(options) {
  const entries = /* @__PURE__ */ new Map();
  const maxEntries = Math.max(1, options.maxEntries);
  let used = 0;
  function over() {
    return used > options.budgetBytes || entries.size > maxEntries;
  }
  function remove(id) {
    const entry = entries.get(id);
    if (!entry)
      return false;
    entries.delete(id);
    used -= entry.bytes;
    return true;
  }
  function enforce() {
    if (!over())
      return;
    for (const [id, entry] of [...entries]) {
      if (!over())
        return;
      if (isUnclaimedPrefetch(entry))
        remove(id);
    }
    for (const id of [...entries.keys()]) {
      if (!over())
        return;
      remove(id);
    }
  }
  return {
    get(id) {
      const entry = entries.get(id);
      if (!entry)
        return void 0;
      entries.delete(id);
      entries.set(id, entry);
      return entry;
    },
    peek: (id) => entries.get(id),
    has: (id) => entries.has(id),
    set(id, value) {
      remove(id);
      if (!(Number.isFinite(value.bytes) && value.bytes > 0))
        value.bytes = 0;
      entries.set(id, value);
      used += value.bytes;
      enforce();
    },
    delete: remove,
    markClaimed(id) {
      const entry = entries.get(id);
      if (entry)
        entry.claimed = true;
    },
    releaseUnclaimed() {
      let released = 0;
      for (const [id, entry] of [...entries]) {
        if (!isUnclaimedPrefetch(entry))
          continue;
        remove(id);
        released += 1;
      }
      return released;
    },
    enforce,
    bytes: () => used,
    ids: () => [...entries.keys()]
  };
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/prefetch/selfTuner.js
function createSelfTuner(options) {
  const maxTracked = Math.max(1, options.maxTrackedLoads);
  let outstanding = [];
  let retiredWasteMs = 0;
  let avoidedMs = 0;
  let measured = 0;
  let negativeStreak = 0;
  let disabledAt = 0;
  let selfTunedOff = false;
  let trips = 0;
  function wasteMs() {
    let total = retiredWasteMs;
    for (const load of outstanding)
      total += load.loadMs;
    return total;
  }
  return {
    noteSpeculativeLoad(id, loadMs) {
      outstanding.push({ id, loadMs });
      while (outstanding.length > maxTracked) {
        const oldest = outstanding.shift();
        if (oldest)
          retiredWasteMs += oldest.loadMs;
      }
    },
    markClaimed(id) {
      if (outstanding.some((load) => load.id === id)) {
        outstanding = outstanding.filter((load) => load.id !== id);
      }
    },
    creditAvoidedWait(loadMs, actualWaitMs) {
      avoidedMs += Math.max(0, loadMs - actualWaitMs);
    },
    evaluate(enabled) {
      measured += 1;
      if (!enabled && selfTunedOff && options.retryAfterMs > 0 && options.now() - disabledAt >= options.retryAfterMs) {
        selfTunedOff = false;
        negativeStreak = 0;
        avoidedMs = 0;
        outstanding = [];
        retiredWasteMs = 0;
        return "reenable";
      }
      if (measured < options.minSamples)
        return "none";
      negativeStreak = wasteMs() > avoidedMs ? negativeStreak + 1 : 0;
      if (negativeStreak >= options.disableAfter && !selfTunedOff) {
        selfTunedOff = true;
        trips += 1;
        disabledAt = options.now();
        return "disable";
      }
      return "none";
    },
    get selfTunedOff() {
      return selfTunedOff;
    },
    get trips() {
      return trips;
    }
  };
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/prefetch/stats.js
function createPrefetchLedger(options) {
  const counters = {
    hits: 0,
    misses: 0,
    prefetchHits: 0,
    attempts: 0,
    completed: 0,
    throttled: 0,
    cancelled: 0,
    failed: 0,
    skipped: 0,
    totalWaitMs: 0,
    waitSamples: 0,
    totalLoadMs: 0,
    loadSamples: 0,
    peakConcurrent: 0
  };
  const log = [];
  return {
    counters,
    record(event) {
      const full = { ...event, at: options.now() };
      log.push(full);
      if (log.length > options.eventLogLimit)
        log.splice(0, log.length - options.eventLogLimit);
      options.onEvent?.(full);
    },
    events: () => log,
    noteWait(waitMs) {
      counters.totalWaitMs += waitMs;
      counters.waitSamples += 1;
    },
    noteLoad(loadMs) {
      counters.totalLoadMs += loadMs;
      counters.loadSamples += 1;
    },
    noteConcurrency(count) {
      if (count > counters.peakConcurrent)
        counters.peakConcurrent = count;
    },
    snapshot(live) {
      const total = counters.hits + counters.misses;
      return {
        hits: counters.hits,
        misses: counters.misses,
        prefetchHits: counters.prefetchHits,
        attempts: counters.attempts,
        completed: counters.completed,
        throttled: counters.throttled,
        cancelled: counters.cancelled,
        failed: counters.failed,
        skipped: counters.skipped,
        hitRate: total === 0 ? 0 : counters.hits / total,
        totalWaitMs: counters.totalWaitMs,
        waitMs: counters.waitSamples === 0 ? 0 : counters.totalWaitMs / counters.waitSamples,
        avgLoadMs: counters.loadSamples === 0 ? 0 : counters.totalLoadMs / counters.loadSamples,
        inFlight: live.inFlight,
        maxConcurrent: counters.peakConcurrent,
        residentBytes: live.residentBytes,
        selfTunedOff: live.selfTunedOff,
        selfTuneTrips: live.selfTuneTrips
      };
    }
  };
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/prefetch/targetIndex.js
function createTargetIndex(declared, maxLearned) {
  const index = /* @__PURE__ */ new Map();
  for (const target of declared)
    index.set(target.id, target);
  const learned = /* @__PURE__ */ new Set();
  const cap = Math.max(1, maxLearned);
  return {
    index,
    remember(target) {
      if (index.has(target.id))
        return;
      index.set(target.id, target);
      learned.add(target.id);
      while (learned.size > cap) {
        const oldest = learned.values().next().value;
        if (oldest === void 0)
          break;
        learned.delete(oldest);
        index.delete(oldest);
      }
    }
  };
}

// node_modules/.pnpm/@seanhogg+builderforce-webc_89cc68a886006eb97bba411f7ffd1529/node_modules/@seanhogg/builderforce-webcontainers/dist/prefetch/prefetcher.js
var DEFAULT_MAX_CONCURRENT = 2;
var DEFAULT_MAX_TARGETS_PER_REQUEST = 8;
var DEFAULT_HISTORY_WINDOW = 32;
var DEFAULT_MIN_CONFIDENCE = 0.2;
var DEFAULT_EVENT_LIMIT2 = 128;
var DEFAULT_DISABLE_AFTER = 3;
var DEFAULT_MIN_SAMPLES = 3;
var DEFAULT_MAX_RESIDENT_ENTRIES = 1024;
var DEFAULT_MAX_KNOWN_TARGETS = 1024;
var DEFAULT_MAX_TRACKED_LOADS = 256;
function createPrefetcher(config) {
  const loader = config.loader;
  if (typeof loader !== "function") {
    throw new Error("createPrefetcher: config.loader is required");
  }
  const shouldThrottle = config.shouldThrottle ?? (() => false);
  const maxConcurrent = Math.max(1, config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
  const maxTargetsPerRequest = Math.max(1, config.maxTargetsPerRequest ?? DEFAULT_MAX_TARGETS_PER_REQUEST);
  const historyWindow = Math.max(2, config.historyWindow ?? DEFAULT_HISTORY_WINDOW);
  const minConfidence = config.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const now2 = config.now ?? now;
  const targets = createTargetIndex(config.targets ?? [], config.maxKnownTargets ?? DEFAULT_MAX_KNOWN_TARGETS);
  const index = targets.index;
  const history = [];
  const ledger = createPrefetchLedger({
    now: now2,
    eventLogLimit: Math.max(1, config.eventLogLimit ?? DEFAULT_EVENT_LIMIT2),
    onEvent: config.onEvent
  });
  const counters = ledger.counters;
  const resident = createResidentStore({
    budgetBytes: config.residentBudgetBytes ?? Number.POSITIVE_INFINITY,
    maxEntries: config.maxResidentEntries ?? DEFAULT_MAX_RESIDENT_ENTRIES
  });
  const tuner = createSelfTuner({
    now: now2,
    disableAfter: Math.max(1, config.tuning?.disableAfter ?? DEFAULT_DISABLE_AFTER),
    minSamples: Math.max(1, config.tuning?.minSamples ?? DEFAULT_MIN_SAMPLES),
    retryAfterMs: Math.max(0, config.tuning?.retryAfterMs ?? 0),
    maxTrackedLoads: config.tuning?.maxTrackedLoads ?? DEFAULT_MAX_TRACKED_LOADS
  });
  const loads = createLoadRegistry({
    loader,
    now: now2,
    onLoaded(rec, value) {
      counters.completed += 1;
      ledger.noteLoad(rec.loadMs);
      resident.set(rec.id, {
        value,
        bytes: rec.bytes,
        loadedAt: now2(),
        loadMs: rec.loadMs,
        source: rec.speculative ? "prefetch" : "demand",
        claimed: false
      });
      if (rec.speculative)
        tuner.noteSpeculativeLoad(rec.id, rec.loadMs);
      ledger.record({ id: rec.id, strategy: rec.strategy, outcome: "loaded", durationMs: rec.loadMs });
    },
    onFailed(rec, aborted) {
      if (aborted)
        counters.cancelled += 1;
      else
        counters.failed += 1;
      ledger.record({
        id: rec.id,
        strategy: rec.strategy,
        outcome: aborted ? "cancelled" : "failed",
        durationMs: rec.loadMs
      });
    }
  });
  let enabled = config.enabled !== false;
  function isPressure() {
    try {
      return shouldThrottle() === true;
    } catch {
      return false;
    }
  }
  function relievePressure() {
    loads.dropUnjoined();
    resident.releaseUnclaimed();
  }
  const decideAdmission = createAdmissionGate({
    ledger,
    maxConcurrent,
    isEnabled: () => enabled,
    isPressure,
    relievePressure,
    isKnown: (id) => index.has(id),
    isResident: (id) => resident.has(id),
    isLoading: (id) => loads.has(id),
    speculativeCount: () => loads.speculativeCount()
  });
  function startSpeculative(target, strategy, signal) {
    const rec = loads.start(target, { speculative: true, strategy, signal });
    ledger.noteConcurrency(loads.speculativeCount());
    return rec;
  }
  function evaluateTuner() {
    const action = tuner.evaluate(enabled);
    if (action === "reenable") {
      enabled = true;
      return;
    }
    if (action === "disable") {
      enabled = false;
      relievePressure();
      ledger.record({ id: "*", strategy: "explicit", outcome: "throttled", durationMs: 0, skipReason: "disabled" });
    }
  }
  function markClaimed(id) {
    tuner.markClaimed(id);
    resident.markClaimed(id);
  }
  function pushHistory(id) {
    history.push(id);
    while (history.length > historyWindow)
      history.shift();
  }
  function startPredictions(predictions) {
    const acted = [];
    for (const prediction of predictions) {
      if (acted.length >= maxTargetsPerRequest)
        break;
      const verdict = decideAdmission(prediction.target, prediction.strategy);
      if (verdict.admit)
        startSpeculative(prediction.target, prediction.strategy);
      if (verdict.admit || verdict.result === "duplicate")
        acted.push(prediction);
    }
    return acted;
  }
  function autoPredict(targetId) {
    const predictions = mergePredictions([predictFromGraph(targetId, config.graph, index), predictFromHistory(history, index)], minConfidence);
    return predictions.length === 0 ? [] : startPredictions(predictions);
  }
  function demandLoad(target, signal) {
    return loads.start(target, { speculative: false, strategy: "explicit", signal }).promise;
  }
  async function request(target, options) {
    targets.remember(target);
    const startedAt = now2();
    let hit = false;
    let value;
    let creditEntry;
    const residentEntry = resident.get(target.id);
    const inFlightRecord = loads.get(target.id);
    if (residentEntry) {
      hit = true;
      value = residentEntry.value;
      creditEntry = residentEntry;
      markClaimed(target.id);
    } else if (inFlightRecord) {
      hit = true;
      inFlightRecord.joined = true;
      try {
        value = await inFlightRecord.promise;
        creditEntry = resident.peek(target.id);
        markClaimed(target.id);
      } catch {
        hit = false;
        value = await demandLoad(target, options?.signal);
      }
    } else {
      value = await demandLoad(target, options?.signal);
    }
    const waitMs = Math.max(0, now2() - startedAt);
    if (hit) {
      counters.hits += 1;
      if (creditEntry?.source === "prefetch")
        counters.prefetchHits += 1;
    } else {
      counters.misses += 1;
    }
    ledger.noteWait(waitMs);
    if (creditEntry?.source === "prefetch")
      tuner.creditAvoidedWait(creditEntry.loadMs, waitMs);
    pushHistory(target.id);
    evaluateTuner();
    const predicted = autoPredict(target.id);
    return { hit, value, waitMs, predicted };
  }
  function predict(context, options) {
    const predictions = mergePredictions([
      predictFromGraph(context.target, config.graph, index),
      predictFromHistory(history, index),
      predictFromContext(context, index)
    ], minConfidence);
    if (predictions.length === 0)
      return [];
    const signal = options?.signal;
    if (signal?.aborted)
      return [];
    const acted = startPredictions(predictions);
    if (signal) {
      const started = [];
      for (const prediction of acted) {
        const rec = loads.get(prediction.target.id);
        if (rec && rec.speculative)
          started.push(rec);
      }
      if (started.length > 0) {
        const forward = () => {
          for (const rec of started)
            rec.controller.abort();
        };
        signal.addEventListener("abort", forward, { once: true });
        void Promise.allSettled(started.map((rec) => rec.promise)).then(() => {
          signal.removeEventListener("abort", forward);
        });
      }
    }
    return acted;
  }
  function prefetch(target, options) {
    targets.remember(target);
    const strategy = options?.strategy ?? "explicit";
    const verdict = decideAdmission(target, strategy);
    if (!verdict.admit)
      return Promise.resolve(verdict.result);
    const rec = startSpeculative(target, strategy, options?.signal);
    return rec.promise.then(() => "loaded", () => rec.controller.signal.aborted ? "cancelled" : "failed");
  }
  function cancelAll() {
    loads.abortSpeculative();
    resident.releaseUnclaimed();
  }
  function cancel(targetId) {
    const rec = loads.get(targetId);
    if (rec && rec.speculative)
      rec.controller.abort();
    const entry = resident.peek(targetId);
    if (entry && entry.source === "prefetch" && !entry.claimed)
      resident.delete(targetId);
  }
  function stats() {
    return ledger.snapshot({
      inFlight: loads.size,
      residentBytes: resident.bytes(),
      selfTunedOff: tuner.selfTunedOff,
      selfTuneTrips: tuner.trips
    });
  }
  return {
    request,
    requestById(id, options) {
      const target = index.get(id);
      if (!target)
        return Promise.reject(new Error(`unknown prefetch target: ${id} (use request(target))`));
      return request(target, options);
    },
    predict,
    prefetch,
    cancelAll,
    cancel,
    release: (targetId) => resident.delete(targetId),
    stats,
    hitRate: () => stats().hitRate,
    waitMs: () => stats().waitMs,
    events: () => ledger.events(),
    residentIds: () => resident.ids(),
    isEnabled: () => enabled,
    setEnabled(next) {
      enabled = next;
      if (!enabled)
        cancelAll();
    },
    whenIdle: () => loads.whenIdle()
  };
}

// src/engine/residency/weight-store.ts
var WEIGHT_DB = {
  dbName: "builderforce-studio-weights",
  storeName: "weights",
  dbVersion: 1
};
function createWeightStore(indexedDB) {
  const factory = indexedDB ?? globalThis.indexedDB;
  const cache = createModelCache({ ...WEIGHT_DB, indexedDB: factory, valueFormat: "raw" });
  return {
    async read(key) {
      try {
        const entry = await cache.get(key);
        return entry?.bytes ?? null;
      } catch {
        return null;
      }
    },
    async has(key) {
      try {
        return await cache.has(key);
      } catch {
        return false;
      }
    },
    async write(key, bytes) {
      try {
        await cache.put(key, { bytes, size: bytes.byteLength });
        return await cache.has(key);
      } catch {
        return false;
      }
    },
    canPersist: () => factory !== void 0
  };
}
var shared = null;
function weightStore() {
  shared ??= createWeightStore();
  return shared;
}

// src/engine/weight-cache.ts
var DEFAULT_R2_BASE = "https://api.builderforce.ai/api/studio/weights";
var HF_BASE = "https://huggingface.co";
var DEFAULT_WEIGHT_SOURCES = ["r2-proxy", "huggingface-cdn"];
function deriveR2Base(baseUrl) {
  if (!baseUrl) return void 0;
  return `${baseUrl.replace(/\/$/, "")}/api/studio/weights`;
}
async function getOrFetchWeight(opts) {
  const store = weightStore();
  const cached = await store.read(opts.cacheKey);
  if (cached) {
    opts.onProgress?.(cached.byteLength, cached.byteLength);
    return cached;
  }
  const buffer = await fetchFromAnySource(opts);
  if (!await store.write(opts.cacheKey, buffer)) opts.onPersistFailed?.();
  return buffer;
}
async function fetchFromAnySource(opts) {
  const errors = [];
  for (const source of opts.sources) {
    try {
      return await fetchFromSource(source, opts);
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }
  const detail = errors.map((e) => e.message).join(" | ");
  throw new Error(`All weight sources failed for ${opts.cacheKey}: ${detail}`);
}
async function fetchFromSource(source, opts) {
  const { url, headers } = resolveSource(source, opts);
  const res = await fetch(url, { headers, signal: opts.signal });
  if (!res.ok || !res.body) {
    throw new Error(`${source} ${url} \u2192 HTTP ${res.status}`);
  }
  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : null;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    opts.onProgress?.(received, total);
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buf.buffer;
}
function resolveSource(source, opts) {
  if (source === "r2-proxy") {
    const base = opts.r2Base ?? DEFAULT_R2_BASE;
    return {
      url: `${base}/${opts.cacheKey}`,
      headers: { Authorization: `Bearer ${opts.apiKey}` }
    };
  }
  return {
    url: `${HF_BASE}/${opts.hfRepo}/resolve/main/${opts.hfPath}`,
    headers: {}
  };
}

// src/engine/offline/tokenizer-store.ts
import { CLIPTokenizer } from "@huggingface/transformers";
var TOKENIZER_FILES = ["tokenizer.json", "tokenizer_config.json"];
function tokenizerCacheKey(repo, file) {
  return `tokenizer/${repo}/${file}`;
}
async function isTokenizerStored(repo) {
  const store = weightStore();
  const have = await Promise.all(TOKENIZER_FILES.map((f) => store.has(tokenizerCacheKey(repo, f))));
  return have.every(Boolean);
}
async function loadStoredTokenizer(repo) {
  const store = weightStore();
  const [json, config] = await Promise.all(TOKENIZER_FILES.map((f) => store.read(tokenizerCacheKey(repo, f))));
  if (!json || !config) return null;
  try {
    const decode = (buf) => JSON.parse(new TextDecoder().decode(buf));
    return new CLIPTokenizer(decode(json), decode(config));
  } catch {
    return null;
  }
}
async function storeTokenizerFiles(repo, signal) {
  const store = weightStore();
  let bytes = 0;
  for (const file of TOKENIZER_FILES) {
    const key = tokenizerCacheKey(repo, file);
    let buf = await store.read(key);
    if (!buf) {
      const url = `${HF_BASE}/${repo}/resolve/main/${file}`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`tokenizer ${url} \u2192 HTTP ${res.status}`);
      buf = await res.arrayBuffer();
      if (!await store.write(key, buf)) {
        throw new Error(`The tokenizer file ${file} could not be saved for offline use.`);
      }
    }
    bytes += buf.byteLength;
  }
  return bytes;
}

// src/engine/residency/session-residency.ts
var SESSION_COMPONENTS = ["text_encoder", "unet", "vae_decoder"];
var MIB = 1024 * 1024;
var RESIDENT_BUDGET_FRACTION = 0.8;
function residencyBudgetBytes(probed) {
  const total = probed.approxMemoryMb !== null ? probed.approxMemoryMb * MIB : probeRamBytes();
  return Math.max(1, Math.floor(total * RESIDENT_BUDGET_FRACTION));
}
function sessionResidentId(modelId, component) {
  return `${modelId}/${component}`;
}
var SessionResidency = class {
  manager;
  tier;
  constructor(probed, byteBudget = residencyBudgetBytes(probed)) {
    const onGpu = probed.kind === "webgpu" || probed.kind === "webnn";
    this.tier = onGpu ? "vram" : "ram";
    this.manager = createMemoryManager({ byteBudget, vramBudgetBytes: onGpu ? byteBudget : 0 });
  }
  /** Charge one freshly created session against the budget. Pinned for its
   *  whole life: the manager never evicts it. */
  async admit(args) {
    return this.manager.admit(
      {
        id: sessionResidentId(args.modelId, args.component),
        group: args.modelId,
        component: args.component,
        bytes: args.bytes,
        reloadCostMs: estimateReloadCostMs({ bytes: args.bytes, from: "storage" }),
        // A live engine runs every one of its sessions on every frame.
        reuseProbability: 1,
        tier: this.tier,
        payload: args.session
      },
      { pin: true, spill: false }
    );
  }
  /** Drop every resident of `modelId` from the budget and release `sessions`
   *  (the engine's own references — it may hold sessions the budget rejected).
   *  Release errors are swallowed so one bad session cannot block the rest. */
  async releaseModel(modelId, sessions) {
    for (const component of SESSION_COMPONENTS) {
      await this.manager.release(sessionResidentId(modelId, component));
    }
    await Promise.all(sessions.map((s) => releaseQuietly(s)));
  }
  /** Whether the budget is under memory pressure right now — background work
   *  (the refinement weight warm) pauses while it is. */
  isPressured() {
    return this.manager.pressure().pressured;
  }
  /** Budget bytes not charged to a live session (never negative). */
  headroomBytes() {
    const { byteBudget, usedBytes } = this.manager.stats();
    return Math.max(0, byteBudget - usedBytes);
  }
};
async function releaseQuietly(session) {
  if (!session) return;
  try {
    await session.release();
  } catch {
  }
}

// src/engine/residency/session-loader.ts
import * as ort3 from "onnxruntime-web";

// src/engine/ort-session.ts
import * as ort2 from "onnxruntime-web";

// src/engine/diffusion-models.ts
var MODEL_REGISTRY = {
  "lcm-tiny-sd": {
    id: "lcm-tiny-sd",
    engine: "lcm-diffusion",
    defaultSteps: 4,
    defaultGuidance: 1,
    minVramMb: 2 * 1024,
    // BK-SDM Tiny UNet (~0.3 GB fp16) + text-encoder + VAE
    hfRepo: "akameswa/lcm-tiny-sd-onnx-fp16",
    tokenizerRepo: "Xenova/clip-vit-large-patch14",
    textEmbedDim: 768,
    // SD1.5 base
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999, 759, 519, 259],
    files: {
      textEncoder: { model: "text_encoder/model.onnx" },
      unet: { model: "unet/model.onnx", externalData: "unet/model.onnx_data" },
      vaeDecoder: { model: "vae_decoder/model.onnx", externalData: "vae_decoder/model.onnx_data" }
    },
    // The akameswa export omits the LCM `timestep_cond` input (the "LCM" aspect
    // here is just the 4-step scheduler, not the consistency-embedding), but
    // it DOES keep the LCM-family float32 timestep — declaring int64 here
    // surfaces at first denoise as "Unexpected input data type. Actual:
    // (tensor(int64)), expected: (tensor(float))". The lcmFamilyTimestepIsFloat32
    // test in diffusion-engine.test.ts locks both LCM-family models on float32.
    unetInputs: [
      { name: "sample", dtype: "float32" },
      { name: "timestep", dtype: "float32" },
      { name: "encoder_hidden_states", dtype: "float32" }
    ],
    textEncoderInputs: [{ name: "input_ids", dtype: "int32" }]
    // lcmGuidanceEmbedDim intentionally omitted — see the unetInputs comment.
  },
  "lcm-dreamshaper-v7": {
    id: "lcm-dreamshaper-v7",
    engine: "lcm-diffusion",
    defaultSteps: 4,
    defaultGuidance: 1,
    // LCM works best with CFG ~1
    minVramMb: 6 * 1024,
    hfRepo: "aislamov/lcm-dreamshaper-v7-onnx",
    tokenizerRepo: "Xenova/clip-vit-large-patch14",
    textEmbedDim: 768,
    // SD1.5 base
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999, 759, 519, 259],
    files: {
      textEncoder: { model: "text_encoder/model.onnx" },
      unet: { model: "unet/model.onnx", externalData: "unet/model.onnx_data" },
      vaeDecoder: { model: "vae_decoder/model.onnx", externalData: "vae_decoder/model.onnx_data" }
    },
    // LCM Dreamshaper (aislamov) UNet expects timestep as float32 (NOT int64).
    // Drift here surfaces as: "Unexpected input data type. Actual: int64, expected: float".
    unetInputs: [
      { name: "sample", dtype: "float32" },
      { name: "timestep", dtype: "float32" },
      { name: "encoder_hidden_states", dtype: "float32" },
      { name: "timestep_cond", dtype: "float32" }
    ],
    textEncoderInputs: [{ name: "input_ids", dtype: "int32" }],
    lcmGuidanceEmbedDim: 256,
    // standard for LCM-LoRA-derived exports
    lcmGuidanceScale: 8.5
    // diffusers LCM default — embedded into timestep_cond (NOT defaultGuidance)
  },
  "sd-turbo": {
    id: "sd-turbo",
    engine: "lcm-diffusion",
    defaultSteps: 1,
    defaultGuidance: 0,
    // SD-Turbo is unconditional
    minVramMb: 4 * 1024,
    hfRepo: "schmuell/sd-turbo-ort-web",
    // ORT-team browser demo build (single-file ONNX)
    tokenizerRepo: "Xenova/clip-vit-large-patch14",
    textEmbedDim: 1024,
    // SD2.1 base
    sequenceLength: 77,
    vaeScalingFactor: 0.18215,
    defaultTimesteps: [999],
    files: {
      textEncoder: { model: "text_encoder/model.onnx" },
      unet: { model: "unet/model.onnx" },
      vaeDecoder: { model: "vae_decoder/model.onnx" }
    },
    // schmuell/sd-turbo-ort-web export uses int64 timestep (standard SD UNet).
    unetInputs: [
      { name: "sample", dtype: "float32" },
      { name: "timestep", dtype: "int64" },
      { name: "encoder_hidden_states", dtype: "float32" }
    ],
    textEncoderInputs: [{ name: "input_ids", dtype: "int32" }]
  },
  // ---------------------------------------------------------------------
  // WebDiT diffusion-transformer entries — the whole-clip `webdit-engine.ts`
  // generation path (see WebDitModelDescriptor in types.ts). All 4 register
  // `available: false, bundleUrl: null`: the models are wired end-to-end
  // (this registry entry, VideoEngine dispatch, webdit-engine.ts) but no
  // pretrained bundle has been exported + uploaded to R2 yet — see the
  // ROADMAP gap-register entry. `defaultSteps`/`defaultGuidance`/
  // `defaultFrames`/`defaultWidth`/`defaultHeight` are copied from each
  // architecture's `SamplingDefaults` in webdit/converter/src/architectures/
  // (read from those files directly, not assumed). `minVramMb` are rough
  // estimates (no real bundle exists yet to measure) noted per entry.
  // ---------------------------------------------------------------------
  "cogvideox-2b": {
    id: "cogvideox-2b",
    engine: "webdit-dit",
    architecture: "cogvideox-2b",
    // A real bundle IS uploaded (2026-08) — `studio-weights/webdit/cogvideox-2b/`
    // in the `builderforce-uploads` R2 bucket. This is the studio weights
    // proxy's own base URL, NOT `.../webdit/cogvideox-2b` — the
    // `webdit/<architecture>/` path segment is added by `webdit-engine.ts`'s
    // `fetchBundleFile` (its `cacheKey`, `webdit/${architecture}/${relPath}`,
    // is appended to this base by `getOrFetchWeight`'s r2-proxy resolver —
    // see `weight-cache.ts`'s `resolveSource`). Setting this to the
    // architecture-specific-looking URL the old comment on
    // `WebDitModelDescriptor.bundleUrl` suggested would double the path
    // segment and 404.
    bundleUrl: "https://api.builderforce.ai/api/studio/weights",
    available: true,
    // Real ~1.7B-param DiT (THUDM/CogVideoX-2b) + real T5-XXL text encoder
    // (encoder-only, ~4.7B params) + VAE, all fp32 ONNX graphs — NOT the
    // CLIP-L swap the original placeholder comment assumed (see
    // webdit/converter/src/architectures/cogvideox.ts's header comment for
    // the full real-weights writeup). fp32 (not fp16) because CPU export
    // tracing needs it (PyTorch CPU doesn't run fp16 matmul); that plus the
    // real T5-XXL size makes the actual uploaded graph+external-data total
    // ~26.6 GB (dit 7.05 GB, text encoder 19.05 GB, vae 0.50 GB — MEASURED
    // from the real 2026-08 export, not estimated). This is almost
    // certainly too large for real-world WebGPU/browser use on typical
    // consumer VRAM (8-24 GB) — flagging honestly rather than
    // under-stating it: the bundle is genuinely wired end-to-end and
    // verified numerically correct, but practical in-browser usability
    // would need a follow-up fp16-graph pass (post-export precision
    // conversion) or real quantization-aware export, neither done here.
    minVramMb: 28 * 1024,
    defaultSteps: 50,
    defaultGuidance: 6,
    defaultFrames: 49,
    defaultFps: 8,
    defaultWidth: 720,
    defaultHeight: 480
  },
  "wan2.5": {
    id: "wan2.5",
    engine: "webdit-dit",
    architecture: "wan2.5",
    bundleUrl: null,
    available: false,
    // Full Wan2.5 is ~14B — only usable in-browser via a distilled/pruned
    // export (webdit/converter/src/architectures/wan.ts); estimate assumes
    // that distilled variant, not the full checkpoint.
    minVramMb: 10 * 1024,
    defaultSteps: 20,
    defaultGuidance: 5,
    defaultFrames: 81,
    defaultFps: 16,
    defaultWidth: 832,
    defaultHeight: 480
  },
  "mochi-1": {
    id: "mochi-1",
    engine: "webdit-dit",
    architecture: "mochi-1",
    bundleUrl: null,
    available: false,
    // 10B AsymmDiT (Genmo), distilled/quantized for browser use
    // (webdit/converter/src/architectures/mochi.ts) — the heaviest of the 4.
    minVramMb: 12 * 1024,
    defaultSteps: 64,
    defaultGuidance: 4.5,
    defaultFrames: 163,
    defaultFps: 24,
    defaultWidth: 848,
    defaultHeight: 480
  },
  "ltx2-distilled": {
    id: "ltx2-distilled",
    engine: "webdit-dit",
    architecture: "ltx2-distilled",
    bundleUrl: null,
    available: false,
    // ~2B DiT, rectified-flow, distilled to 8 steps — the fastest of the 4
    // (webdit/converter/src/architectures/ltx.ts).
    minVramMb: 6 * 1024,
    defaultSteps: 8,
    defaultGuidance: 1,
    defaultFrames: 121,
    defaultFps: 24,
    defaultWidth: 768,
    defaultHeight: 512
  }
};

// src/engine/onnx-runtime-config.ts
import * as ort from "onnxruntime-web";
import { env as hfEnv } from "@huggingface/transformers";
function versionMatchedCdn() {
  const version = ort.env?.versions?.common;
  return version ? `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/` : "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
}
var configured = false;
var hostWasmBase = null;
var lastOptionWasmCdn = null;
function setOrtWasmBase(url) {
  hostWasmBase = url ? url.endsWith("/") ? url : `${url}/` : null;
  if (configured) applyWasmPaths(lastOptionWasmCdn ?? hostWasmBase ?? versionMatchedCdn());
}
var webgpuEnv = null;
var appliedWasmPaths = null;
var appliedNumThreads = null;
function applyToWebGpuOrt() {
  if (!webgpuEnv) return;
  if (appliedWasmPaths) webgpuEnv.wasm.wasmPaths = appliedWasmPaths;
  if (appliedNumThreads !== null) webgpuEnv.wasm.numThreads = appliedNumThreads;
}
async function configureWebGpuOrt() {
  const mod = await import("onnxruntime-web/webgpu");
  webgpuEnv = mod.env?.wasm ? mod.env : null;
  applyToWebGpuOrt();
}
function applyWasmPaths(wasmPaths) {
  if (hfEnv.backends?.onnx?.wasm) hfEnv.backends.onnx.wasm.wasmPaths = wasmPaths;
  ort.env.wasm.wasmPaths = wasmPaths;
  appliedWasmPaths = wasmPaths;
  applyToWebGpuOrt();
}
function configureOnnxRuntime(opts = {}) {
  if (configured) return;
  configured = true;
  lastOptionWasmCdn = opts.wasmCdn ?? null;
  const wasmPaths = opts.wasmCdn ?? hostWasmBase ?? versionMatchedCdn();
  const numThreads = opts.numThreads ?? 1;
  hfEnv.allowLocalModels = false;
  if (hfEnv.backends?.onnx?.wasm) hfEnv.backends.onnx.wasm.numThreads = numThreads;
  applyWasmPaths(wasmPaths);
  ort.env.wasm.numThreads = numThreads;
  appliedNumThreads = numThreads;
  applyToWebGpuOrt();
}

// src/engine/ort-session.ts
configureOnnxRuntime();
function materializeTensor(dtype, raw) {
  const shape = [...raw.shape];
  if (dtype === "float32") {
    return new ort2.Tensor("float32", raw.data, shape);
  }
  if (dtype === "int32") {
    const out = new Int32Array(raw.data.length);
    for (let i = 0; i < raw.data.length; i++) out[i] = raw.data[i] | 0;
    return new ort2.Tensor("int32", out, shape);
  }
  if (dtype === "int64") {
    const out = new BigInt64Array(raw.data.length);
    for (let i = 0; i < raw.data.length; i++) out[i] = BigInt(raw.data[i] | 0);
    return new ort2.Tensor("int64", out, shape);
  }
  throw new Error(`Unsupported dtype: ${dtype}`);
}
function pickFirstFloat32(result) {
  for (const value of Object.values(result)) {
    const data = value.data;
    if (data instanceof Float32Array) return data;
  }
  return null;
}
function checkMemoryForModel(approxMemoryMb, minVramMb, modelId) {
  if (approxMemoryMb === null) return null;
  if (approxMemoryMb >= minVramMb) return null;
  return `Insufficient memory for ${modelId}: device reports ~${(approxMemoryMb / 1024).toFixed(1)} GB available, model needs at least ~${(minVramMb / 1024).toFixed(1)} GB. ${lighterModelHint(modelId, approxMemoryMb)}`;
}
function lighterModelHint(failingModelId, availableMb) {
  const failing = MODEL_REGISTRY[failingModelId];
  const failingMin = failing?.minVramMb ?? Infinity;
  const alternatives = Object.values(MODEL_REGISTRY).filter((m) => m.id !== failingModelId).filter((m) => failing === void 0 || m.engine === failing.engine).filter((m) => m.minVramMb < failingMin).filter((m) => availableMb === null || m.minVramMb <= availableMb).sort((a, b) => a.minVramMb - b.minVramMb).map((m) => m.id);
  if (alternatives.length === 0) {
    return "No lighter model is available \u2014 close other GPU-heavy tabs and retry.";
  }
  return `Try a lighter model (${alternatives.join(", ")}) or close other GPU-heavy tabs.`;
}
function explainOrtError(err, label, modelId, minVramMb, availableMemoryMb = null) {
  const message = err instanceof Error ? err.message : String(err);
  if (/bad_alloc|out of memory|memory access out of bounds/i.test(message)) {
    return new Error(
      `Out of memory during ${label} for ${modelId} (needs ~${(minVramMb / 1024).toFixed(1)} GB). ${lighterModelHint(modelId, availableMemoryMb)} Original error: ${message}`
    );
  }
  if (/DXGI_ERROR_DEVICE_HUNG|Device.*is lost|GPUDevice.*lost|mapAsync.*lost/i.test(message)) {
    return new Error(
      `GPU device was lost during ${label} for ${modelId} \u2014 typically a Windows TDR (driver timeout, ~2 s per kernel). The model is too heavy for this GPU at the current resolution. Try a lower resolution (e.g. 256\xD7256), pick a lighter model, or switch the device target to CPU. Original error: ${message}`
    );
  }
  if (/InsertedPrecisionFreeCast|SimplifiedLayerNormFusion|graph_utils\.cc/.test(message)) {
    return new Error(
      `${label} ORT session refused to load due to a graph-fusion crash. This usually means graphOptimizationLevel is too aggressive \u2014 verify buildOrtSessionOptions still pins 'basic'. Original error: ${message}`
    );
  }
  return err instanceof Error ? err : new Error(message);
}
function buildOrtSessionOptions(device) {
  const base = {
    graphOptimizationLevel: "basic",
    // Drop ORT's `[W:` warnings (e.g. "VerifyEachNodeIsAssignedToAnEp: some
    // nodes were not assigned to the preferred EP"). These are informational
    // — every shape-op fallback to CPU logs one per session. With 3 sessions
    // and per-frame reuse, the console becomes unreadable. Severity 3 = error,
    // so real failures still log; warnings are silenced.
    logSeverityLevel: 3
  };
  if (device === "webnn") return { ...base, executionProviders: ["webnn", "wasm"] };
  if (device === "webgpu") return { ...base, executionProviders: ["webgpu", "wasm"] };
  return { ...base, executionProviders: ["wasm"] };
}
function basename(path) {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}
function assertSessionMatchesSpec(sessionLabel, session, specs) {
  const declared = specs.map((s) => s.name);
  const actual = session.inputNames;
  const missing = declared.filter((n) => !actual.includes(n));
  if (missing.length > 0) {
    throw new Error(
      `Registry/model mismatch on ${sessionLabel}: declared input(s) [${missing.join(", ")}] are not in the model's inputNames [${actual.join(", ")}]. Update MODEL_REGISTRY in diffusion-models.ts to match the actual export.`
    );
  }
}

// src/engine/progress.ts
function reportProgress(label, onProgress) {
  console.info(`[builderforce-studio] ${label}`);
  onProgress?.(label);
}

// src/engine/residency/session-loader.ts
function sessionBufferBytes(bufs) {
  return bufs.modelBuf.byteLength + (bufs.externalData?.buf.byteLength ?? 0);
}
async function fetchSessionBuffers(file, component, fetchWeight, onProgress) {
  reportProgress(`Downloading ${component} (${file.model})\u2026`, onProgress);
  const modelBuf = await fetchWeight(file.model);
  let externalData = null;
  if (file.externalData) {
    reportProgress(`Downloading ${component} weight data (${file.externalData})\u2026`, onProgress);
    const dataBuf = await fetchWeight(file.externalData);
    externalData = { name: basename(file.externalData), buf: dataBuf };
  }
  return { component, modelBuf, externalData };
}
async function createAdmittedSession(bufs, baseOptions, ctx) {
  const options = { ...baseOptions };
  if (bufs.externalData) {
    options.externalData = [
      { path: bufs.externalData.name, data: new Uint8Array(bufs.externalData.buf) }
    ];
  }
  reportProgress(`Creating ${bufs.component} ORT session\u2026`, ctx.onProgress);
  let session;
  try {
    session = await ort3.InferenceSession.create(new Uint8Array(bufs.modelBuf), options);
  } catch (err) {
    throw ctx.explain(err, `${bufs.component} session create`);
  }
  reportProgress(`${bufs.component} ready.`, ctx.onProgress);
  await ctx.residency.admit({
    modelId: ctx.modelId,
    component: bufs.component,
    bytes: sessionBufferBytes(bufs),
    session
  });
  return session;
}

// src/engine/residency/weight-prefetch.ts
function weightRequest(descriptor, file, source) {
  return {
    cacheKey: `${descriptor.id}/${file}`,
    hfRepo: descriptor.hfRepo,
    hfPath: file,
    sources: source.weightSources,
    apiKey: source.apiKey,
    r2Base: source.r2Base
  };
}
function modelWeightFiles(descriptor) {
  if (descriptor.engine !== "lcm-diffusion") return [];
  const { textEncoder, unet, vaeDecoder } = descriptor.files;
  return [textEncoder, unet, vaeDecoder].flatMap((f) => f.externalData ? [f.model, f.externalData] : [f.model]);
}
function modelTargets(model, source) {
  const descriptor = MODEL_REGISTRY[model];
  if (descriptor.engine !== "lcm-diffusion") return [];
  return modelWeightFiles(descriptor).map((file) => {
    const request = weightRequest(descriptor, file, source);
    return { id: request.cacheKey, bytes: 0, kind: "weights", meta: { request } };
  });
}
var WeightPrefetch = class {
  prefetcher;
  lifetime = new AbortController();
  targets;
  activity;
  headroomBytes;
  isPressured;
  load;
  isStored;
  canPersist;
  /** Targets still to warm, in order. */
  queue = [];
  /** Ids a fetch has claimed — never warmed (or requeued) again. */
  claimed = /* @__PURE__ */ new Set();
  /** Ids already retried after a failed persist. */
  retried = /* @__PURE__ */ new Set();
  active = null;
  started = false;
  stopped = false;
  constructor(refinementModel, source, deps) {
    this.activity = deps.activity;
    this.headroomBytes = deps.headroomBytes;
    this.isPressured = deps.isPressured ?? (() => false);
    this.load = deps.load ?? getOrFetchWeight;
    this.isStored = deps.isStored ?? ((key) => weightStore().has(key));
    this.canPersist = deps.canPersist ?? (() => weightStore().canPersist());
    this.targets = modelTargets(refinementModel, source);
    this.prefetcher = createPrefetcher({
      loader: (target, signal) => this.warmLoad(target, signal),
      targets: this.targets,
      maxConcurrent: 1
    });
  }
  get halted() {
    return this.stopped || this.lifetime.signal.aborted;
  }
  /** Start warming the refinement model's files, one at a time, while idle.
   *  Call after the draft engine's init resolved. No-op when repeated, after
   *  dispose, or when the weight store cannot persist. */
  start() {
    if (this.started || this.halted || !this.canPersist()) return;
    this.started = true;
    this.queue = [...this.targets];
    void this.drain();
  }
  async drain() {
    while (!this.halted) {
      const target = this.queue[0];
      if (!target) return;
      await this.untilIdle();
      if (this.halted) return;
      if (this.activity.isBusy()) continue;
      if (this.queue[0] !== target) continue;
      if (this.isPressured()) {
        await this.nextIdle();
        continue;
      }
      this.queue.shift();
      const result = await this.warm(target);
      if (this.halted) return;
      if (result === "requeue") {
        this.requeue(target);
      } else if (result === "pause") {
        this.requeue(target);
        await this.nextIdle();
      } else if (result === "persist-failed") {
        if (this.retried.has(target.id) || !this.canPersist()) {
          this.stop("weight store cannot persist");
          return;
        }
        this.retried.add(target.id);
        this.requeue(target);
        await this.nextIdle();
      }
    }
  }
  requeue(target) {
    if (!this.claimed.has(target.id)) this.queue.unshift(target);
  }
  async warm(target) {
    const warm = {
      id: target.id,
      settled: Promise.resolve(),
      cancelledByBusy: false,
      tooLarge: false,
      persistFailed: false
    };
    const offBusy = this.activity.onBusy(() => {
      warm.cancelledByBusy = true;
      this.prefetcher.cancel(target.id);
    });
    if (this.activity.isBusy()) {
      offBusy();
      return "requeue";
    }
    this.active = warm;
    const outcome = this.prefetcher.prefetch(target, { signal: this.lifetime.signal });
    warm.settled = outcome.then(() => void 0);
    try {
      return classify(await outcome, warm);
    } finally {
      offBusy();
      if (this.active === warm) this.active = null;
      this.prefetcher.release(target.id);
    }
  }
  /** The prefetch loader: warm one file into the store, resolving to its size
   *  so no buffer stays resident in the prefetcher. */
  async warmLoad(target, signal) {
    const request = target.meta?.request;
    if (!request) throw new Error(`WeightPrefetch: unknown weight target '${target.id}'`);
    const warm = this.active?.id === target.id ? this.active : null;
    if (await this.isStored(request.cacheKey)) return 0;
    signal.throwIfAborted();
    const bytes = await this.load({
      ...request,
      signal,
      onProgress: (_loaded, total) => {
        if (warm && !warm.tooLarge && total !== null && total * 2 > this.headroomBytes()) {
          warm.tooLarge = true;
          this.prefetcher.cancel(target.id);
        }
      },
      onPersistFailed: () => {
        if (warm) warm.persistFailed = true;
      }
    });
    return bytes.byteLength;
  }
  /** Fetch one weight file: claim it from the warm queue, wait out a warm of
   *  it that is still settling, then read it through the store. */
  async fetch(request) {
    const key = request.cacheKey;
    this.claimed.add(key);
    this.queue = this.queue.filter((target) => target.id !== key);
    const active = this.active;
    if (active?.id === key) await active.settled;
    return this.load({ ...request, signal: this.lifetime.signal });
  }
  /** Resolves when the engine is idle, or the warm is disposed. */
  untilIdle() {
    if (!this.activity.isBusy()) return Promise.resolve();
    return this.abortable((done) => {
      void this.activity.whenIdle().then(done);
      return () => {
      };
    });
  }
  /** Resolves at the next busy → idle transition (the current one when busy
   *  now), or when the warm is disposed. */
  nextIdle() {
    return this.abortable((done) => {
      let off = () => {
      };
      const afterBusy = () => {
        off();
        void this.activity.whenIdle().then(done);
      };
      if (this.activity.isBusy()) afterBusy();
      else off = this.activity.onBusy(afterBusy);
      return () => off();
    });
  }
  /** A promise resolved by `arm`'s `done` callback or by dispose, whichever
   *  comes first; `arm` returns its own cleanup. */
  abortable(arm) {
    const { signal } = this.lifetime;
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      let cleanup = () => {
      };
      const done = () => {
        cleanup();
        signal.removeEventListener("abort", done);
        resolve();
      };
      signal.addEventListener("abort", done, { once: true });
      cleanup = arm(done);
    });
  }
  /** Stop warming: nothing further starts, anything in flight is cancelled. */
  stop(reason) {
    this.stopped = true;
    this.queue = [];
    this.prefetcher.cancelAll(reason);
  }
  /** Abort every in-flight warm and drop every record. Idempotent. */
  dispose() {
    this.lifetime.abort();
    this.stop("engine disposed");
    for (const id of this.prefetcher.residentIds()) this.prefetcher.release(id);
  }
};
function classify(outcome, warm) {
  if (outcome === "loaded") return warm.persistFailed ? "persist-failed" : "done";
  if (outcome === "cancelled") return warm.cancelledByBusy && !warm.tooLarge ? "requeue" : "skip";
  if (outcome === "failed") return "skip";
  return "pause";
}

// src/engine/diffusion-schedule.ts
var TRAIN_TIMESTEPS = 1e3;
var ALPHAS_CUMPROD = computeAlphasCumprod(85e-5, 0.012, TRAIN_TIMESTEPS);
function computeAlphasCumprod(betaStart, betaEnd, T) {
  const out = new Float32Array(T);
  const sqrtStart = Math.sqrt(betaStart);
  const sqrtEnd = Math.sqrt(betaEnd);
  let running = 1;
  for (let t = 0; t < T; t++) {
    const sqrtBeta = sqrtStart + (sqrtEnd - sqrtStart) * (t / (T - 1));
    const beta = sqrtBeta * sqrtBeta;
    running *= 1 - beta;
    out[t] = running;
  }
  return out;
}
function alphaCumprodAt(timestep) {
  const t = Number.isFinite(timestep) ? Math.round(timestep) : TRAIN_TIMESTEPS - 1;
  return ALPHAS_CUMPROD[Math.min(TRAIN_TIMESTEPS - 1, Math.max(0, t))];
}
function noiseScaleAt(timestep) {
  return Math.sqrt(1 - alphaCumprodAt(timestep));
}
function gaussianNoise(length, seed) {
  const out = new Float32Array(length);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    state = state * 1664525 + 1013904223 >>> 0;
    const u1 = (state + 1) / 4294967296;
    state = state * 1664525 + 1013904223 >>> 0;
    const u2 = (state + 1) / 4294967296;
    out[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  return out;
}
function forwardDiffuse(clean, timestep, seed) {
  const alpha = alphaCumprodAt(timestep);
  const sqrtAlpha = Math.sqrt(alpha);
  const sqrtOneMinusAlpha = Math.sqrt(1 - alpha);
  const noise = gaussianNoise(clean.length, seed);
  const out = new Float32Array(clean.length);
  for (let i = 0; i < clean.length; i++) out[i] = sqrtAlpha * clean[i] + sqrtOneMinusAlpha * noise[i];
  return out;
}
var RENOISE_SEED_STRIDE = 7919;
function lcmStep(sample, noisePred, timestep, nextTimestep, seed, stepIndex) {
  const alpha = alphaCumprodAt(timestep);
  const sqrtAlpha = Math.sqrt(alpha);
  const sqrtOneMinusAlpha = Math.sqrt(1 - alpha);
  if (nextTimestep === null) {
    for (let j = 0; j < sample.length; j++) {
      sample[j] = (sample[j] - sqrtOneMinusAlpha * noisePred[j]) / sqrtAlpha;
    }
    return;
  }
  const alphaNext = alphaCumprodAt(nextTimestep);
  const sqrtAlphaNext = Math.sqrt(alphaNext);
  const sqrtOneMinusAlphaNext = Math.sqrt(1 - alphaNext);
  const noise = gaussianNoise(sample.length, seed + stepIndex * RENOISE_SEED_STRIDE);
  for (let j = 0; j < sample.length; j++) {
    const x0 = (sample[j] - sqrtOneMinusAlpha * noisePred[j]) / sqrtAlpha;
    sample[j] = sqrtAlphaNext * x0 + sqrtOneMinusAlphaNext * noise[j];
  }
}
function applyGuidance(cond, uncond, guidance) {
  for (let i = 0; i < cond.length; i++) {
    cond[i] = uncond[i] + guidance * (cond[i] - uncond[i]);
  }
}
var DEFAULT_LCM_GUIDANCE_SCALE = 8.5;
function lcmGuidanceCondEmbedding(descriptor) {
  const dim = descriptor.lcmGuidanceEmbedDim ?? 256;
  const w = (descriptor.lcmGuidanceScale ?? DEFAULT_LCM_GUIDANCE_SCALE) - 1;
  return guidanceScaleEmbedding(w, dim);
}
function guidanceScaleEmbedding(w, dim) {
  const half = Math.floor(dim / 2);
  const out = new Float32Array(dim);
  const logBase = Math.log(1e4) / Math.max(1, half - 1);
  const wScaled = w * 1e3;
  for (let i = 0; i < half; i++) {
    const freq = Math.exp(-logBase * i);
    out[i] = Math.sin(wScaled * freq);
    if (half + i < dim) out[half + i] = Math.cos(wScaled * freq);
  }
  return out;
}

// src/engine/abort.ts
function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("Generation aborted", "AbortError");
}

// src/engine/diffusion-engine.ts
var UNET_INPUT_BUILDERS = {
  sample: (ctx) => ({ data: ctx.sample, shape: ctx.latentShape }),
  timestep: (ctx) => ({ data: Float32Array.from([ctx.timestep]), shape: [1] }),
  encoder_hidden_states: (ctx) => ({
    data: ctx.condEmbedding,
    shape: [1, ctx.descriptor.sequenceLength, ctx.descriptor.textEmbedDim]
  }),
  timestep_cond: (ctx) => ({
    // LCM consistency-model guidance-scale embedding. The embedded scale is the
    // model's DISTILLATION guidance scale (descriptor.lcmGuidanceScale, diffusers
    // default 8.5), NOT the runtime cond/uncond mix `ctx.guidance` (~1 for LCM).
    // Embedding the mix scale gave w = 1 - 1 = 0 → a degenerate all-[sin0=0,cos0=1]
    // vector, conditioning the UNet as if guidance≈1 and producing washed,
    // out-of-range latents on the refinement pass. See lcmGuidanceCondEmbedding.
    data: lcmGuidanceCondEmbedding(ctx.descriptor),
    shape: [1, ctx.descriptor.lcmGuidanceEmbedDim ?? 256]
  })
};
var KNOWN_UNET_INPUTS = new Set(
  Object.keys(UNET_INPUT_BUILDERS)
);
var PROMPT_EMBEDDING_CACHE_SIZE = 8;
var DiffusionEngine = class {
  constructor(opts) {
    this.opts = opts;
    this.residency = opts.residency ?? new SessionResidency(opts.probed);
  }
  opts;
  tokenizer = null;
  textEncoderSession = null;
  unetSession = null;
  vaeSession = null;
  disposed = false;
  /** Insertion-ordered, so the first key is the least recently used. */
  promptEmbeddings = /* @__PURE__ */ new Map();
  residency;
  // -------------------------------------------------------------------------
  async init() {
    const d = this.descriptor;
    const sessionOptions = buildOrtSessionOptions(this.opts.probed.kind);
    const onProgress = this.opts.onProgress;
    const memoryError = checkMemoryForModel(
      this.opts.probed.approxMemoryMb,
      d.minVramMb,
      d.id
    );
    if (memoryError) {
      throw new Error(memoryError);
    }
    if (this.opts.probed.kind === "webgpu" && this.opts.probed.gpuDevice) {
      this.opts.probed.gpuDevice.lost.then((info) => {
        reportProgress(
          `GPU device LOST (${info.reason}): ${info.message}. Reload the page; pick a lower resolution or lighter model on retry.`,
          onProgress
        );
      }).catch(() => {
      });
    }
    try {
      reportProgress(`Loading CLIP tokenizer (${d.tokenizerRepo})\u2026`, onProgress);
      this.tokenizer = await loadStoredTokenizer(d.tokenizerRepo) ?? await AutoTokenizer.from_pretrained(d.tokenizerRepo);
      reportProgress("Tokenizer ready.", onProgress);
      reportProgress(`Loading ${d.id} weights (UNet + text-encoder + VAE)\u2026`, onProgress);
      const fetchWeight = (file) => this.fetchWeight(file);
      const downloads = await Promise.all([
        fetchSessionBuffers(d.files.textEncoder, "text_encoder", fetchWeight, onProgress),
        fetchSessionBuffers(d.files.unet, "unet", fetchWeight, onProgress),
        fetchSessionBuffers(d.files.vaeDecoder, "vae_decoder", fetchWeight, onProgress)
      ]);
      this.textEncoderSession = await this.createSessionFromBuffers(downloads[0], sessionOptions);
      this.unetSession = await this.createSessionFromBuffers(downloads[1], sessionOptions);
      this.vaeSession = await this.createSessionFromBuffers(downloads[2], sessionOptions);
      reportProgress("All ORT sessions created.", onProgress);
      assertSessionMatchesSpec("unet", this.unetSession, d.unetInputs);
      assertSessionMatchesSpec("text_encoder", this.textEncoderSession, d.textEncoderInputs);
      reportProgress("Model graph contract verified \u2014 engine ready.", onProgress);
    } catch (err) {
      await this.releaseSessions();
      throw err;
    }
  }
  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------
  /**
   * Release ORT sessions + destroy the engine's GPU device. Idempotent and
   * safe to await even on a never-fully-init'd engine. After dispose() the
   * engine cannot be reused — create a new one.
   *
   * ORT sessions hold large WASM heaps + WebGPU buffers (the LCM UNet
   * alone is ~1.7 GB). Without release(), those stay allocated even after
   * the React tree unmounts — exactly the leak the user surfaced.
   */
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    await this.releaseSessions();
    if (this.opts.probed.kind === "webgpu" && this.opts.probed.gpuDevice) {
      try {
        this.opts.probed.gpuDevice.destroy();
      } catch {
      }
    }
  }
  /**
   * `DiffusionEngine` only ever implements the lcm-diffusion frame-by-frame
   * primitives (embed/denoise/decode) — a webdit-dit model is never handed
   * to this class (VideoEngine.create dispatches those to webdit-engine.ts
   * instead). Narrowing here, once, means every other method on this class
   * can read LCM-only fields (`hfRepo`, `unetInputs`, `files`, …) without
   * repeating the guard.
   */
  get descriptor() {
    const d = MODEL_REGISTRY[this.opts.model];
    if (d.engine !== "lcm-diffusion") {
      throw new Error(
        `DiffusionEngine only supports lcm-diffusion models; got '${d.id}' (engine: ${d.engine}). webdit-dit models are handled by webdit-engine.ts / VideoEngine's webdit dispatch.`
      );
    }
    return d;
  }
  get activeDevice() {
    return this.opts.probed.kind;
  }
  /** Tokenise (transformers.js) then run the CLIP text encoder (raw ORT) →
   *  conditioning embedding [1, seqLen, embedDim]. Memoised per prompt (see
   *  {@link PROMPT_EMBEDDING_CACHE_SIZE}); every call returns its own copy, so a
   *  caller that blends or biases the embedding cannot corrupt the cache. */
  async embedPrompt(prompt) {
    const cached = this.promptEmbeddings.get(prompt);
    if (cached) {
      this.promptEmbeddings.delete(prompt);
      this.promptEmbeddings.set(prompt, cached);
      return new Float32Array(cached);
    }
    const embedding = await this.encodePrompt(prompt);
    this.promptEmbeddings.set(prompt, embedding);
    if (this.promptEmbeddings.size > PROMPT_EMBEDDING_CACHE_SIZE) {
      const oldest = this.promptEmbeddings.keys().next().value;
      if (oldest !== void 0) this.promptEmbeddings.delete(oldest);
    }
    return new Float32Array(embedding);
  }
  /** Sample a fresh latent from deterministic gaussian noise. */
  sampleInitialLatent(seed) {
    return gaussianNoise(this.latentLength, seed);
  }
  /**
   * Shared denoise primitive for both LCM and SD-Turbo. Uses the LCMScheduler
   * consistency-model step formula at the chosen timesteps; SD-Turbo with
   * timesteps=[999] degenerates to a single step that's equivalent to its
   * native one-shot generation up to a small numerical constant.
   */
  async denoise(inputs) {
    if (!this.unetSession || !this.vaeSession) {
      throw new Error("DiffusionEngine.init() not called");
    }
    this.assertDenoiseInputs(inputs);
    const { latentH, latentW } = this.latentDims;
    const latentShape = [1, 4, latentH, latentW];
    const timesteps = inputs.timesteps ?? this.descriptor.defaultTimesteps;
    const sample = new Float32Array(inputs.latent);
    for (let i = 0; i < timesteps.length; i++) {
      throwIfAborted(inputs.signal);
      inputs.onStep?.(i + 1, timesteps.length);
      const t = timesteps[i];
      const noisePred = await this.runUnet({
        sample,
        condEmbedding: inputs.condEmbedding,
        uncondEmbedding: inputs.uncondEmbedding,
        timestep: t,
        guidance: inputs.guidance,
        latentShape
      });
      const next = i < timesteps.length - 1 ? timesteps[i + 1] : null;
      lcmStep(sample, noisePred, t, next, inputs.seed, i);
    }
    throwIfAborted(inputs.signal);
    const pixels = await this.runVaeDecode(sample, latentH, latentW);
    return { pixels, latent: sample };
  }
  /**
   * Forward-noise a clean latent to the noise level corresponding to `timestep`.
   * Used by VideoEngine's img2img recursion: take the previous frame's clean
   * latent, re-noise it to a partial-schedule timestep, then run the remaining
   * denoise steps. Result is scene-content carried forward + prompt-driven
   * evolution, instead of "fresh interpretation per frame".
   *
   *   noised = sqrt(alpha_cumprod[t]) * clean + sqrt(1 - alpha_cumprod[t]) * noise
   *
   * — the standard DDPM forward diffusion at timestep t.
   */
  addNoiseToLatent(clean, timestep, seed) {
    return forwardDiffuse(clean, timestep, seed);
  }
  /**
   * The noise fraction `sqrt(1 - ᾱ_t)` of a latent re-noised to `timestep` via
   * the shared DDPM schedule — i.e. the coefficient on the noise term in
   * `addNoiseToLatent`. Exposed so the coherence layer can scale the
   * latent-residual Mamba bias by the same noise level the engine actually
   * injected, letting that bias compose with img2img recursion (see
   * `latentResidualBiasScale`). Single source of truth for the schedule.
   */
  noiseScaleForTimestep(timestep) {
    return noiseScaleAt(timestep);
  }
  /**
   * VAE-decode a clean latent to RGB pixels ([-1..1], layout [3, h, w]) WITHOUT
   * running the UNet denoise loop. This is the cheap half of `denoise()` and is
   * what makes keyframe interpolation worthwhile: the FrameInterpolator slerps
   * two keyframe latents into a tween latent, and the engine turns that tween
   * into a frame with one VAE decode instead of a full multi-step denoise.
   */
  async decodeLatent(latent) {
    if (!this.vaeSession) {
      throw new Error("DiffusionEngine.init() not called");
    }
    if (latent.length !== this.latentLength) {
      throw new Error(
        `decodeLatent: latent length ${latent.length} != expected ${this.latentLength} for ${this.opts.width}x${this.opts.height}.`
      );
    }
    const { latentH, latentW } = this.latentDims;
    return this.runVaeDecode(latent, latentH, latentW);
  }
  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------
  get latentDims() {
    return { latentH: this.opts.height / 8, latentW: this.opts.width / 8 };
  }
  /** Elements in one [1, 4, h/8, w/8] latent. */
  get latentLength() {
    const { latentH, latentW } = this.latentDims;
    return 4 * latentH * latentW;
  }
  /**
   * Shape-check the denoise feeds BEFORE the first UNet run. A latent made at
   * another resolution, or an embedding from another backbone (768-wide SD1.5
   * vs 1024-wide SD2.1), otherwise surfaces as ORT's opaque "invalid
   * dimensions" from deep inside the WASM runtime.
   */
  assertDenoiseInputs(inputs) {
    if (inputs.latent.length !== this.latentLength) {
      throw new Error(
        `denoise: latent length ${inputs.latent.length} != expected ${this.latentLength} for ${this.opts.width}x${this.opts.height}.`
      );
    }
    const { sequenceLength, textEmbedDim, id } = this.descriptor;
    const embedLength = sequenceLength * textEmbedDim;
    const embeddings = [
      ["condEmbedding", inputs.condEmbedding],
      ["uncondEmbedding", inputs.uncondEmbedding]
    ];
    for (const [name, embedding] of embeddings) {
      if (embedding && embedding.length !== embedLength) {
        throw new Error(
          `denoise: ${name} length ${embedding.length} != expected ${embedLength} ([1, ${sequenceLength}, ${textEmbedDim}] for ${id}) \u2014 was it embedded by a different model?`
        );
      }
    }
  }
  /** Release every ORT session, the tokenizer and the prompt memo. Shared by
   *  dispose() and the init() failure path; safe on a partially-built engine. */
  async releaseSessions() {
    const sessions = [this.textEncoderSession, this.unetSession, this.vaeSession];
    this.textEncoderSession = null;
    this.unetSession = null;
    this.vaeSession = null;
    this.tokenizer = null;
    this.promptEmbeddings.clear();
    await this.residency.releaseModel(this.opts.model, sessions);
  }
  /** The uncached text-encoder pass behind {@link embedPrompt}. */
  async encodePrompt(prompt) {
    if (!this.tokenizer || !this.textEncoderSession) {
      throw new Error("DiffusionEngine.init() not called");
    }
    const { textEmbedDim, sequenceLength } = this.descriptor;
    const encoded = await this.tokenizer(prompt, {
      padding: "max_length",
      max_length: sequenceLength,
      truncation: true
    });
    const rawIds = encoded.input_ids.data;
    const idFloats = new Float32Array(sequenceLength);
    for (let i = 0; i < sequenceLength; i++) {
      idFloats[i] = i < rawIds.length ? Number(rawIds[i]) : 0;
    }
    const inputIdsSpec = this.descriptor.textEncoderInputs.find((s) => s.name === "input_ids");
    if (!inputIdsSpec) {
      throw new Error(`Model '${this.descriptor.id}' textEncoderInputs missing 'input_ids' spec.`);
    }
    const idTensor = materializeTensor(inputIdsSpec.dtype, {
      data: idFloats,
      shape: [1, sequenceLength]
    });
    const out = await this.runSession(
      this.textEncoderSession,
      { [inputIdsSpec.name]: idTensor },
      "text_encoder"
    );
    const hidden = out.last_hidden_state?.data ?? pickFirstFloat32(out);
    if (!hidden) {
      throw new Error("Text encoder returned no Float32 output");
    }
    if (hidden.length !== sequenceLength * textEmbedDim) {
      throw new Error(
        `Text encoder dim mismatch: expected ${sequenceLength * textEmbedDim}, got ${hidden.length}. Check ${this.descriptor.hfRepo} text_encoder config.`
      );
    }
    return new Float32Array(hidden);
  }
  /** Create + admit one session — serially only (session-loader's SERIAL-CREATE INVARIANT). */
  createSessionFromBuffers(bufs, baseOptions) {
    const d = this.descriptor;
    return createAdmittedSession(bufs, baseOptions, {
      residency: this.residency,
      modelId: this.opts.model,
      onProgress: this.opts.onProgress,
      explain: (err, phase) => explainOrtError(err, phase, d.id, d.minVramMb, this.opts.probed.approxMemoryMb)
    });
  }
  /** Wrap session.run() so DXGI_ERROR_DEVICE_HUNG, std::bad_alloc, "Device is
   *  lost", and similar runtime ORT failures become actionable messages
   *  instead of raw WebGPU stack traces. Single sink — every session.run
   *  call in the engine goes through here. */
  async runSession(session, feeds, label) {
    try {
      return await session.run(feeds);
    } catch (err) {
      throw explainOrtError(
        err,
        `${label} session run`,
        this.descriptor.id,
        this.descriptor.minVramMb,
        this.opts.probed.approxMemoryMb
      );
    }
  }
  /** One weight file — via the prefetcher when wired, else the weight cache. */
  async fetchWeight(file) {
    const request = {
      ...weightRequest(this.descriptor, file, this.opts),
      onProgress: (loaded, total) => this.opts.onWeightProgress?.(file, loaded, total)
    };
    return this.opts.weightPrefetch ? this.opts.weightPrefetch.fetch(request) : getOrFetchWeight(request);
  }
  buildUnetFeeds(args) {
    const ctx = { descriptor: this.descriptor, ...args };
    const feeds = {};
    for (const spec of this.descriptor.unetInputs) {
      const builder = UNET_INPUT_BUILDERS[spec.name];
      if (!builder) {
        throw new Error(
          `Model '${this.descriptor.id}' declares UNet input '${spec.name}' but no builder is registered. Add it to UNET_INPUT_BUILDERS in diffusion-engine.ts.`
        );
      }
      feeds[spec.name] = materializeTensor(spec.dtype, builder(ctx));
    }
    return feeds;
  }
  async runUnet(args) {
    const session = this.unetSession;
    const { uncondEmbedding, ...condArgs } = args;
    const condOut = await this.runSession(session, this.buildUnetFeeds(condArgs), "unet (conditional)");
    const condNoise = pickFirstFloat32(condOut);
    if (!condNoise) throw new Error("UNet returned no Float32 output");
    if (!uncondEmbedding || args.guidance <= 0) {
      return condNoise;
    }
    const uncondOut = await this.runSession(
      session,
      this.buildUnetFeeds({ ...condArgs, condEmbedding: uncondEmbedding }),
      "unet (unconditional)"
    );
    const uncondNoise = pickFirstFloat32(uncondOut);
    if (!uncondNoise) throw new Error("UNet unconditional pass returned no Float32 output");
    applyGuidance(condNoise, uncondNoise, args.guidance);
    return condNoise;
  }
  async runVaeDecode(latent, h, w) {
    const session = this.vaeSession;
    const scaled = new Float32Array(latent.length);
    const scale = this.descriptor.vaeScalingFactor;
    for (let i = 0; i < latent.length; i++) scaled[i] = latent[i] / scale;
    const input = new ort4.Tensor("float32", scaled, [1, 4, h, w]);
    const out = await this.runSession(session, { latent_sample: input }, "vae_decoder");
    const pixels = pickFirstFloat32(out);
    if (!pixels) throw new Error("VAE decoder returned no Float32 output");
    return pixels;
  }
};

// src/engine/residency/engine-activity.ts
var EngineActivity = class {
  busy = 0;
  busyListeners = /* @__PURE__ */ new Set();
  idleWaiters = [];
  /** Run `work` with the engine marked busy. */
  async run(work) {
    this.busy += 1;
    if (this.busy === 1) {
      for (const listener of [...this.busyListeners]) listener();
    }
    try {
      return await work();
    } finally {
      this.busy -= 1;
      if (this.busy === 0) {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        for (const resolve of waiters) resolve();
      }
    }
  }
  isBusy() {
    return this.busy > 0;
  }
  whenIdle() {
    if (this.busy === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
  onBusy(listener) {
    this.busyListeners.add(listener);
    return () => {
      this.busyListeners.delete(listener);
    };
  }
};

// src/engine/residency/lcm-residency.ts
var LcmResidency = class {
  constructor(opts) {
    this.opts = opts;
    this.sessions = new SessionResidency(opts.probed);
    const refinement = opts.refinementModel;
    this.prefetch = refinement && refinement !== opts.model ? new WeightPrefetch(refinement, opts, {
      activity: this.activity,
      headroomBytes: () => this.sessions.headroomBytes(),
      isPressured: () => this.sessions.isPressured()
    }) : null;
  }
  opts;
  sessions;
  activity = new EngineActivity();
  prefetch;
  /** A DiffusionEngine for `model`, wired to the shared residency (and, for the
   *  refinement model, to the weight warm). */
  createEngine(model, view) {
    const { probed, apiKey, weightSources, r2Base } = this.opts;
    return new DiffusionEngine({
      model,
      probed,
      apiKey,
      weightSources,
      r2Base,
      ...view,
      residency: this.sessions,
      weightPrefetch: this.prefetch && model === this.opts.refinementModel ? this.prefetch : void 0
    });
  }
  /** Run one generation with the engine marked busy — the weight warm yields to it. */
  run(work) {
    return this.activity.run(work);
  }
  /** Begin warming the refinement model's weights while idle. Call only after
   *  the draft engine's init has resolved. */
  prefetchRefinement() {
    this.prefetch?.start();
  }
  /** Stop background warms and drop their records. Idempotent. */
  dispose() {
    this.prefetch?.dispose();
  }
};

// src/engine/frame-interpolator.ts
function slerp(a, b, t) {
  if (a.length !== b.length) {
    throw new Error(`slerp: length mismatch (${a.length} vs ${b.length})`);
  }
  if (t <= 0) return new Float32Array(a);
  if (t >= 1) return new Float32Array(b);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB) || 1;
  let cosTheta = dot / denom;
  if (cosTheta > 1) cosTheta = 1;
  if (cosTheta < -1) cosTheta = -1;
  const theta = Math.acos(cosTheta);
  const sinTheta = Math.sin(theta);
  const out = new Float32Array(a.length);
  if (sinTheta < 1e-4) {
    for (let i = 0; i < a.length; i++) {
      out[i] = a[i] * (1 - t) + b[i] * t;
    }
    return out;
  }
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  for (let i = 0; i < a.length; i++) {
    out[i] = wa * a[i] + wb * b[i];
  }
  return out;
}
function planKeyframeIndices(totalFrames, factor) {
  const total = Math.max(0, Math.floor(totalFrames));
  if (total === 0) return [];
  if (total === 1) return [0];
  const step = Math.max(1, Math.floor(factor));
  if (step === 1) return Array.from({ length: total }, (_, i) => i);
  const indices = [];
  for (let i = 0; i < total; i += step) indices.push(i);
  const last = total - 1;
  if (indices[indices.length - 1] !== last) indices.push(last);
  return indices;
}
function buildInterpolatedSequence(keyframes) {
  if (keyframes.length === 0) return [];
  if (keyframes.length === 1) {
    return [{ outputIndex: keyframes[0].outputIndex, isTween: false, keyframeIndex: 0 }];
  }
  const slots = [];
  for (let k = 0; k < keyframes.length - 1; k++) {
    const k0 = keyframes[k];
    const k1 = keyframes[k + 1];
    slots.push({ outputIndex: k0.outputIndex, isTween: false, keyframeIndex: k });
    const span = k1.outputIndex - k0.outputIndex;
    for (let x = k0.outputIndex + 1; x < k1.outputIndex; x++) {
      const t = (x - k0.outputIndex) / span;
      slots.push({ outputIndex: x, isTween: true, latent: slerp(k0.latent, k1.latent, t) });
    }
  }
  const lastIdx = keyframes.length - 1;
  slots.push({
    outputIndex: keyframes[lastIdx].outputIndex,
    isTween: false,
    keyframeIndex: lastIdx
  });
  return slots;
}

// src/engine/kernels/selective-scan.wgsl.ts
var SELECTIVE_SCAN_WORKGROUP_SIZE = 64;
var SELECTIVE_SCAN_STEP_WGSL = (
  /* wgsl */
  `
struct Params {
  channels : u32,
  order    : u32,
  decay    : f32,
  gain     : f32,
};

@group(0) @binding(0) var<uniform>             params : Params;
@group(0) @binding(1) var<storage, read>       state  : array<f32>;
@group(0) @binding(2) var<storage, read>       pooled : array<f32>;
@group(0) @binding(3) var<storage, read_write> next   : array<f32>;

@compute @workgroup_size(${SELECTIVE_SCAN_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let total = params.channels * params.order;
  if (idx >= total) { return; }
  let c = idx / params.order;
  next[idx] = params.decay * state[idx] + params.gain * pooled[c];
}
`
);

// src/engine/selective-scan.ts
var DEFAULT_SCAN_DECAY = 0.92;
var DEFAULT_SCAN_GAIN = 0.1;
function selectiveScanStepCpu(a) {
  const next = new Float32Array(a.channels * a.order);
  for (let c = 0; c < a.channels; c++) {
    for (let k = 0; k < a.order; k++) {
      const idx = c * a.order + k;
      next[idx] = a.decay * (a.state[idx] ?? 0) + a.gain * a.pooled[c];
    }
  }
  return next;
}
async function selectiveScanStepGpu(device, a) {
  const total = a.channels * a.order;
  const bytes = Math.max(4, total * 4);
  const params = new ArrayBuffer(16);
  const pv = new DataView(params);
  pv.setUint32(0, a.channels, true);
  pv.setUint32(4, a.order, true);
  pv.setFloat32(8, a.decay, true);
  pv.setFloat32(12, a.gain, true);
  const state = new Float32Array(Math.max(1, total));
  for (let i = 0; i < total; i++) state[i] = a.state[i] ?? 0;
  const pooled = new Float32Array(Math.max(1, a.channels));
  pooled.set(a.pooled.subarray(0, a.channels));
  const buffers = [];
  const make = (size, usage, data) => {
    const buf = device.createBuffer({ size, usage });
    if (data) device.queue.writeBuffer(buf, 0, data);
    buffers.push(buf);
    return buf;
  };
  try {
    const paramBuf = make(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, params);
    const stateBuf = make(bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, state);
    const pooledBuf = make(Math.max(4, a.channels * 4), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, pooled);
    const nextBuf = make(bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const readBuf = make(bytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: device.createShaderModule({ code: SELECTIVE_SCAN_STEP_WGSL }), entryPoint: "main" }
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [paramBuf, stateBuf, pooledBuf, nextBuf].map((buffer, binding) => ({
        binding,
        resource: { buffer }
      }))
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(total / SELECTIVE_SCAN_WORKGROUP_SIZE)));
    pass.end();
    enc.copyBufferToBuffer(nextBuf, 0, readBuf, 0, bytes);
    device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(readBuf.getMappedRange().slice(0, total * 4));
    readBuf.unmap();
    return out;
  } finally {
    for (const b of buffers) b.destroy();
  }
}
async function selectiveScanStep(a, device) {
  if (device && a.channels * a.order > 0) {
    try {
      return await selectiveScanStepGpu(device, a);
    } catch {
    }
  }
  return selectiveScanStepCpu(a);
}

// src/engine/mamba-coherence.ts
function projectState(state, targetDim) {
  const out = new Float32Array(targetDim);
  if (state.data.length === 0) return out;
  for (let i = 0; i < state.data.length; i++) {
    const v = state.data[i];
    const targetIdx = mixIndex(i, state.dim, state.channels, state.order, targetDim);
    out[targetIdx] += v;
  }
  let norm = 0;
  for (let i = 0; i < targetDim; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < targetDim; i++) out[i] /= norm;
  return out;
}
function applyToPrompt(args) {
  const { ctx, promptEmbedding, seqLen, embedDim } = args;
  if (ctx.strength <= 0) return promptEmbedding;
  const stateVec = projectState(ctx.state, embedDim);
  const out = new Float32Array(promptEmbedding);
  const tokenOffset = (seqLen - 1) * embedDim;
  for (let d = 0; d < embedDim; d++) {
    const original = out[tokenOffset + d];
    out[tokenOffset + d] = original * (1 - ctx.strength) + stateVec[d] * ctx.strength;
  }
  return out;
}
function blendNoise(anchor, frame, alpha) {
  if (anchor.length !== frame.length) {
    throw new Error(`blendNoise: length mismatch (${anchor.length} vs ${frame.length})`);
  }
  if (alpha <= 0) return new Float32Array(anchor);
  if (alpha >= 1) return new Float32Array(frame);
  const a = Math.sqrt(1 - alpha);
  const b = Math.sqrt(alpha);
  const out = new Float32Array(anchor.length);
  for (let i = 0; i < anchor.length; i++) {
    out[i] = a * anchor[i] + b * frame[i];
  }
  return out;
}
function anchorWalkLatent(anchor, walkStart, walkEnd, frameIdx, frameCount, motionAmount) {
  const t = frameCount > 1 ? frameIdx / (frameCount - 1) : 0;
  const frameNoise = slerp(walkStart, walkEnd, t);
  return blendNoise(anchor, frameNoise, motionAmount);
}
function isAnchorRefreshFrame(keyframeIndex, interval) {
  if (!Number.isFinite(interval) || interval <= 0) return false;
  const k = Math.floor(interval);
  return keyframeIndex > 0 && keyframeIndex % k === 0;
}
function shiftLatent(latent, shape, dx, dy) {
  const { channels, height, width } = shape;
  if (latent.length !== channels * height * width) {
    throw new Error(
      `shiftLatent: length ${latent.length} doesn't match shape ${channels}x${height}x${width}=${channels * height * width}`
    );
  }
  if (dx === 0 && dy === 0) return new Float32Array(latent);
  const out = new Float32Array(latent.length);
  const idx = (c, y, x) => c * (height * width) + y * width + x;
  const clamp3 = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < height; y++) {
      const srcY = clamp3(y - dy, 0, height - 1);
      for (let x = 0; x < width; x++) {
        const srcX = clamp3(x - dx, 0, width - 1);
        out[idx(c, y, x)] = latent[idx(c, srcY, srcX)];
      }
    }
  }
  return out;
}
function scaleLatent(latent, shape, scale) {
  const { channels, height, width } = shape;
  if (latent.length !== channels * height * width) {
    throw new Error(
      `scaleLatent: length ${latent.length} doesn't match shape ${channels}x${height}x${width}=${channels * height * width}`
    );
  }
  if (scale === 1 || !Number.isFinite(scale) || scale <= 0) return new Float32Array(latent);
  const out = new Float32Array(latent.length);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const idx = (c, y, x) => c * (height * width) + y * width + x;
  const clamp3 = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < height; y++) {
      const srcYf = cy + (y - cy) / scale;
      const y0 = clamp3(Math.floor(srcYf), 0, height - 1);
      const y1 = clamp3(y0 + 1, 0, height - 1);
      const wy = srcYf - Math.floor(srcYf);
      for (let x = 0; x < width; x++) {
        const srcXf = cx + (x - cx) / scale;
        const x0 = clamp3(Math.floor(srcXf), 0, width - 1);
        const x1 = clamp3(x0 + 1, 0, width - 1);
        const wx = srcXf - Math.floor(srcXf);
        const top = latent[idx(c, y0, x0)] * (1 - wx) + latent[idx(c, y0, x1)] * wx;
        const bot = latent[idx(c, y1, x0)] * (1 - wx) + latent[idx(c, y1, x1)] * wx;
        out[idx(c, y, x)] = top * (1 - wy) + bot * wy;
      }
    }
  }
  return out;
}
function latentResidualBiasScale(mode, useImg2Img, img2imgNoiseScale) {
  if (mode !== "latent-residual") return 0;
  if (!useImg2Img) return 1;
  if (!Number.isFinite(img2imgNoiseScale) || img2imgNoiseScale <= 0) return 0;
  return Math.min(1, img2imgNoiseScale);
}
function applyToLatent(args) {
  const { ctx, latent } = args;
  const noiseScale = args.noiseScale ?? 1;
  if (ctx.strength <= 0 || noiseScale <= 0) return latent;
  const channels = 4;
  const spatial = latent.length / channels;
  const stateVec = projectState(ctx.state, channels);
  const out = new Float32Array(latent);
  for (let c = 0; c < channels; c++) {
    const bias = stateVec[c] * ctx.strength * noiseScale;
    const base = c * spatial;
    for (let i = 0; i < spatial; i++) {
      out[base + i] += bias;
    }
  }
  return out;
}
async function advanceState(state, input, opts = {}) {
  const decay = opts.decay ?? DEFAULT_SCAN_DECAY;
  const pooled = new Float32Array(state.channels);
  const stride = Math.max(1, Math.floor(input.length / state.channels));
  for (let c = 0; c < state.channels; c++) {
    let sum = 0;
    let count = 0;
    for (let i = c * stride; i < (c + 1) * stride && i < input.length; i++) {
      sum += input[i];
      count++;
    }
    pooled[c] = count > 0 ? sum / count : 0;
  }
  const next = await selectiveScanStep(
    {
      state: state.data,
      pooled,
      channels: state.channels,
      order: state.order,
      decay,
      gain: DEFAULT_SCAN_GAIN
    },
    opts.device
  );
  return {
    data: Array.from(next),
    dim: state.dim,
    order: state.order,
    channels: state.channels,
    step: state.step + 1
  };
}
function emptyState(opts) {
  return {
    data: new Array(opts.channels * opts.order).fill(0),
    dim: opts.dim,
    order: opts.order,
    channels: opts.channels,
    step: 0
  };
}
function mixIndex(i, dim, channels, order, targetDim) {
  const seed = i * 2654435761 ^ dim * 374761393 ^ channels * 1597334677 ^ order * 668265263;
  return Math.abs(seed) % targetDim;
}

// src/engine/motion-interpolator.ts
var CHANNELS = 3;
var FINE_RADIUS = 2;
function luma(rgb, width, height) {
  const n = width * height;
  if (rgb.length !== CHANNELS * n) {
    throw new Error(`luma: expected ${CHANNELS * n} values for ${width}x${height}, got ${rgb.length}`);
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = 0.299 * rgb[i] + 0.587 * rgb[n + i] + 0.114 * rgb[2 * n + i];
  }
  return out;
}
var clampInt = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
function downscale(plane, width, height, factor) {
  if (factor <= 1) return { data: plane, width, height };
  const w2 = Math.max(1, Math.floor(width / factor));
  const h2 = Math.max(1, Math.floor(height / factor));
  const out = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = 0; dy < factor; dy++) {
        const sy = y * factor + dy;
        if (sy >= height) break;
        for (let dx = 0; dx < factor; dx++) {
          const sx = x * factor + dx;
          if (sx >= width) break;
          sum += plane[sy * width + sx];
          count++;
        }
      }
      out[y * w2 + x] = count > 0 ? sum / count : 0;
    }
  }
  return { data: out, width: w2, height: h2 };
}
function blockSad(a, b, width, height, x0, y0, x1, y1, dx, dy) {
  let sad = 0;
  for (let y = y0; y < y1; y++) {
    const sy = clampInt(y + dy, 0, height - 1);
    for (let x = x0; x < x1; x++) {
      const sx = clampInt(x + dx, 0, width - 1);
      sad += Math.abs(a[y * width + x] - b[sy * width + sx]);
    }
  }
  return sad;
}
function searchBlock(a, b, width, height, x0, y0, x1, y1, predictDx, predictDy, radius) {
  let bestDx = predictDx;
  let bestDy = predictDy;
  let bestSad = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cdx = predictDx + dx;
      const cdy = predictDy + dy;
      const sad = blockSad(a, b, width, height, x0, y0, x1, y1, cdx, cdy);
      const better = sad < bestSad - 1e-6 || Math.abs(sad - bestSad) < 1e-6 && (cdx - predictDx) ** 2 + (cdy - predictDy) ** 2 < (bestDx - predictDx) ** 2 + (bestDy - predictDy) ** 2;
      if (better) {
        bestSad = sad;
        bestDx = cdx;
        bestDy = cdy;
      }
    }
  }
  return { dx: bestDx, dy: bestDy };
}
function parabolicOffset(sm1, s0, sp1) {
  if (s0 <= 1e-9) return 0;
  const denom = sm1 - 2 * s0 + sp1;
  if (Math.abs(denom) < 1e-9) return 0;
  const off = 0.5 * (sm1 - sp1) / denom;
  return off < -0.5 ? -0.5 : off > 0.5 ? 0.5 : off;
}
function estimateBlockMotion(a, b, width, height, opts = {}) {
  const blockSize = Math.max(4, Math.floor(opts.blockSize ?? 16));
  const searchRadius = Math.max(1, Math.floor(opts.searchRadius ?? 8));
  const levels = Math.max(1, Math.floor(opts.levels ?? 3));
  const la = luma(a, width, height);
  const lb = luma(b, width, height);
  const cols = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);
  const vec = new Float32Array(cols * rows * 2);
  const factor = 2 ** (levels - 1);
  const coarseA = downscale(la, width, height, factor);
  const coarseB = downscale(lb, width, height, factor);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * blockSize;
      const y0 = by * blockSize;
      const x1 = Math.min(x0 + blockSize, width);
      const y1 = Math.min(y0 + blockSize, height);
      let predictDx = 0;
      let predictDy = 0;
      if (factor > 1) {
        const cx0 = Math.floor(x0 / factor);
        const cy0 = Math.floor(y0 / factor);
        const cx1 = Math.max(cx0 + 1, Math.floor(x1 / factor));
        const cy1 = Math.max(cy0 + 1, Math.floor(y1 / factor));
        const coarse = searchBlock(
          coarseA.data,
          coarseB.data,
          coarseA.width,
          coarseA.height,
          cx0,
          cy0,
          cx1,
          cy1,
          0,
          0,
          searchRadius
        );
        predictDx = coarse.dx * factor;
        predictDy = coarse.dy * factor;
      } else {
        const full = searchBlock(la, lb, width, height, x0, y0, x1, y1, 0, 0, searchRadius);
        predictDx = full.dx;
        predictDy = full.dy;
      }
      const fine = searchBlock(la, lb, width, height, x0, y0, x1, y1, predictDx, predictDy, FINE_RADIUS);
      const s0 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx, fine.dy);
      const sxm1 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx - 1, fine.dy);
      const sxp1 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx + 1, fine.dy);
      const sym1 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx, fine.dy - 1);
      const syp1 = blockSad(la, lb, width, height, x0, y0, x1, y1, fine.dx, fine.dy + 1);
      const bi = (by * cols + bx) * 2;
      vec[bi] = fine.dx + parabolicOffset(sxm1, s0, sxp1);
      vec[bi + 1] = fine.dy + parabolicOffset(sym1, s0, syp1);
    }
  }
  return { blockSize, cols, rows, vec };
}
function sampleBilinear(plane, width, height, fx, fy) {
  const x0 = clampInt(Math.floor(fx), 0, width - 1);
  const x1 = clampInt(x0 + 1, 0, width - 1);
  const y0 = clampInt(Math.floor(fy), 0, height - 1);
  const y1 = clampInt(y0 + 1, 0, height - 1);
  const wx = fx - Math.floor(fx);
  const wy = fy - Math.floor(fy);
  const top = plane[y0 * width + x0] * (1 - wx) + plane[y0 * width + x1] * wx;
  const bot = plane[y1 * width + x0] * (1 - wx) + plane[y1 * width + x1] * wx;
  return top * (1 - wy) + bot * wy;
}
function interpolateFrames(a, b, width, height, t, field) {
  if (a.length !== b.length) {
    throw new Error(`interpolateFrames: length mismatch (${a.length} vs ${b.length})`);
  }
  const n = width * height;
  const out = new Float32Array(a.length);
  const { blockSize, cols } = field;
  for (let y = 0; y < height; y++) {
    const by = Math.min(Math.floor(y / blockSize), field.rows - 1);
    for (let x = 0; x < width; x++) {
      const bx = Math.min(Math.floor(x / blockSize), cols - 1);
      const bi = (by * cols + bx) * 2;
      const dx = field.vec[bi];
      const dy = field.vec[bi + 1];
      const ax = x - t * dx;
      const ay = y - t * dy;
      const bxs = x + (1 - t) * dx;
      const bys = y + (1 - t) * dy;
      for (let c = 0; c < CHANNELS; c++) {
        const pa = a.subarray(c * n, (c + 1) * n);
        const pb = b.subarray(c * n, (c + 1) * n);
        const va = sampleBilinear(pa, width, height, ax, ay);
        const vb = sampleBilinear(pb, width, height, bxs, bys);
        out[c * n + (y * width + x)] = (1 - t) * va + t * vb;
      }
    }
  }
  return out;
}

// src/engine/scene-planner.ts
import { BuilderforceClient } from "@seanhogg/builderforce-sdk";
var DEFAULT_PLANNER_MODEL = "googleai/gemini-2.5-flash";
var CAMERA_MOVES = [
  "static",
  "pan-left",
  "pan-right",
  "tilt-up",
  "tilt-down",
  "dolly-in",
  "dolly-out"
];
var DIRECTOR_SYSTEM = "You are a film director and character designer for an AI video generator. Given a short concept, produce (1) a one-paragraph visual treatment describing tone, setting, lighting and arc, and (2) a character bible: for each distinct character, a LOCKED visual description (age, build, hair, wardrobe, colour palette) that must stay identical across every shot. Keep each appearance under 200 characters and concrete (a diffusion model reads it verbatim). Output only JSON matching the schema.";
var SHOT_PLANNER_SYSTEM = "You are a storyboard and shot planner for an AI video generator. Given a treatment and character bible, break the scene into a sequence of shots. For each shot write a single detailed diffusion prompt (subject, environment, lighting, palette, camera angle, visual style) WITHOUT restating character appearance \u2014 reference characters by id in characterIds and the engine appends their locked description. Pick one camera move per shot from the allowed list. Size each shot's frame budget so the totals sum to the requested total. Output only JSON matching the schema.";
var DIRECTOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["treatment", "characters"],
  properties: {
    treatment: { type: "string" },
    characters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "appearance"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          appearance: { type: "string" }
        }
      }
    }
  }
};
var SHOT_PLANNER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["shots"],
  properties: {
    shots: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "prompt", "characterIds", "camera", "action", "durationFrames"],
        properties: {
          id: { type: "string" },
          prompt: { type: "string" },
          characterIds: { type: "array", items: { type: "string" } },
          camera: { type: "string", enum: [...CAMERA_MOVES] },
          action: { type: "string" },
          durationFrames: { type: "integer", minimum: 1 }
        }
      }
    }
  }
};
async function planScene(opts, client) {
  const c = client ?? new BuilderforceClient({ apiKey: opts.apiKey, baseUrl: opts.baseUrl });
  const model = opts.plannerModel ?? DEFAULT_PLANNER_MODEL;
  const director = await directorPass(c, model, opts);
  const planner = await shotPlannerPass(c, model, opts, director);
  const shots = normaliseShotBudget(
    sanitiseShots(planner.shots, director.characters),
    opts.totalFrames,
    opts.request
  );
  return {
    treatment: director.treatment,
    characters: director.characters,
    shots
  };
}
async function directorPass(client, model, opts) {
  const parsed = await structuredCall(client, {
    model,
    system: DIRECTOR_SYSTEM,
    user: `Concept: ${opts.request}
Target length: ${opts.totalFrames} frames.`,
    schemaName: "director",
    schema: DIRECTOR_SCHEMA,
    signal: opts.signal
  });
  return {
    treatment: typeof parsed?.treatment === "string" ? parsed.treatment : opts.request,
    characters: Array.isArray(parsed?.characters) ? parsed.characters : []
  };
}
async function shotPlannerPass(client, model, opts, director) {
  const characterList = director.characters.map((ch) => `${ch.id} (${ch.name}): ${ch.appearance}`).join("\n");
  const parsed = await structuredCall(client, {
    model,
    system: SHOT_PLANNER_SYSTEM,
    user: `Treatment: ${director.treatment}

Characters:
${characterList || "(none)"}

Allowed camera moves: ${CAMERA_MOVES.join(", ")}
Distribute exactly ${opts.totalFrames} frames across the shots.`,
    schemaName: "shot_planner",
    schema: SHOT_PLANNER_SCHEMA,
    signal: opts.signal
  });
  return { shots: Array.isArray(parsed?.shots) ? parsed.shots : [] };
}
function cameraMoveToMotion(move) {
  switch (move) {
    case "pan-left":
      return { cameraMotion: { dx: -1, dy: 0 }, imgToImgStrength: 0.6 };
    case "pan-right":
      return { cameraMotion: { dx: 1, dy: 0 }, imgToImgStrength: 0.6 };
    case "tilt-up":
      return { cameraMotion: { dx: 0, dy: -1 }, imgToImgStrength: 0.6 };
    case "tilt-down":
      return { cameraMotion: { dx: 0, dy: 1 }, imgToImgStrength: 0.6 };
    case "dolly-in":
      return { cameraMotion: { dx: 0, dy: 0, zoom: 1.04 }, imgToImgStrength: 0.55 };
    case "dolly-out":
      return { cameraMotion: { dx: 0, dy: 0, zoom: 1 / 1.04 }, imgToImgStrength: 0.55 };
    case "static":
    default:
      return { imgToImgStrength: 0 };
  }
}
function composeShotPrompt(shot, characters) {
  const byId = new Map(characters.map((ch) => [ch.id, ch]));
  const appearances = shot.characterIds.map((id) => byId.get(id)).filter((ch) => Boolean(ch)).map((ch) => `${ch.name}: ${ch.appearance}`);
  if (appearances.length === 0) return shot.prompt;
  return `${shot.prompt}. ${appearances.join(". ")}`;
}
function storyboardFrameCount(storyboard) {
  return storyboard.shots.reduce((sum, s) => sum + s.durationFrames, 0);
}
function sanitiseShots(shots, characters) {
  const validIds = new Set(characters.map((c) => c.id));
  return shots.filter((s) => s && typeof s.prompt === "string" && s.prompt.trim().length > 0).map((s, i) => ({
    id: typeof s.id === "string" && s.id ? s.id : `shot-${i + 1}`,
    prompt: s.prompt.trim(),
    characterIds: Array.isArray(s.characterIds) ? s.characterIds.filter((id) => validIds.has(id)) : [],
    camera: CAMERA_MOVES.includes(s.camera) ? s.camera : "static",
    action: typeof s.action === "string" ? s.action : "",
    durationFrames: Number.isFinite(s.durationFrames) && s.durationFrames > 0 ? Math.floor(s.durationFrames) : 1
  }));
}
function normaliseShotBudget(shots, total, fallbackPrompt = "") {
  const target = Math.max(1, Math.floor(total));
  if (shots.length === 0) {
    return [
      {
        id: "shot-1",
        prompt: fallbackPrompt,
        characterIds: [],
        camera: "static",
        action: "",
        durationFrames: target
      }
    ];
  }
  const sum = shots.reduce((acc, s) => acc + s.durationFrames, 0) || shots.length;
  let allocated = 0;
  const out = shots.map((s, i) => {
    const frames = i === shots.length - 1 ? Math.max(1, target - allocated) : Math.max(1, Math.round(s.durationFrames / sum * target));
    allocated += frames;
    return { ...s, durationFrames: frames };
  });
  return out;
}
async function structuredCall(client, args) {
  let completion;
  try {
    completion = await client.chat.completions.create({
      model: args.model,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: args.schemaName, schema: args.schema, strict: true }
      },
      temperature: 0.7,
      max_tokens: 1500,
      signal: args.signal
    });
  } catch (err) {
    if (args.signal?.aborted || err?.name === "AbortError") throw err;
    return null;
  }
  const text = completion.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// src/engine/frame-validator.ts
import { BuilderforceClient as BuilderforceClient2 } from "@seanhogg/builderforce-sdk";
var DEFAULT_VALIDATOR_MODEL = "googleai/gemini-2.5-flash";
var DEFAULT_PASS_THRESHOLD = 0.6;
var ISSUE_KINDS = [
  "character-drift",
  "continuity",
  "prompt-mismatch",
  "artifact",
  "other"
];
var VALIDATOR_SYSTEM = "You are a strict continuity supervisor for AI-generated video frames. You are shown one frame plus the description of what it should depict and the locked appearance of any characters. Judge how well the frame matches. Report a score from 0 (wrong) to 1 (perfect) and list concrete issues: character-drift (a character looks different from their locked description), continuity, prompt-mismatch (frame ignores the described subject/action), artifact (melted faces, extra limbs, garbled text), or other. Output only JSON.";
var VALIDATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "issues"],
  properties: {
    score: { type: "number", minimum: 0, maximum: 1 },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "detail"],
        properties: {
          kind: { type: "string", enum: [...ISSUE_KINDS] },
          detail: { type: "string" }
        }
      }
    }
  }
};
async function validateFrame(opts, client) {
  const threshold = opts.passThreshold ?? DEFAULT_PASS_THRESHOLD;
  const characterBlock = opts.characters && opts.characters.length > 0 ? `Characters that must appear exactly as described:
` + opts.characters.map((c) => `- ${c.name}: ${c.appearance}`).join("\n") : "No specific characters to verify.";
  try {
    const c = client ?? new BuilderforceClient2({ apiKey: opts.apiKey, baseUrl: opts.baseUrl });
    const completion = await c.chat.completions.create({
      model: opts.validatorModel ?? DEFAULT_VALIDATOR_MODEL,
      messages: [
        { role: "system", content: VALIDATOR_SYSTEM },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Shot description: ${opts.shotDescription}

${characterBlock}`
            },
            { type: "image_url", image_url: { url: opts.frameDataUrl, detail: "low" } }
          ]
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "frame_validation", schema: VALIDATION_SCHEMA, strict: true }
      },
      temperature: 0,
      max_tokens: 600,
      signal: opts.signal
    });
    const text = completion.choices?.[0]?.message?.content;
    const verdict = parseVerdict(typeof text === "string" ? text : null);
    if (!verdict) return permissive();
    return { ok: verdict.score >= threshold, score: verdict.score, issues: verdict.issues };
  } catch {
    return permissive();
  }
}
function permissive() {
  return { ok: true, score: 1, issues: [] };
}
function parseVerdict(text) {
  if (!text) return null;
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      obj = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj;
  const score = typeof rec.score === "number" ? clamp014(rec.score) : null;
  if (score === null) return null;
  const issues = Array.isArray(rec.issues) ? rec.issues.filter((i) => Boolean(i) && typeof i === "object").map((i) => ({
    kind: ISSUE_KINDS.includes(i.kind) ? i.kind : "other",
    detail: typeof i.detail === "string" ? i.detail : ""
  })) : [];
  return { score, issues };
}
function clamp014(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// src/engine/llm-bridge.ts
import { BuilderforceClient as BuilderforceClient3 } from "@seanhogg/builderforce-sdk";
var SYSTEM_PROMPT = 'You are a visual prompt engineer for a text-to-video diffusion model. Rewrite the user prompt into a single detailed paragraph optimized for a Stable Diffusion-class image model. Include: subject, action, environment, lighting, colour palette, camera angle, and a visual style descriptor (e.g. cinematic, anime, photoreal). Do not use newlines. Do not preface with "Here is" or any meta-commentary \u2014 output only the rewritten prompt. Keep it under 220 characters.';
async function expandPrompt(opts) {
  const client = new BuilderforceClient3({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl
  });
  let completion;
  try {
    completion = await client.chat.completions.create({
      // Explicit lightweight model — the gateway still failovers across the
      // cascade if this is cooled, but we avoid relying on undocumented
      // "unknown id → substitute" behaviour that a future strict-pin mode
      // would break. Override via `promptModel` if a different model is wanted.
      model: opts.promptModel ?? "googleai/gemini-2.5-flash-lite",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: opts.prompt }
      ],
      max_tokens: 200,
      temperature: 0.7,
      // Was accepted but never forwarded — a cancelled generation left this call
      // running and its result was silently discarded.
      signal: opts.signal
    });
  } catch (err) {
    if (opts.signal?.aborted || err?.name === "AbortError") throw err;
    return opts.prompt;
  }
  const text = completion.choices?.[0]?.message?.content?.trim();
  if (!text) {
    return opts.prompt;
  }
  return text;
}

// src/engine/webcodecs-muxer.ts
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "mp4-muxer";
var AVC_CODEC_CANDIDATES = [
  "avc1.42001f",
  "avc1.42E01E",
  "avc1.4D401F",
  "avc1.640028"
];
function resolveProbe(probe) {
  if (probe) return probe;
  return typeof VideoEncoder !== "undefined" && typeof VideoEncoder.isConfigSupported === "function" ? VideoEncoder : void 0;
}
async function firstSupportedCodec(candidates, opts, probe) {
  for (const codec of candidates) {
    try {
      const res = await probe.isConfigSupported({
        codec,
        width: opts.width,
        height: opts.height,
        bitrate: opts.bitrate ?? 2e6,
        framerate: opts.fps
      });
      if (res?.supported) return codec;
    } catch {
    }
  }
  return null;
}
var VP9_CODEC_CANDIDATES = ["vp09.00.10.08", "vp09.00.31.08"];
var VP8_CODEC_CANDIDATES = ["vp8"];
var ENCODING_TABLE = [
  {
    container: "mp4",
    mimeType: "video/mp4",
    extension: "mp4",
    codecs: AVC_CODEC_CANDIDATES,
    async createMuxer(_codec, opts) {
      const muxer = new Mp4Muxer({
        target: new Mp4Target(),
        video: { codec: "avc", width: opts.width, height: opts.height, frameRate: opts.fps },
        fastStart: "in-memory"
      });
      return {
        addVideoChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        finalize: () => {
          muxer.finalize();
          return muxer.target.buffer;
        }
      };
    }
  },
  {
    container: "webm",
    mimeType: "video/webm",
    extension: "webm",
    codecs: VP9_CODEC_CANDIDATES,
    createMuxer: (_codec, opts) => createWebmMuxer("V_VP9", opts)
  },
  {
    container: "webm",
    mimeType: "video/webm",
    extension: "webm",
    codecs: VP8_CODEC_CANDIDATES,
    createMuxer: (_codec, opts) => createWebmMuxer("V_VP8", opts)
  }
];
async function createWebmMuxer(codec, opts) {
  const { Muxer, ArrayBufferTarget } = await import("webm-muxer");
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec, width: opts.width, height: opts.height, frameRate: opts.fps }
  });
  return {
    addVideoChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    finalize: () => {
      muxer.finalize();
      return muxer.target.buffer;
    }
  };
}
async function selectVideoEncoding(opts, probe, table = ENCODING_TABLE) {
  const probeImpl = resolveProbe(probe);
  if (!probeImpl) return { row: table[0], codec: table[0].codecs[0] };
  for (const row of table) {
    const codec = await firstSupportedCodec(row.codecs, opts, probeImpl);
    if (codec !== null) return { row, codec };
  }
  return null;
}
var UnsupportedVideoEncodingError = class extends Error {
  constructor() {
    super(
      "This browser has no supported video encode configuration (tried H.264/MP4, VP9/WebM and VP8/WebM). Use a current Chrome, Edge, Safari or Firefox to export video."
    );
    this.name = "UnsupportedVideoEncodingError";
  }
};
function videoExtensionForMime(mimeType) {
  return ENCODING_TABLE.find((r) => r.mimeType === mimeType.split(";")[0].trim())?.extension ?? "mp4";
}
async function muxFramesToVideo(frames, opts) {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("WebCodecs VideoEncoder is not available in this browser");
  }
  const selected = await selectVideoEncoding(opts);
  if (selected === null) throw new UnsupportedVideoEncodingError();
  const { row, codec } = selected;
  const muxer = await row.createMuxer(codec, opts);
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      throw err;
    }
  });
  encoder.configure({
    codec,
    width: opts.width,
    height: opts.height,
    bitrate: opts.bitrate ?? 2e6,
    framerate: opts.fps
  });
  const microsPerFrame = Math.round(1e6 / opts.fps);
  for (let i = 0; i < frames.length; i++) {
    if (opts.signal?.aborted) {
      encoder.close();
      throw new DOMException("Mux aborted", "AbortError");
    }
    const bitmap = await frameToImageBitmap(frames[i], opts.width, opts.height);
    const videoFrame = new VideoFrame(bitmap, {
      timestamp: i * microsPerFrame,
      duration: microsPerFrame
    });
    encoder.encode(videoFrame, { keyFrame: i === 0 });
    videoFrame.close();
    bitmap.close();
  }
  await encoder.flush();
  encoder.close();
  const buffer = muxer.finalize();
  return {
    blob: new Blob([buffer], { type: row.mimeType }),
    mimeType: row.mimeType,
    extension: row.extension
  };
}
async function frameToImageBitmap(frame, width, height) {
  const imageData = new ImageData(
    frame.rgba,
    width,
    height
  );
  return createImageBitmap(imageData);
}
function pixelsToRgba(pixels, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  const channelSize = width * height;
  for (let i = 0; i < channelSize; i++) {
    const r = pixels[0 * channelSize + i];
    const g = pixels[1 * channelSize + i];
    const b = pixels[2 * channelSize + i];
    out[i * 4 + 0] = clamp2((r + 1) * 127.5);
    out[i * 4 + 1] = clamp2((g + 1) * 127.5);
    out[i * 4 + 2] = clamp2((b + 1) * 127.5);
    out[i * 4 + 3] = 255;
  }
  return out;
}
function clamp2(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

// src/engine/webdit-engine.ts
var WEBDIT_WEIGHT_SOURCES = ["r2-proxy"];
async function loadWebDitBundle(descriptor, opts) {
  if (!descriptor.available || !descriptor.bundleUrl) {
    throw new Error(
      `loadWebDitBundle: '${descriptor.id}' has no bundle uploaded yet (available: ${descriptor.available}, bundleUrl: ${descriptor.bundleUrl}). See the ROADMAP webdit gap-register entry.`
    );
  }
  const bundleUrl = descriptor.bundleUrl;
  const weightSources = opts.weightSources ?? WEBDIT_WEIGHT_SOURCES;
  const onProgress = opts.onProgress;
  configureOnnxRuntime();
  await configureWebGpuOrt();
  const fetchBundleFile = (relPath) => getOrFetchWeight({
    cacheKey: `webdit/${descriptor.architecture}/${relPath}`,
    // getOrFetchWeight's FetchOptions always require an hfRepo/hfPath pair
    // (its huggingface-cdn fallback source), but webdit bundles have no HF
    // fallback repo — WEBDIT_WEIGHT_SOURCES omits 'huggingface-cdn' so this
    // pair is never actually dereferenced; it's supplied only to satisfy
    // the shared cache function's signature.
    hfRepo: descriptor.architecture,
    hfPath: relPath,
    sources: weightSources,
    apiKey: opts.apiKey,
    r2Base: bundleUrl
    // Note: getOrFetchWeight's onProgress reports raw bytes-loaded/total for
    // ONE file's download, not the label-string phase progress this module
    // reports via reportProgress (one line per file, above/below each
    // fetchBundleFile call) — the two aren't the same shape, so this isn't
    // wired to `opts.onProgress` here.
  });
  reportProgress(`Loading WebDiT manifest for ${descriptor.id}\u2026`, onProgress);
  const manifestBuf = await fetchBundleFile("manifest.json");
  const manifest = JSON.parse(new TextDecoder().decode(manifestBuf));
  const relPaths = collectBundleFilePaths(manifest);
  const files = {};
  for (const rel of relPaths) {
    reportProgress(`Downloading webdit/${descriptor.architecture}/${rel}\u2026`, onProgress);
    files[rel] = await fetchBundleFile(rel);
  }
  reportProgress(`Building WebDiT bundle (${manifest.backend} backend)\u2026`, onProgress);
  const { loadBundleFromBuffers } = await import("./webdit-runtime-6GWL2ZAT.mjs");
  const bundle = await loadBundleFromBuffers(manifest, files);
  reportProgress(`WebDiT bundle ready \u2014 ${descriptor.id} (${manifest.architecture}).`, onProgress);
  return bundle;
}
function collectBundleFilePaths(manifest) {
  const paths = [
    manifest.files.ditGraph,
    ...manifest.files.ditWeightShards,
    manifest.files.textEncoderGraph,
    manifest.files.textEncoderWeights,
    manifest.files.vaeGraph,
    manifest.files.vaeWeights
  ];
  for (const rel of [
    manifest.files.ditGraphData,
    manifest.files.textEncoderGraphData,
    manifest.files.vaeGraphData
  ]) {
    if (rel) paths.push(rel);
  }
  if (manifest.backend === "ort") {
    const dir = manifest.files.tokenizer.endsWith("/") ? manifest.files.tokenizer : `${manifest.files.tokenizer}/`;
    paths.push(`${dir}tokenizer.json`, `${dir}tokenizer_config.json`);
  }
  return paths;
}
async function runWebDitDenoise(bundle, args) {
  const { runDenoiseLoop } = await import("./webdit-runtime-6GWL2ZAT.mjs");
  const onProgress = args.onProgress;
  const frameOffset = args.frameOffset ?? 0;
  reportProgress("Running WebDiT denoise loop\u2026", onProgress);
  const result = await runDenoiseLoop(bundle, {
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    frames: args.frames,
    height: args.height,
    width: args.width,
    steps: args.steps,
    guidanceScale: args.guidance,
    seed: args.seed,
    onProgress: (step, total) => reportProgress(`WebDiT denoise step ${step}/${total}\u2026`, onProgress)
  });
  const frames = new Array(result.frames.length);
  const muxFrames = new Array(result.frames.length);
  for (let i = 0; i < result.frames.length; i++) {
    throwIfAborted(args.signal);
    const rgba = result.frames[i];
    const bitmap = await createImageBitmap(
      new ImageData(rgba, result.width, result.height)
    );
    frames[i] = bitmap;
    muxFrames[i] = { rgba };
    args.onFrame?.(frameOffset + i, bitmap, args.mambaState);
  }
  return { frames, muxFrames, width: result.width, height: result.height };
}
async function generateWebDitClip(bundle, args) {
  const start = performance.now();
  const { frames, muxFrames, width, height } = await runWebDitDenoise(bundle, args);
  reportProgress(`Encoding ${frames.length} frames to MP4\u2026`, args.onProgress);
  const { blob } = await muxFramesToVideo(muxFrames, {
    width,
    height,
    fps: args.fps,
    signal: args.signal
  });
  reportProgress("MP4 ready.", args.onProgress);
  return {
    blob,
    // No-op passthrough — see RunWebDitDenoiseArgs.mambaState.
    mambaState: args.mambaState,
    frames,
    activeDevice: "webgpu",
    resolvedPrompt: args.prompt,
    elapsedMs: performance.now() - start
  };
}

// src/engine/video-engine.ts
var DEFAULT_WIDTH = 512;
var DEFAULT_HEIGHT = 512;
var DEFAULT_COHERENCE = "prompt-bias";
var DEFAULT_COHERENCE_STRENGTH = 0.5;
var DEFAULT_MOTION_AMOUNT = 0.15;
var DEFAULT_REFINEMENT_STRENGTH = 0.4;
var VideoEngine = class _VideoEngine {
  constructor(opts, diffusion, mambaState, activeDevice, probed, engineKind, webditBundle, lcmResidency) {
    this.opts = opts;
    this.diffusion = diffusion;
    this.mambaState = mambaState;
    this.activeDevice = activeDevice;
    this.engineKind = engineKind;
    this.webditBundle = webditBundle;
    this.lcmResidency = lcmResidency;
    this.probed = probed;
  }
  opts;
  diffusion;
  mambaState;
  activeDevice;
  engineKind;
  webditBundle;
  lcmResidency;
  /** The probed device this instance runs on (its GPUDevice runs the Mamba
   *  state advance). The refinement-pass engine is built on the same target by
   *  `lcmResidency.createEngine` — the two-pass quality chain (draft model →
   *  dispose → refinement model) is lcm-diffusion only (cross-family
   *  refinement is rejected in `create()` before either engine is built). */
  probed;
  /**
   * Construct an engine bound to the host's best available hardware. Returns
   * `null` when no device path is viable — the consumer should render an
   * unsupported state rather than try to recover.
   */
  static async create(options) {
    const descriptor = MODEL_REGISTRY[options.model];
    if (options.refinementModel) {
      const refinementDescriptor = MODEL_REGISTRY[options.refinementModel];
      if (refinementDescriptor.engine !== descriptor.engine) {
        throw new Error(
          `refinementModel '${options.refinementModel}' (engine: ${refinementDescriptor.engine}) cannot refine model '${options.model}' (engine: ${descriptor.engine}) \u2014 refinement requires both models to belong to the same generation engine.`
        );
      }
    }
    if (descriptor.engine === "webdit-dit") {
      return _VideoEngine.createWebDit(options, descriptor);
    }
    reportProgress(`Probing hardware (target: ${options.device ?? "auto"})\u2026`, options.onProgress);
    const probed = await probeDevice(options.device ?? "auto");
    if (!probed) return null;
    reportProgress(`Hardware ready: ${probed.label} (${probed.kind}).`, options.onProgress);
    const width = options.width ?? DEFAULT_WIDTH;
    const height = options.height ?? DEFAULT_HEIGHT;
    const weightSources = options.weightSources ?? DEFAULT_WEIGHT_SOURCES;
    const { model, refinementModel, apiKey } = options;
    const r2Base = deriveR2Base(options.baseUrl);
    const residency = new LcmResidency({ probed, model, refinementModel, apiKey, weightSources, r2Base });
    const diffusion = residency.createEngine(options.model, { width, height, onProgress: options.onProgress });
    await diffusion.init();
    residency.prefetchRefinement();
    const state = options.mambaState ?? emptyState({ dim: 64, order: 4, channels: 16 });
    return new _VideoEngine(
      { ...options, weightSources, width, height },
      diffusion,
      state,
      probed.kind,
      probed,
      "lcm-diffusion",
      null,
      residency
    );
  }
  /**
   * webdit-dit construction path. webdit's ORT execution is WebGPU-only (no
   * CPU/WebNN fallback exists in `@webdit/runtime`), so this probes WebGPU
   * specifically rather than `options.device ?? 'auto'`. Returns `null` (the
   * same "consumer never computes its own can-run check" contract as the
   * lcm-diffusion path) both when WebGPU is unavailable AND when the model
   * has no bundle to load yet (`available: false` / `bundleUrl: null` — the
   * expected state for all 4 webdit models until an operator uploads a real
   * bundle; see the ROADMAP entry).
   */
  static async createWebDit(options, descriptor) {
    reportProgress("Probing hardware (WebDiT requires WebGPU \u2014 no CPU/WebNN fallback)\u2026", options.onProgress);
    const probed = await probeDevice("webgpu");
    if (!probed) return null;
    if (!descriptor.available || !descriptor.bundleUrl) {
      reportProgress(
        `Model '${descriptor.id}' has no bundle uploaded yet (available: false) \u2014 cannot load.`,
        options.onProgress
      );
      return null;
    }
    const width = options.width ?? DEFAULT_WIDTH;
    const height = options.height ?? DEFAULT_HEIGHT;
    const weightSources = options.weightSources ?? DEFAULT_WEIGHT_SOURCES;
    const bundle = await loadWebDitBundle(descriptor, {
      apiKey: options.apiKey,
      weightSources,
      onProgress: options.onProgress
    });
    const state = options.mambaState ?? emptyState({ dim: 64, order: 4, channels: 16 });
    return new _VideoEngine(
      { ...options, weightSources, width, height },
      null,
      state,
      probed.kind,
      probed,
      "webdit-dit",
      bundle,
      null
    );
  }
  /**
   * Generate one video clip. Per-keyframe work is sequential (keyframes depend
   * on the previous keyframe's Mamba state). With `interpolationFactor > 1`,
   * only keyframes run the diffusion denoise loop and the frames between them
   * are slerp-interpolated in latent space (one cheap VAE decode each). Returns
   * the muxed MP4 plus the updated state.
   */
  generate(args) {
    return this.whileBusy(() => this.runGenerate(args));
  }
  async runGenerate(args) {
    const start = performance.now();
    const descriptor = MODEL_REGISTRY[this.opts.model];
    const steps = args.steps ?? descriptor.defaultSteps;
    const guidance = args.guidance ?? descriptor.defaultGuidance;
    const seed = args.seed ?? Date.now();
    const width = this.opts.width ?? DEFAULT_WIDTH;
    const height = this.opts.height ?? DEFAULT_HEIGHT;
    const onProgress = args.onProgress;
    if (!args.skipPromptExpansion) {
      reportProgress("Expanding prompt via Builderforce LLM gateway\u2026", onProgress);
    }
    const resolvedPrompt = args.skipPromptExpansion ? args.prompt : await expandPrompt({
      apiKey: this.opts.apiKey,
      baseUrl: this.opts.baseUrl,
      promptModel: this.opts.promptModel,
      prompt: args.prompt,
      signal: args.signal
    });
    args.onPromptExpanded?.(resolvedPrompt);
    if (this.engineKind === "webdit-dit") {
      reportProgress("Generating via WebDiT diffusion-transformer engine\u2026", onProgress);
      const result = await generateWebDitClip(this.webditBundle, {
        prompt: resolvedPrompt,
        negativePrompt: args.negativePrompt,
        frames: args.frames,
        fps: args.fps,
        steps,
        guidance,
        seed,
        width,
        height,
        mambaState: this.mambaState,
        onProgress,
        onFrame: args.onFrame,
        signal: args.signal
      });
      return { ...result, elapsedMs: performance.now() - start };
    }
    if (descriptor.engine !== "lcm-diffusion") {
      throw new Error(`VideoEngine.generate: unexpected engine '${descriptor.engine}' for model '${this.opts.model}'.`);
    }
    const coherenceMode = args.coherence ?? DEFAULT_COHERENCE;
    const coherenceStrength = args.coherenceStrength ?? DEFAULT_COHERENCE_STRENGTH;
    reportProgress("Encoding prompt with CLIP text encoder\u2026", onProgress);
    const promptEmbedding = await this.lcmDiffusion.embedPrompt(resolvedPrompt);
    const negativeEmbedding = args.negativePrompt ? await this.lcmDiffusion.embedPrompt(args.negativePrompt) : null;
    const clip = await this.produceClip({
      frameCount: args.frames,
      promptEmbedding,
      negativeEmbedding,
      timesteps: trimTimesteps(descriptor.defaultTimesteps, steps),
      guidance,
      coherenceMode,
      coherenceStrength,
      seed,
      motionAmount: clamp015(args.motionAmount ?? DEFAULT_MOTION_AMOUNT),
      imgToImgStrength: clamp015(args.imgToImgStrength ?? 0),
      anchorRefreshInterval: normaliseRefreshInterval(args.anchorRefreshInterval),
      cameraMotion: args.cameraMotion,
      interpolationFactor: normaliseFactor(args.interpolationFactor),
      interpolationBackend: args.interpolationBackend ?? "latent-slerp",
      width,
      height,
      label: "Frame",
      frameOffset: 0,
      onProgress,
      onFrame: args.onFrame,
      signal: args.signal
    });
    let refined = null;
    if (this.opts.refinementModel && this.opts.refinementModel !== this.opts.model) {
      refined = await this.refinementPass(clip, {
        resolvedPrompt,
        seed,
        width,
        height,
        refinementStrength: clamp015(args.refinementStrength ?? DEFAULT_REFINEMENT_STRENGTH),
        onProgress,
        onFrame: args.onFrame,
        signal: args.signal
      });
    }
    const finalFrames = refined?.frames ?? clip.frames;
    const finalMuxFrames = refined?.muxFrames ?? clip.muxFrames;
    reportProgress(`Encoding ${finalFrames.length} frames to MP4\u2026`, onProgress);
    const { blob } = await muxFramesToVideo(finalMuxFrames, {
      width,
      height,
      fps: args.fps,
      signal: args.signal
    });
    reportProgress("MP4 ready.", onProgress);
    return {
      blob,
      mambaState: this.mambaState,
      frames: finalFrames,
      activeDevice: this.activeDevice,
      resolvedPrompt,
      elapsedMs: performance.now() - start
    };
  }
  /**
   * Render a full storyboard (the Director / Shot-Planner output) into one MP4.
   * Each shot is generated as its own clip — the shot's composed prompt (shot
   * text + locked character appearances) is embedded fresh, the camera move is
   * mapped to latent motion + img2img recursion, and the Mamba state is carried
   * ACROSS shots so the SSM memory threads continuity through the whole scene.
   * When `validate` is set, each shot's first keyframe is checked by the VLM
   * frame validator (advisory — never blocks generation).
   */
  generateStoryboard(args) {
    return this.whileBusy(() => this.runStoryboard(args));
  }
  /** Generation marks the engine busy, so the refinement weight warm yields to it. */
  whileBusy(work) {
    return this.lcmResidency ? this.lcmResidency.run(work) : work();
  }
  async runStoryboard(args) {
    const start = performance.now();
    const descriptor = MODEL_REGISTRY[this.opts.model];
    const width = this.opts.width ?? DEFAULT_WIDTH;
    const height = this.opts.height ?? DEFAULT_HEIGHT;
    const onProgress = args.onProgress;
    if (this.engineKind === "webdit-dit") {
      if (descriptor.engine !== "webdit-dit") {
        throw new Error(
          `VideoEngine.generateStoryboard: engineKind/descriptor mismatch for '${this.opts.model}'.`
        );
      }
      return this.generateWebDitStoryboard(args, descriptor, width, height, onProgress, start);
    }
    if (descriptor.engine !== "lcm-diffusion") {
      throw new Error(
        `VideoEngine.generateStoryboard: unexpected engine '${descriptor.engine}' for model '${this.opts.model}'.`
      );
    }
    const steps = args.steps ?? descriptor.defaultSteps;
    const guidance = args.guidance ?? descriptor.defaultGuidance;
    const coherenceMode = args.coherence ?? DEFAULT_COHERENCE;
    const coherenceStrength = args.coherenceStrength ?? DEFAULT_COHERENCE_STRENGTH;
    const seedBase = args.seed ?? Date.now();
    const interpolationFactor = normaliseFactor(args.interpolationFactor);
    const timesteps = trimTimesteps(descriptor.defaultTimesteps, steps);
    const { storyboard } = args;
    const allFrames = [];
    const allMuxFrames = [];
    let allLatents = [];
    const validations = [];
    const maxRetries = args.validate ? Math.max(0, Math.floor(args.maxValidationRetries ?? 1)) : 0;
    let globalIdx = 0;
    for (let s = 0; s < storyboard.shots.length; s++) {
      throwIfAborted(args.signal);
      const shot = storyboard.shots[s];
      const shotPrompt = composeShotPrompt(shot, storyboard.characters);
      reportProgress(
        `Shot ${s + 1}/${storyboard.shots.length} (${shot.camera}, ${shot.durationFrames}f): ${shotPrompt}`,
        onProgress
      );
      const shotEmbedding = await this.lcmDiffusion.embedPrompt(shotPrompt);
      const { clip, validation } = await this.renderShot({
        shot,
        characters: storyboard.characters,
        shotEmbedding,
        shotIndex: s,
        shotCount: storyboard.shots.length,
        baseSeed: seedBase + s * 100003,
        timesteps,
        guidance,
        coherenceMode,
        coherenceStrength,
        motionAmount: clamp015(args.motionAmount ?? DEFAULT_MOTION_AMOUNT),
        interpolationFactor,
        interpolationBackend: args.interpolationBackend ?? "latent-slerp",
        width,
        height,
        frameOffset: globalIdx,
        validate: Boolean(args.validate),
        validatorModel: args.validatorModel,
        passThreshold: args.passThreshold,
        maxRetries,
        onProgress,
        onFrame: args.onFrame,
        signal: args.signal
      });
      if (validation) {
        validations.push({ shotId: shot.id, frameIndex: globalIdx, validation });
      }
      allFrames.push(...clip.frames);
      allMuxFrames.push(...clip.muxFrames);
      allLatents.push(...clip.latents);
      globalIdx += clip.frames.length;
      args.onShot?.(s, shot, validation);
    }
    let finalFrames = allFrames;
    let finalMuxFrames = allMuxFrames;
    if (this.opts.refinementModel && this.opts.refinementModel !== this.opts.model) {
      const refined = await this.refinementPass(
        { frames: allFrames, muxFrames: allMuxFrames, latents: allLatents },
        {
          resolvedPrompt: storyboard.treatment,
          seed: seedBase,
          width,
          height,
          refinementStrength: clamp015(DEFAULT_REFINEMENT_STRENGTH),
          onProgress,
          onFrame: args.onFrame,
          signal: args.signal
        }
      );
      finalFrames = refined.frames;
      finalMuxFrames = refined.muxFrames;
      allLatents = refined.latents;
    }
    reportProgress(`Encoding ${finalFrames.length} frames to MP4\u2026`, onProgress);
    const { blob } = await muxFramesToVideo(finalMuxFrames, {
      width,
      height,
      fps: args.fps,
      signal: args.signal
    });
    reportProgress("MP4 ready.", onProgress);
    return {
      blob,
      mambaState: this.mambaState,
      frames: finalFrames,
      activeDevice: this.activeDevice,
      storyboard,
      validations,
      elapsedMs: performance.now() - start
    };
  }
  /**
   * webdit-dit storyboard rendering. Each shot is generated independently via
   * `runWebDitDenoise` (no cross-shot Mamba carry — webdit's DiT models are
   * video-native and already model temporal coherence WITHIN a shot; the
   * lcm-diffusion path's cross-shot continuity mechanism, threading Mamba
   * state through `cameraMotion`/img2img recursion, is specific to that
   * per-frame pipeline and has no webdit equivalent), then every shot's
   * frames are concatenated in shot order and muxed ONCE at the end — the
   * same overall "loop shots, concat, mux once" shape as the lcm-diffusion
   * path above, just without the two-pass refinement or per-shot VLM
   * validation retry loop (out of scope here: `refinementModel` across
   * engine families is rejected in `create()`, and validation is an
   * lcm-diffusion-specific advisory feature — `validations` is always empty
   * on this path).
   */
  async generateWebDitStoryboard(args, descriptor, width, height, onProgress, start) {
    const steps = args.steps ?? descriptor.defaultSteps;
    const guidance = args.guidance ?? descriptor.defaultGuidance;
    const seedBase = args.seed ?? Date.now();
    const { storyboard } = args;
    const allFrames = [];
    const allMuxFrames = [];
    let globalIdx = 0;
    for (let s = 0; s < storyboard.shots.length; s++) {
      throwIfAborted(args.signal);
      const shot = storyboard.shots[s];
      const shotPrompt = composeShotPrompt(shot, storyboard.characters);
      reportProgress(
        `Shot ${s + 1}/${storyboard.shots.length} (${shot.durationFrames}f): ${shotPrompt}`,
        onProgress
      );
      const shotResult = await runWebDitDenoise(this.webditBundle, {
        prompt: shotPrompt,
        frames: shot.durationFrames,
        steps,
        guidance,
        seed: seedBase + s * 100003,
        width,
        height,
        mambaState: this.mambaState,
        frameOffset: globalIdx,
        onProgress,
        onFrame: args.onFrame,
        signal: args.signal
      });
      allFrames.push(...shotResult.frames);
      allMuxFrames.push(...shotResult.muxFrames);
      globalIdx += shotResult.frames.length;
      args.onShot?.(s, shot, null);
    }
    reportProgress(`Encoding ${allFrames.length} frames to MP4\u2026`, onProgress);
    const { blob } = await muxFramesToVideo(allMuxFrames, {
      width,
      height,
      fps: args.fps,
      signal: args.signal
    });
    reportProgress("MP4 ready.", onProgress);
    return {
      blob,
      mambaState: this.mambaState,
      frames: allFrames,
      activeDevice: this.activeDevice,
      storyboard,
      validations: [],
      elapsedMs: performance.now() - start
    };
  }
  /**
   * Render one storyboard shot, with self-healing validation retries. Generates
   * the clip, validates its first + last keyframe, and — if validation fails and
   * retries remain — re-renders with a fresh seed, keeping the highest-scoring
   * attempt. The Mamba state is snapshotted before each attempt and restored, so
   * a discarded attempt doesn't pollute cross-shot continuity; the kept
   * attempt's state is committed on return.
   */
  async renderShot(args) {
    const motion = cameraMoveToMotion(args.shot.camera);
    const stateBefore = this.mambaState;
    let best = null;
    for (let attempt = 0; attempt <= args.maxRetries; attempt++) {
      throwIfAborted(args.signal);
      this.mambaState = stateBefore;
      if (attempt > 0) {
        reportProgress(
          `Shot ${args.shotIndex + 1}/${args.shotCount}: validation retry ${attempt}/${args.maxRetries}\u2026`,
          args.onProgress
        );
      }
      const clip = await this.produceClip({
        frameCount: args.shot.durationFrames,
        promptEmbedding: args.shotEmbedding,
        negativeEmbedding: null,
        timesteps: args.timesteps,
        guidance: args.guidance,
        coherenceMode: args.coherenceMode,
        coherenceStrength: args.coherenceStrength,
        seed: args.baseSeed + attempt * 7919,
        motionAmount: args.motionAmount,
        imgToImgStrength: motion.imgToImgStrength,
        // Shots are short and Mamba state resets per shot, so per-shot recursion
        // drift is already bounded by the shot length — no periodic refresh.
        anchorRefreshInterval: 0,
        cameraMotion: motion.cameraMotion,
        interpolationFactor: args.interpolationFactor,
        interpolationBackend: args.interpolationBackend,
        width: args.width,
        height: args.height,
        label: `Shot ${args.shotIndex + 1}`,
        frameOffset: args.frameOffset,
        onProgress: args.onProgress,
        onFrame: args.onFrame,
        signal: args.signal
      });
      const validation = args.validate ? await this.validateShot(clip, {
        shot: args.shot,
        characters: args.characters,
        width: args.width,
        height: args.height,
        validatorModel: args.validatorModel,
        passThreshold: args.passThreshold,
        signal: args.signal,
        onProgress: args.onProgress
      }) : null;
      const score = validation?.score ?? 1;
      const prevBestScore = best?.validation?.score ?? -1;
      if (!best || score > prevBestScore) {
        if (best) closeClip(best.clip);
        best = { clip, validation, state: this.mambaState };
      } else {
        closeClip(clip);
      }
      if (!validation || validation.ok) break;
    }
    this.mambaState = best.state;
    return { clip: best.clip, validation: best.validation };
  }
  /**
   * Generate the frames for one clip. Keyframes (every `interpolationFactor`-th
   * output frame, with index 0 and the last index pinned) run the full denoise
   * loop; the frames between them are slerp-interpolated in latent space and
   * decoded once each. Advances `this.mambaState` per keyframe. Returns frames
   * in OUTPUT ORDER plus each frame's clean latent (for the refinement pass).
   *
   * Encapsulates the anchor-walk / img2img-recursion / camera-motion / Mamba
   * logic shared by `generate` and `generateStoryboard` — single source of
   * truth for "how one frame is made".
   */
  async produceClip(spec) {
    const {
      frameCount,
      promptEmbedding,
      negativeEmbedding,
      timesteps,
      guidance,
      coherenceMode,
      coherenceStrength,
      seed,
      motionAmount,
      imgToImgStrength,
      anchorRefreshInterval,
      cameraMotion,
      interpolationFactor,
      interpolationBackend,
      width,
      height,
      label,
      frameOffset,
      onProgress,
      onFrame,
      signal
    } = spec;
    const descriptor = MODEL_REGISTRY[this.opts.model];
    if (descriptor.engine !== "lcm-diffusion") {
      throw new Error(`produceClip: unexpected engine '${descriptor.engine}' for model '${this.opts.model}'.`);
    }
    const latentH = height / 8;
    const latentW = width / 8;
    const anchorLatent = this.lcmDiffusion.sampleInitialLatent(seed);
    const walkStart = this.lcmDiffusion.sampleInitialLatent(seed + 1);
    const walkEnd = this.lcmDiffusion.sampleInitialLatent(seed + 2);
    const keyframeIndices = planKeyframeIndices(frameCount, interpolationFactor);
    let prevLatent = null;
    const keyframes = [];
    const keyframeOutputs = [];
    for (let k = 0; k < keyframeIndices.length; k++) {
      throwIfAborted(signal);
      const frameIdx = keyframeIndices[k];
      const conditionedPrompt = coherenceMode === "prompt-bias" ? applyToPrompt({
        ctx: { mode: coherenceMode, strength: coherenceStrength, state: this.mambaState },
        promptEmbedding,
        seqLen: descriptor.sequenceLength,
        embedDim: descriptor.textEmbedDim
      }) : promptEmbedding;
      const refresh = isAnchorRefreshFrame(k, anchorRefreshInterval);
      const useImg2Img = imgToImgStrength > 0 && prevLatent !== null && !refresh;
      let latent;
      let frameTimesteps;
      if (refresh) {
        reportProgress(
          `${label} ${frameIdx + 1}/${frameCount}: anchor refresh (bounding recursion drift)\u2026`,
          onProgress
        );
      }
      if (useImg2Img) {
        let transformed = prevLatent;
        const latentShape = { channels: 4, height: latentH, width: latentW };
        if (cameraMotion && (cameraMotion.dx !== 0 || cameraMotion.dy !== 0)) {
          transformed = shiftLatent(transformed, latentShape, cameraMotion.dx, cameraMotion.dy);
        }
        if (cameraMotion?.zoom && cameraMotion.zoom !== 1) {
          transformed = scaleLatent(transformed, latentShape, cameraMotion.zoom);
        }
        const shifted = transformed;
        const skipCount = Math.floor(timesteps.length * (1 - imgToImgStrength));
        const truncated = timesteps.slice(skipCount);
        frameTimesteps = truncated.length > 0 ? truncated : [timesteps[timesteps.length - 1]];
        latent = this.lcmDiffusion.addNoiseToLatent(shifted, frameTimesteps[0], seed + frameIdx);
      } else {
        latent = anchorWalkLatent(anchorLatent, walkStart, walkEnd, frameIdx, frameCount, motionAmount);
        frameTimesteps = timesteps;
      }
      const biasNoiseScale = latentResidualBiasScale(
        coherenceMode,
        useImg2Img,
        useImg2Img ? this.lcmDiffusion.noiseScaleForTimestep(frameTimesteps[0]) : 1
      );
      if (biasNoiseScale > 0) {
        latent = applyToLatent({
          ctx: { mode: coherenceMode, strength: coherenceStrength, state: this.mambaState },
          latent,
          noiseScale: biasNoiseScale
        });
      }
      reportProgress(
        `${label} ${frameIdx + 1}/${frameCount} (keyframe ${k + 1}/${keyframeIndices.length}): ${useImg2Img ? `img2img (${frameTimesteps.length}/${timesteps.length} steps)` : "denoising"}\u2026`,
        onProgress
      );
      const { pixels, latent: finalLatent } = await this.lcmDiffusion.denoise({
        latent,
        condEmbedding: conditionedPrompt,
        uncondEmbedding: negativeEmbedding,
        timesteps: frameTimesteps,
        guidance,
        seed: seed + frameIdx,
        signal,
        onStep: (step, total) => reportProgress(`${label} ${frameIdx + 1}/${frameCount}: denoise step ${step}/${total}\u2026`, onProgress)
      });
      prevLatent = finalLatent;
      const rgba = pixelsToRgba(pixels, width, height);
      const bitmap = await createImageBitmap(
        new ImageData(rgba, width, height)
      );
      this.mambaState = await advanceState(this.mambaState, pixels, {
        device: this.probed.gpuDevice
      });
      keyframes.push({ outputIndex: frameIdx, latent: finalLatent });
      keyframeOutputs.push({ rgba, bitmap, pixels });
      onFrame?.(frameOffset + frameIdx, bitmap, this.mambaState);
    }
    const slots = buildInterpolatedSequence(keyframes);
    const frames = new Array(frameCount);
    const muxFrames = new Array(frameCount);
    const latents = new Array(frameCount);
    const useMotion = interpolationBackend === "motion" && keyframes.length > 1;
    const motionFields = /* @__PURE__ */ new Map();
    let leftKi = 0;
    for (const slot of slots) {
      throwIfAborted(signal);
      if (!slot.isTween) {
        const ki = slot.keyframeIndex;
        leftKi = ki;
        frames[slot.outputIndex] = keyframeOutputs[ki].bitmap;
        muxFrames[slot.outputIndex] = { rgba: keyframeOutputs[ki].rgba };
        latents[slot.outputIndex] = keyframes[ki].latent;
        continue;
      }
      let pixels;
      if (useMotion && leftKi + 1 < keyframes.length) {
        const k0 = keyframes[leftKi];
        const k1 = keyframes[leftKi + 1];
        const span = k1.outputIndex - k0.outputIndex;
        const t = span > 0 ? (slot.outputIndex - k0.outputIndex) / span : 0.5;
        reportProgress(`${label} ${slot.outputIndex + 1}/${frameCount}: motion-warp\u2026`, onProgress);
        let field = motionFields.get(leftKi);
        if (!field) {
          field = estimateBlockMotion(
            keyframeOutputs[leftKi].pixels,
            keyframeOutputs[leftKi + 1].pixels,
            width,
            height
          );
          motionFields.set(leftKi, field);
        }
        pixels = interpolateFrames(
          keyframeOutputs[leftKi].pixels,
          keyframeOutputs[leftKi + 1].pixels,
          width,
          height,
          t,
          field
        );
        latents[slot.outputIndex] = null;
      } else {
        reportProgress(`${label} ${slot.outputIndex + 1}/${frameCount}: interpolating\u2026`, onProgress);
        pixels = await this.lcmDiffusion.decodeLatent(slot.latent);
        latents[slot.outputIndex] = slot.latent;
      }
      const rgba = pixelsToRgba(pixels, width, height);
      const bitmap = await createImageBitmap(
        new ImageData(rgba, width, height)
      );
      frames[slot.outputIndex] = bitmap;
      muxFrames[slot.outputIndex] = { rgba };
      onFrame?.(frameOffset + slot.outputIndex, bitmap, this.mambaState);
    }
    return { frames, muxFrames, latents };
  }
  /**
   * Second pass over an already-produced clip through a different (usually
   * larger) model. Disposes the draft engine, loads the refinement engine, and
   * for each frame WITH a true latent re-noises it to a partial timestep and
   * finishes the denoise. Frames with a `null` latent (motion-backend tweens)
   * are carried through UNCHANGED — refining them from a stand-in latent would
   * discard their optical-flow warp. Sequential load → VRAM stays at
   * max(draft, refinement). Only safe across SD1.5-family models.
   *
   * Owns the lifecycle of the draft clip's bitmaps: refined frames replace and
   * CLOSE their drafts; carried-through frames are reused (not closed). The
   * caller must NOT close the draft clip afterwards.
   */
  async refinementPass(clip, opts) {
    const { onProgress } = opts;
    const { latents } = clip;
    reportProgress(
      `Refinement pass: swapping ${this.opts.model} \u2192 ${this.opts.refinementModel} (sequential, no VRAM cost)\u2026`,
      onProgress
    );
    await this.lcmDiffusion.dispose();
    this.diffusion = this.lcmResidency.createEngine(this.opts.refinementModel, {
      width: opts.width,
      height: opts.height,
      onProgress
    });
    await this.lcmDiffusion.init();
    const refinedCondEmbedding = await this.lcmDiffusion.embedPrompt(opts.resolvedPrompt);
    const refinedDescriptor = MODEL_REGISTRY[this.opts.refinementModel];
    if (refinedDescriptor.engine !== "lcm-diffusion") {
      throw new Error(
        `refinementPass: unexpected engine '${refinedDescriptor.engine}' for refinementModel '${this.opts.refinementModel}'.`
      );
    }
    const refinedTimesteps = trimTimesteps(refinedDescriptor.defaultTimesteps, refinedDescriptor.defaultSteps);
    const skipCount = Math.floor(refinedTimesteps.length * (1 - opts.refinementStrength));
    const partialTimesteps = skipCount < refinedTimesteps.length ? refinedTimesteps.slice(skipCount) : [refinedTimesteps[refinedTimesteps.length - 1]];
    const frames = new Array(latents.length);
    const muxFrames = new Array(latents.length);
    const outLatents = new Array(latents.length);
    let refinedCount = 0;
    for (let i = 0; i < latents.length; i++) {
      throwIfAborted(opts.signal);
      const latent = latents[i];
      if (latent === null) {
        frames[i] = clip.frames[i];
        muxFrames[i] = clip.muxFrames[i];
        outLatents[i] = null;
        continue;
      }
      reportProgress(`Refinement pass: frame ${i + 1}/${latents.length}\u2026`, onProgress);
      const noised = this.lcmDiffusion.addNoiseToLatent(latent, partialTimesteps[0], opts.seed + i);
      const { pixels, latent: refinedLatent } = await this.lcmDiffusion.denoise({
        latent: noised,
        condEmbedding: refinedCondEmbedding,
        uncondEmbedding: null,
        timesteps: partialTimesteps,
        guidance: refinedDescriptor.defaultGuidance,
        seed: opts.seed + i,
        signal: opts.signal
      });
      const rgba = pixelsToRgba(pixels, opts.width, opts.height);
      const bitmap = await createImageBitmap(
        new ImageData(rgba, opts.width, opts.height)
      );
      try {
        clip.frames[i].close();
      } catch {
      }
      frames[i] = bitmap;
      muxFrames[i] = { rgba };
      outLatents[i] = refinedLatent;
      refinedCount++;
      opts.onFrame?.(i, bitmap, this.mambaState);
    }
    reportProgress(`Refinement pass complete (${refinedCount}/${latents.length} frames refined).`, onProgress);
    return { frames, muxFrames, latents: outLatents };
  }
  /**
   * Validate a shot through the VLM by checking its FIRST and LAST keyframe
   * (mid-shot drift is invisible to a single-frame check). Returns the merged
   * verdict: `ok` only if both ends pass, `score` is the worse of the two, and
   * issues are concatenated. Returns null when validation can't run at all (no
   * OffscreenCanvas / both calls failed) so the caller treats it as advisory.
   */
  async validateShot(clip, ctx) {
    if (clip.muxFrames.length === 0) return null;
    const lastIdx = clip.muxFrames.length - 1;
    const indices = lastIdx === 0 ? [0] : [0, lastIdx];
    const verdicts = (await Promise.all(
      indices.map(
        (i) => this.validateOneFrame(clip.muxFrames[i], `frame ${i + 1}`, ctx)
      )
    )).filter((v) => v !== null);
    if (verdicts.length === 0) return null;
    return {
      ok: verdicts.every((v) => v.ok),
      score: Math.min(...verdicts.map((v) => v.score)),
      issues: verdicts.flatMap((v) => v.issues)
    };
  }
  /**
   * Validate ONE frame of a shot through the VLM. Encodes the raw RGBA to a
   * JPEG data URL (via OffscreenCanvas) and asks the gateway's vision model
   * whether it matches the shot + character bible. Advisory: any failure
   * (no OffscreenCanvas, gateway down) returns null.
   */
  async validateOneFrame(frame, frameLabel, ctx) {
    try {
      reportProgress(`Validating shot "${ctx.shot.id}" ${frameLabel} via VLM\u2026`, ctx.onProgress);
      const dataUrl = await rgbaToDataUrl(frame.rgba, ctx.width, ctx.height);
      if (!dataUrl) return null;
      const present = ctx.shot.characterIds.map((id) => ctx.characters.find((c) => c.id === id)).filter((c) => Boolean(c)).map((c) => ({ name: c.name, appearance: c.appearance }));
      return await validateFrame({
        apiKey: this.opts.apiKey,
        baseUrl: this.opts.baseUrl,
        validatorModel: ctx.validatorModel,
        frameDataUrl: dataUrl,
        shotDescription: `${ctx.shot.prompt} \u2014 action: ${ctx.shot.action}`,
        characters: present,
        passThreshold: ctx.passThreshold,
        signal: ctx.signal
      });
    } catch {
      return null;
    }
  }
  /** Read the current Mamba state without mutating the engine — for persistence. */
  getMambaState() {
    return this.mambaState;
  }
  /** Replace the Mamba state — used when resuming a session from R2 / IDB. */
  setMambaState(state) {
    this.mambaState = state;
  }
  /** Release ORT sessions + GPUDevice (lcm-diffusion) or unload the webdit
   *  bundle (webdit-dit) — whichever this instance holds. Idempotent. After
   *  dispose the engine cannot be reused — create a new one with
   *  VideoEngine.create. */
  async dispose() {
    this.lcmResidency?.dispose();
    await this.diffusion?.dispose();
    await this.webditBundle?.unload();
  }
  /**
   * Non-null accessor for the lcm-diffusion engine. Every internal caller of
   * this getter (produceClip, refinementPass, renderShot, the lcm branches of
   * generate()/generateStoryboard()) is itself only reachable via the
   * lcm-diffusion branch of create()/generate() — a throw here means an
   * internal dispatch bug, not a reachable user state.
   */
  get lcmDiffusion() {
    if (!this.diffusion) {
      throw new Error("VideoEngine: lcm-diffusion engine accessed on a non-lcm-diffusion instance.");
    }
    return this.diffusion;
  }
};
function clamp015(x) {
  if (!Number.isFinite(x)) return DEFAULT_MOTION_AMOUNT;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
function closeClip(clip) {
  for (const bm of clip.frames) {
    try {
      bm.close();
    } catch {
    }
  }
}
function normaliseFactor(factor) {
  if (factor === void 0 || !Number.isFinite(factor)) return 1;
  return Math.max(1, Math.floor(factor));
}
function normaliseRefreshInterval(interval) {
  if (interval === void 0 || !Number.isFinite(interval) || interval <= 0) return 0;
  return Math.floor(interval);
}
async function rgbaToDataUrl(rgba, width, height) {
  if (typeof OffscreenCanvas === "undefined") return null;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
  const buf = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
function trimTimesteps(defaults, steps) {
  if (steps >= defaults.length) return defaults;
  if (steps <= 1) return [defaults[0]];
  const out = [];
  for (let i = 0; i < steps; i++) {
    const idx = Math.round(i * (defaults.length - 1) / (steps - 1));
    out.push(defaults[idx]);
  }
  return out;
}

// src/engine/offline/model-offline.ts
var manifestKey = (model) => `offline/${model}/manifest.json`;
var weightKey = (model, file) => `${model}/${file}`;
async function readManifest(model) {
  const buf = await weightStore().read(manifestKey(model));
  if (!buf) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(buf));
    return parsed?.v === 1 && parsed.sizes ? parsed : null;
  } catch {
    return null;
  }
}
function abortError() {
  return new DOMException("Offline download cancelled", "AbortError");
}
async function getModelOfflineStatus(model) {
  const descriptor = MODEL_REGISTRY[model];
  if (descriptor.engine !== "lcm-diffusion") return { available: false, sizeBytes: null };
  const store = weightStore();
  const files = modelWeightFiles(descriptor);
  const stored = await Promise.all(files.map((f) => store.has(weightKey(model, f))));
  const available = stored.every(Boolean) && await isTokenizerStored(descriptor.tokenizerRepo);
  if (!available) return { available: false, sizeBytes: null };
  const manifest = await readManifest(model);
  const known = manifest && files.every((f) => manifest.sizes[weightKey(model, f)] !== void 0);
  const sizeBytes = known ? files.reduce((sum, f) => sum + manifest.sizes[weightKey(model, f)], manifest.tokenizerBytes) : null;
  return { available: true, sizeBytes };
}
async function isModelAvailableOffline(model) {
  return (await getModelOfflineStatus(model)).available;
}
async function prepareModelOffline(opts) {
  const { model, signal } = opts;
  const descriptor = MODEL_REGISTRY[model];
  if (descriptor.engine !== "lcm-diffusion") {
    throw new Error(`Model '${model}' cannot be made available offline yet.`);
  }
  const store = weightStore();
  if (!store.canPersist()) throw new Error("Offline storage (IndexedDB) is not available in this browser.");
  const source = {
    apiKey: opts.authToken,
    weightSources: opts.weightSources ?? DEFAULT_WEIGHT_SOURCES,
    r2Base: deriveR2Base(opts.baseUrl)
  };
  const files = modelWeightFiles(descriptor);
  const previous = await readManifest(model);
  const sizes = {};
  for (const f of files) {
    const known = previous?.sizes[weightKey(model, f)];
    if (known !== void 0) sizes[weightKey(model, f)] = known;
  }
  let doneBytes = 0;
  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) throw abortError();
    const file = files[i];
    const key = weightKey(model, file);
    const report = (current, currentTotal) => {
      const projected = files.map((f) => sizes[weightKey(model, f)]);
      const totalBytes = currentTotal !== null && projected.every((s, idx) => s !== void 0 || idx === i) ? projected.reduce((sum, s, idx) => sum + (idx === i ? currentTotal : s), 0) : null;
      opts.onProgress?.({ loadedBytes: doneBytes + current, totalBytes, file, fileIndex: i + 1, fileCount: files.length });
    };
    if (await store.has(key)) {
      const size = sizes[key] ?? 0;
      doneBytes += size;
      report(0, size || null);
      continue;
    }
    let persistFailed = false;
    let buffer;
    try {
      buffer = await getOrFetchWeight({
        ...weightRequest(descriptor, file, source),
        signal,
        onProgress: report,
        onPersistFailed: () => {
          persistFailed = true;
        }
      });
    } catch (err) {
      if (signal?.aborted) throw abortError();
      throw err;
    }
    if (persistFailed) throw new Error(`${file} could not be saved for offline use (storage full or blocked).`);
    sizes[key] = buffer.byteLength;
    doneBytes += buffer.byteLength;
  }
  if (signal?.aborted) throw abortError();
  let tokenizerBytes;
  try {
    tokenizerBytes = await storeTokenizerFiles(descriptor.tokenizerRepo, signal);
  } catch (err) {
    if (signal?.aborted) throw abortError();
    throw err;
  }
  const manifest = { v: 1, sizes, tokenizerBytes };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  await store.write(manifestKey(model), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

// src/engine/voice/audio-frames.ts
var DEFAULT_SAMPLE_RATE = 24e3;
var DEFAULT_FRAME_LENGTH = 1024;
var DEFAULT_HOP_LENGTH = 256;
var DEFAULT_NUM_MELS = 80;
function defaultMelConfig(overrides = {}) {
  return {
    sampleRate: overrides.sampleRate ?? DEFAULT_SAMPLE_RATE,
    frameLength: overrides.frameLength ?? DEFAULT_FRAME_LENGTH,
    hopLength: overrides.hopLength ?? DEFAULT_HOP_LENGTH,
    numMels: overrides.numMels ?? DEFAULT_NUM_MELS
  };
}
var hannCache = /* @__PURE__ */ new Map();
function hannWindow(n) {
  const cached = hannCache.get(n);
  if (cached) return cached;
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  }
  hannCache.set(n, w);
  return w;
}
function frameSignal(signal, frameLength, hopLength) {
  if (signal.length === 0) return [];
  const frames = [];
  for (let start = 0; start < signal.length; start += hopLength) {
    const frame = new Float32Array(frameLength);
    const end = Math.min(start + frameLength, signal.length);
    frame.set(signal.subarray(start, end));
    frames.push(frame);
    if (end >= signal.length) break;
  }
  return frames;
}
function fftInPlace(re, im) {
  const n = re.length;
  if (n <= 1) return;
  if ((n & n - 1) !== 0) {
    throw new Error(`fftInPlace: length ${n} is not a power of two`);
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len >> 1; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + (len >> 1)] * curRe - im[i + k + (len >> 1)] * curIm;
        const bIm = re[i + k + (len >> 1)] * curIm + im[i + k + (len >> 1)] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + (len >> 1)] = aRe - bRe;
        im[i + k + (len >> 1)] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}
function ifftInPlace(re, im) {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fftInPlace(re, im);
  const inv = 1 / n;
  for (let i = 0; i < n; i++) {
    re[i] *= inv;
    im[i] = -im[i] * inv;
  }
}
function magnitudeSpectrum(frame) {
  const n = frame.length;
  const re = new Float32Array(frame);
  const im = new Float32Array(n);
  fftInPlace(re, im);
  const bins = n / 2 + 1;
  const mag = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    mag[b] = Math.hypot(re[b], im[b]);
  }
  return mag;
}
var hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
var melToHz = (mel) => 700 * (10 ** (mel / 2595) - 1);
var filterbankCache = /* @__PURE__ */ new Map();
function melFilterbank(config) {
  const key = `${config.sampleRate}:${config.frameLength}:${config.numMels}`;
  const cached = filterbankCache.get(key);
  if (cached) return cached;
  const bins = config.frameLength / 2 + 1;
  const melMin = hzToMel(0);
  const melMax = hzToMel(config.sampleRate / 2);
  const points = new Float32Array(config.numMels + 2);
  for (let i = 0; i < points.length; i++) {
    const mel = melMin + (melMax - melMin) * i / (config.numMels + 1);
    points[i] = melToHz(mel) / (config.sampleRate / 2) * (bins - 1);
  }
  const filters = [];
  for (let m = 1; m <= config.numMels; m++) {
    const row = new Float32Array(bins);
    const left = points[m - 1];
    const center = points[m];
    const right = points[m + 1];
    for (let b = 0; b < bins; b++) {
      let w = 0;
      if (b >= left && b <= center && center > left) w = (b - left) / (center - left);
      else if (b > center && b <= right && right > center) w = (right - b) / (right - center);
      row[b] = w;
    }
    filters.push(row);
  }
  filterbankCache.set(key, filters);
  return filters;
}
var LOG_FLOOR = 1e-5;
function melSpectrogram(pcm, overrides = {}) {
  const config = defaultMelConfig(overrides);
  const window = hannWindow(config.frameLength);
  const filters = melFilterbank(config);
  const frames = frameSignal(pcm, config.frameLength, config.hopLength);
  const melFrames = frames.map((frame) => {
    const windowed = new Float32Array(config.frameLength);
    for (let i = 0; i < config.frameLength; i++) windowed[i] = frame[i] * window[i];
    const mag = magnitudeSpectrum(windowed);
    const mel = new Float32Array(config.numMels);
    for (let m = 0; m < config.numMels; m++) {
      const row = filters[m];
      let energy = 0;
      for (let b = 0; b < row.length; b++) energy += row[b] * mag[b];
      mel[m] = Math.log(Math.max(energy, LOG_FLOOR));
    }
    return mel;
  });
  return {
    frames: melFrames,
    numMels: config.numMels,
    hopLength: config.hopLength,
    frameLength: config.frameLength,
    sampleRate: config.sampleRate
  };
}
function melToWaveform(mel) {
  const { frames, hopLength, frameLength, numMels, sampleRate } = mel;
  if (frames.length === 0) return new Float32Array(0);
  const filters = melFilterbank({ sampleRate, frameLength, hopLength, numMels });
  const window = hannWindow(frameLength);
  const bins = frameLength / 2 + 1;
  const binWeight = new Float32Array(bins);
  for (let m = 0; m < numMels; m++) {
    const row = filters[m];
    for (let b = 0; b < bins; b++) binWeight[b] += row[b];
  }
  const outLength = (frames.length - 1) * hopLength + frameLength;
  const out = new Float32Array(outLength);
  const norm = new Float32Array(outLength);
  for (let f = 0; f < frames.length; f++) {
    const melVec = frames[f];
    const mag = new Float32Array(bins);
    for (let m = 0; m < numMels; m++) {
      const energy = Math.exp(melVec[m]);
      const row = filters[m];
      for (let b = 0; b < bins; b++) mag[b] += row[b] * energy;
    }
    for (let b = 0; b < bins; b++) {
      if (binWeight[b] > 0) mag[b] /= binWeight[b];
    }
    const re = new Float32Array(frameLength);
    const im = new Float32Array(frameLength);
    for (let b = 0; b < bins; b++) {
      re[b] = mag[b];
      if (b > 0 && b < bins - 1) re[frameLength - b] = mag[b];
    }
    ifftInPlace(re, im);
    const base = f * hopLength;
    for (let i = 0; i < frameLength; i++) {
      out[base + i] += re[i] * window[i];
      norm[base + i] += window[i] * window[i];
    }
  }
  for (let i = 0; i < outLength; i++) {
    if (norm[i] > 1e-8) out[i] /= norm[i];
  }
  return out;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function l2Normalize(v) {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

// src/engine/voice/speaker-encoder.ts
var DEFAULT_EMBEDDING_DIM = 256;
function encodeSpeaker(reference, options = {}) {
  const embeddingDim = options.embeddingDim ?? DEFAULT_EMBEDDING_DIM;
  const sampleRate = options.sampleRate ?? reference.sampleRate;
  const numMels = options.numMels;
  const mel = melSpectrogram(reference.samples, { sampleRate, ...numMels ? { numMels } : {} });
  if (mel.frames.length === 0) {
    return { data: new Array(embeddingDim).fill(0), dim: embeddingDim, sampleRate };
  }
  const m = mel.numMels;
  const mean = new Float32Array(m);
  for (const frame of mel.frames) {
    for (let i = 0; i < m; i++) mean[i] += frame[i];
  }
  for (let i = 0; i < m; i++) mean[i] /= mel.frames.length;
  const std = new Float32Array(m);
  for (const frame of mel.frames) {
    for (let i = 0; i < m; i++) {
      const d = frame[i] - mean[i];
      std[i] += d * d;
    }
  }
  for (let i = 0; i < m; i++) std[i] = Math.sqrt(std[i] / mel.frames.length);
  const stats = new Float32Array(2 * m);
  stats.set(mean, 0);
  stats.set(std, m);
  const projected = projectStats(stats, embeddingDim);
  l2Normalize(projected);
  return { data: Array.from(projected), dim: embeddingDim, sampleRate };
}
var projectionCache = /* @__PURE__ */ new Map();
function projectStats(stats, outDim) {
  const inDim = stats.length;
  const key = `${inDim}:${outDim}`;
  let signs = projectionCache.get(key);
  if (!signs) {
    signs = new Int8Array(inDim * outDim);
    const rand = mulberry32((2654435769 ^ Math.imul(inDim, 2654435761) ^ outDim) >>> 0);
    for (let i = 0; i < signs.length; i++) signs[i] = rand() < 0.5 ? -1 : 1;
    projectionCache.set(key, signs);
  }
  const out = new Float32Array(outDim);
  const scale = 1 / Math.sqrt(inDim);
  for (let o = 0; o < outDim; o++) {
    let sum = 0;
    const base = o * inDim;
    for (let i = 0; i < inDim; i++) sum += signs[base + i] * stats[i];
    out[o] = sum * scale;
  }
  return out;
}
function verifySpeaker(a, b, threshold = 0.75) {
  const similarity = cosineSimilarity(a.data, b.data);
  return { same: similarity >= threshold, similarity };
}

// src/engine/voice/neural-codec.ts
var DEFAULT_NUM_QUANTIZERS = 4;
var DEFAULT_CODEBOOK_SIZE = 256;
var NeuralCodec = class {
  config;
  numQuantizers;
  codebookSize;
  /** `[quantizer][entry] = mel-dim centroid`. */
  codebooks;
  constructor(options = {}) {
    this.config = defaultMelConfig({
      ...options.sampleRate ? { sampleRate: options.sampleRate } : {},
      ...options.numMels ? { numMels: options.numMels } : {},
      ...options.frameLength ? { frameLength: options.frameLength } : {},
      ...options.hopLength ? { hopLength: options.hopLength } : {}
    });
    this.numQuantizers = options.numQuantizers ?? DEFAULT_NUM_QUANTIZERS;
    this.codebookSize = options.codebookSize ?? DEFAULT_CODEBOOK_SIZE;
    this.codebooks = options.codebooks ?? buildSeededCodebooks(this.numQuantizers, this.codebookSize, this.config.numMels);
    if (this.codebooks.length !== this.numQuantizers) {
      throw new Error(
        `NeuralCodec: ${this.codebooks.length} codebooks for ${this.numQuantizers} quantizers`
      );
    }
  }
  get quantizers() {
    return this.numQuantizers;
  }
  get vocabSize() {
    return this.codebookSize;
  }
  get sampleRate() {
    return this.config.sampleRate;
  }
  /** PCM ▶ discrete tokens. */
  encode(audio) {
    const mel = melSpectrogram(audio.samples, this.config);
    return this.encodeMel(mel);
  }
  /** log-mel spectrogram ▶ discrete tokens. The acoustic model and the analysis
   *  path share this so quantisation lives in one place. */
  encodeMel(mel) {
    const tokens = mel.frames.map((frame) => {
      const residual = new Float32Array(frame);
      const ids = [];
      for (let q = 0; q < this.numQuantizers; q++) {
        const id = nearestCentroid(this.codebooks[q], residual);
        ids.push(id);
        const centroid = this.codebooks[q][id];
        for (let i = 0; i < residual.length; i++) residual[i] -= centroid[i];
      }
      return ids;
    });
    return {
      tokens,
      numFrames: tokens.length,
      numQuantizers: this.numQuantizers,
      codebookSize: this.codebookSize,
      hopLength: this.config.hopLength,
      frameLength: this.config.frameLength,
      sampleRate: this.config.sampleRate
    };
  }
  /** Discrete tokens ▶ reconstructed log-mel spectrogram (sum of chosen
   *  centroids per frame). */
  decodeMel(codec) {
    const frames = codec.tokens.map((ids) => {
      const mel = new Float32Array(this.config.numMels);
      for (let q = 0; q < ids.length && q < this.numQuantizers; q++) {
        const centroid = this.codebooks[q][ids[q]];
        for (let i = 0; i < mel.length; i++) mel[i] += centroid[i];
      }
      return mel;
    });
    return {
      frames,
      numMels: this.config.numMels,
      hopLength: codec.hopLength,
      frameLength: codec.frameLength,
      sampleRate: codec.sampleRate
    };
  }
  /** Discrete tokens ▶ PCM waveform (mel reconstruction → shared vocoder). */
  decode(codec) {
    const mel = this.decodeMel(codec);
    const samples = melToWaveform(mel);
    return { samples, sampleRate: codec.sampleRate };
  }
};
function nearestCentroid(codebook, vec) {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < codebook.length; i++) {
    const score = cosineSimilarity(codebook[i], vec);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
function buildSeededCodebooks(numQuantizers, codebookSize, melDim) {
  const books = [];
  for (let q = 0; q < numQuantizers; q++) {
    const rand = mulberry32((49374 ^ Math.imul(q + 1, 2246822519)) >>> 0);
    const scale = 0.5 ** q;
    const book = [];
    for (let e = 0; e < codebookSize; e++) {
      const centroid = new Float32Array(melDim);
      for (let i = 0; i < melDim; i++) centroid[i] = (rand() * 2 - 1) * scale;
      book.push(centroid);
    }
    books.push(book);
  }
  return books;
}

// src/engine/voice/text-tokenizer.ts
var ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 .,!?'-";
var CHAR_TO_ID = /* @__PURE__ */ new Map();
for (let i = 0; i < ALPHABET.length; i++) CHAR_TO_ID.set(ALPHABET[i], i + 1);
var TEXT_VOCAB_SIZE = ALPHABET.length + 1;
function tokenizeText(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const tokens = [];
  for (const ch of normalized) tokens.push(CHAR_TO_ID.get(ch) ?? 0);
  const words = [];
  let cursor = 0;
  for (const word of normalized.split(" ")) {
    if (word.length === 0) continue;
    const startChar = normalized.indexOf(word, cursor);
    const endChar = startChar + word.length;
    words.push({ word, startChar, endChar });
    cursor = endChar;
  }
  return { tokens, words };
}

// src/engine/voice/ssm-acoustic-model.ts
var DEFAULTS = {
  sampleRate: 24e3,
  numMels: 80,
  hopLength: 256,
  frameLength: 1024,
  numQuantizers: 4,
  codebookSize: 256,
  charsPerSecond: 14,
  hiddenDim: 256
};
var SSMAcousticModel = class {
  cfg;
  /** Hashed character-embedding table [vocab][hiddenDim]. */
  charEmbed;
  /** Speaker-embedding → hidden projection (sign matrix), built lazily per
   *  speaker-dim so a mismatched embedding can't silently mis-multiply. */
  speakerProj = null;
  /** Per-quantizer output projection: hidden → codebookSize logits. */
  outProj;
  /** SSM per-channel decay (diagonal A), stable in [0.5, 0.99). */
  decay;
  constructor(options = {}) {
    this.cfg = {
      sampleRate: options.sampleRate ?? DEFAULTS.sampleRate,
      numMels: options.numMels ?? DEFAULTS.numMels,
      hopLength: options.hopLength ?? DEFAULTS.hopLength,
      frameLength: options.frameLength ?? DEFAULTS.frameLength,
      numQuantizers: options.numQuantizers ?? DEFAULTS.numQuantizers,
      codebookSize: options.codebookSize ?? DEFAULTS.codebookSize,
      charsPerSecond: options.charsPerSecond ?? DEFAULTS.charsPerSecond,
      hiddenDim: options.hiddenDim ?? DEFAULTS.hiddenDim
    };
    const h = this.cfg.hiddenDim;
    const embedRand = mulberry32(2021);
    this.charEmbed = [];
    for (let t = 0; t < TEXT_VOCAB_SIZE; t++) {
      const vec = new Float32Array(h);
      for (let i = 0; i < h; i++) {
        vec[i] = Math.sin((t + 1) * (i + 1) * 0.07 + embedRand() * 6.283);
      }
      this.charEmbed.push(vec);
    }
    this.outProj = [];
    for (let q = 0; q < this.cfg.numQuantizers; q++) {
      const signs = new Int8Array(h * this.cfg.codebookSize);
      const rand = mulberry32(23 + Math.imul(q, 40503) >>> 0);
      for (let i = 0; i < signs.length; i++) signs[i] = rand() < 0.5 ? -1 : 1;
      this.outProj.push(signs);
    }
    this.decay = new Float32Array(h);
    const decayRand = mulberry32(912551);
    for (let i = 0; i < h; i++) this.decay[i] = 0.5 + decayRand() * 0.49;
  }
  /**
   * Generate codec tokens for `text` in the voice described by `speaker`.
   * `speed` (>0, default 1) scales the predicted duration: 1.5 ≈ 50 % faster.
   */
  generate(text, speaker, speed = 1) {
    const h = this.cfg.hiddenDim;
    const charCount = Math.max(1, text.tokens.length);
    const seconds = charCount / (this.cfg.charsPerSecond * (speed > 0 ? speed : 1));
    const numFrames = Math.max(1, Math.round(seconds * this.cfg.sampleRate / this.cfg.hopLength));
    const speakerVec = this.projectSpeaker(speaker, h);
    const state = new Float32Array(h);
    const tokens = [];
    for (let f = 0; f < numFrames; f++) {
      const charIdx = Math.min(
        text.tokens.length - 1,
        Math.floor(f / numFrames * text.tokens.length)
      );
      const charVec = this.charEmbed[text.tokens[charIdx] ?? 0];
      for (let i = 0; i < h; i++) {
        const input = charVec[i] + speakerVec[i];
        state[i] = this.decay[i] * state[i] + (1 - this.decay[i]) * input;
      }
      tokens.push(this.project(state, speakerVec));
    }
    return {
      codec: {
        tokens,
        numFrames,
        numQuantizers: this.cfg.numQuantizers,
        codebookSize: this.cfg.codebookSize,
        hopLength: this.cfg.hopLength,
        frameLength: this.cfg.frameLength,
        sampleRate: this.cfg.sampleRate
      },
      wordTimestamps: alignWords(text, numFrames, this.cfg.hopLength, this.cfg.sampleRate)
    };
  }
  /** hidden state → one token id per quantizer (argmax of speaker-biased logits). */
  project(state, speakerVec) {
    const h = this.cfg.hiddenDim;
    const v = this.cfg.codebookSize;
    const ids = [];
    for (let q = 0; q < this.cfg.numQuantizers; q++) {
      const signs = this.outProj[q];
      let bestId = 0;
      let bestLogit = -Infinity;
      for (let c = 0; c < v; c++) {
        let logit = 0;
        const base = c * h;
        for (let i = 0; i < h; i++) logit += signs[base + i] * state[i];
        logit += speakerVec[c % h] * 0.5;
        if (logit > bestLogit) {
          bestLogit = logit;
          bestId = c;
        }
      }
      ids.push(bestId);
    }
    return ids;
  }
  /** Project a speaker embedding to the hidden dim with a cached sign matrix. */
  projectSpeaker(speaker, h) {
    const dim = speaker.dim;
    if (!this.speakerProj || this.speakerProj.dim !== dim) {
      const signs2 = new Int8Array(dim * h);
      const rand = mulberry32((21481 ^ Math.imul(dim, 40503)) >>> 0);
      for (let i = 0; i < signs2.length; i++) signs2[i] = rand() < 0.5 ? -1 : 1;
      this.speakerProj = { dim, signs: signs2 };
    }
    const { signs } = this.speakerProj;
    const out = new Float32Array(h);
    const scale = 1 / Math.sqrt(dim);
    for (let o = 0; o < h; o++) {
      let sum = 0;
      for (let i = 0; i < dim; i++) sum += signs[i * h + o] * speaker.data[i];
      out[o] = sum * scale;
    }
    return out;
  }
};
function alignWords(text, numFrames, hopLength, sampleRate) {
  if (text.words.length === 0) return [];
  const totalChars = Math.max(1, text.tokens.length);
  const msPerFrame = hopLength / sampleRate * 1e3;
  const result = [];
  for (const w of text.words) {
    const startFrame = Math.round(w.startChar / totalChars * numFrames);
    const endFrame = Math.round(w.endChar / totalChars * numFrames);
    result.push({
      word: w.word,
      startMs: Math.round(startFrame * msPerFrame),
      endMs: Math.round(endFrame * msPerFrame)
    });
  }
  return result;
}

// ../packages/voice-provenance/src/watermark.ts
var ID_BITS = 64;
var CRC_BITS = 32;
var TOTAL_BITS = ID_BITS + CRC_BITS;
var MIN_SLOT_SAMPLES = 160;
var MIN_RMS = 1e-3;
var TAPS = 97;
var BAND_LOW_HZ = 4e3;
var BAND_HIGH_HZ = 8e3;
var BAND_HIGH_MAX_FRACTION = 0.46;
var MIN_BAND_HZ = 1500;
var TARGET_REL = 0.2;
var KEY = 1597463007;
var WATERMARK_ID_HEX_LENGTH = ID_BITS / 4;
var ID_PATTERN = /^[0-9a-f]{16}$/;
var WatermarkUnsupportedError = class extends Error {
  constructor(reason) {
    super(`Audio cannot carry a watermark: ${reason}`);
    this.name = "WatermarkUnsupportedError";
  }
};
function newWatermarkId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function crc32(bytes) {
  let crc = 4294967295;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc >>> 1 ^ 3988292384 & -(crc & 1);
  }
  return (crc ^ 4294967295) >>> 0;
}
function idBytes(id) {
  const out = [];
  for (let i = 0; i < id.length; i += 2) out.push(parseInt(id.slice(i, i + 2), 16));
  return out;
}
function bitsFor(id) {
  const bytes = idBytes(id);
  const bits = [];
  for (const b of bytes) for (let k = 7; k >= 0; k--) bits.push(b >> k & 1);
  const crc = crc32(bytes);
  for (let k = CRC_BITS - 1; k >= 0; k--) bits.push(crc >>> k & 1);
  return bits;
}
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function bandHighHz(sampleRate) {
  return Math.min(BAND_HIGH_HZ, sampleRate * BAND_HIGH_MAX_FRACTION);
}
function plan(length, sampleRate) {
  const hi = bandHighHz(sampleRate);
  if (!(sampleRate > 0) || hi - BAND_LOW_HZ < MIN_BAND_HZ) return null;
  const slotLen = Math.floor(length / TOTAL_BITS);
  if (slotLen < MIN_SLOT_SAMPLES) return null;
  return { slotLen, fir: bandpass(sampleRate, BAND_LOW_HZ, hi) };
}
function sinc(x) {
  return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
}
function bandpass(sampleRate, lowHz, highHz) {
  const h = new Float64Array(TAPS);
  const mid = (TAPS - 1) / 2;
  const fl = 2 * lowHz / sampleRate;
  const fh = 2 * highHz / sampleRate;
  for (let n = 0; n < TAPS; n++) {
    const k = n - mid;
    const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * n / (TAPS - 1));
    h[n] = (fh * sinc(fh * k) - fl * sinc(fl * k)) * window;
  }
  return h;
}
function direction(slot, slotLen, fir, variant) {
  const rand = prng((Math.imul(slot + 1, 2654435761) ^ KEY ^ Math.imul(variant, 2246822507)) >>> 0);
  const chips = new Float64Array(slotLen + TAPS - 1);
  for (let i = 0; i < chips.length; i++) chips[i] = rand() < 0.5 ? -1 : 1;
  const w = new Float64Array(slotLen);
  let energy = 0;
  for (let i = 0; i < slotLen; i++) {
    let acc = 0;
    for (let j = 0; j < TAPS; j++) acc += fir[j] * chips[i + TAPS - 1 - j];
    w[i] = acc;
    energy += acc * acc;
  }
  const norm = Math.sqrt(energy) || 1;
  for (let i = 0; i < slotLen; i++) w[i] = w[i] / norm;
  return w;
}
function rmsOf(pcm) {
  let e = 0;
  for (let i = 0; i < pcm.length; i++) e += pcm[i] * pcm[i];
  return Math.sqrt(e / Math.max(1, pcm.length));
}
function embedWatermark(pcm, sampleRate, id) {
  if (!ID_PATTERN.test(id)) throw new WatermarkUnsupportedError("id must be 16 lowercase hex characters");
  const p = plan(pcm.length, sampleRate);
  if (!p) throw new WatermarkUnsupportedError("clip is too short or its sample rate is too low");
  const rms = rmsOf(pcm);
  if (rms < MIN_RMS) throw new WatermarkUnsupportedError("clip is too quiet");
  const target = TARGET_REL * rms;
  const bits = bitsFor(id);
  const out = Float32Array.from(pcm);
  for (let s = 0; s < TOTAL_BITS; s++) {
    const w = direction(s, p.slotLen, p.fir, 0);
    const base = s * p.slotLen;
    let c = 0;
    for (let i = 0; i < p.slotLen; i++) c += out[base + i] * w[i];
    const sign = bits[s] ? 1 : -1;
    if (sign * c >= target) continue;
    const add = sign * target - c;
    for (let i = 0; i < p.slotLen; i++) {
      out[base + i] = Math.max(-1, Math.min(1, out[base + i] + add * w[i]));
    }
  }
  return out;
}

// src/engine/voice/watermark.ts
function markSynthesizedPcm(samples, sampleRate) {
  const watermarkId = newWatermarkId();
  try {
    return { pcm: embedWatermark(samples, sampleRate, watermarkId), watermarkId };
  } catch {
    return { pcm: samples, watermarkId: null };
  }
}

// src/engine/voice/voice-clone-engine.ts
var VoiceCloneEngine = class {
  codec;
  acoustic;
  speakerOptions;
  sampleRate;
  constructor(options = {}) {
    this.codec = new NeuralCodec(options.codec);
    this.sampleRate = this.codec.sampleRate;
    this.acoustic = new SSMAcousticModel({
      sampleRate: this.sampleRate,
      numQuantizers: this.codec.quantizers,
      codebookSize: this.codec.vocabSize,
      ...options.acoustic
    });
    this.speakerOptions = { sampleRate: this.sampleRate, ...options.speaker };
  }
  /** Enrol a voice: reference sample ▶ reusable speaker embedding. Run once and
   *  persist the embedding (it's just numbers) — synthesis takes the embedding,
   *  not the raw audio, so the reference never has to be re-fetched per clip. */
  enroll(reference) {
    return encodeSpeaker(reference, this.speakerOptions);
  }
  /** Speak `text` in `speaker`'s voice. */
  async synthesize(options) {
    const activeDevice = await this.resolveDevice(options.device);
    options.signal?.throwIfAborted();
    const text = tokenizeText(options.text);
    const { codec, wordTimestamps } = this.acoustic.generate(
      text,
      options.speaker,
      options.speed ?? 1
    );
    options.signal?.throwIfAborted();
    const { samples } = this.codec.decode(codec);
    peakNormalize(samples, 0.95);
    const durationMs = Math.round(samples.length / this.sampleRate * 1e3);
    const { pcm, watermarkId } = markSynthesizedPcm(samples, this.sampleRate);
    return {
      pcm,
      watermarkId,
      sampleRate: this.sampleRate,
      durationMs,
      wordTimestamps,
      codecTokens: codec,
      activeDevice
    };
  }
  /** Honour an explicit device, else probe (WebGPU preferred for the SSM scan,
   *  CPU always works). Never throws on probe failure — degrades to CPU. */
  async resolveDevice(requested) {
    if (requested) return requested;
    const probed = await probeDevice("auto");
    return probed?.kind ?? "cpu";
  }
};
function peakNormalize(samples, target) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak <= 0) return;
  const gain = target / peak;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
}

// src/engine/voice/provider.ts
var SSMVoiceProvider = class {
  id = "ssm-webgpu";
  engine;
  constructor(options) {
    this.engine = new VoiceCloneEngine(options);
  }
  /** Expose the engine for enrolment (`provider.engine.enroll(...)`). */
  get cloneEngine() {
    return this.engine;
  }
  async isAvailable() {
    return true;
  }
  async unavailableReason() {
    return null;
  }
  synthesize(options) {
    return this.engine.synthesize(options);
  }
};
async function resolveVoiceProvider(providers) {
  if (providers.length === 0) {
    return { provider: null, reason: "No clone provider is configured." };
  }
  const ordered = [...providers].sort((a, b) => preferenceRank(a) - preferenceRank(b));
  const reasons = [];
  for (const provider of ordered) {
    if (await provider.isAvailable()) {
      return { provider, reason: null };
    }
    const reason = await provider.unavailableReason();
    reasons.push(`${provider.id}: ${reason ?? "unavailable"}`);
  }
  return {
    provider: null,
    reason: `Cloning unavailable \u2014 ${reasons.join("; ")}`
  };
}
function preferenceRank(provider) {
  if (provider.id === "ssm-webgpu") return hasWebGPUSupport() ? 0 : 2;
  if (provider.id === "tts-server") return 1;
  return 3;
}

// src/engine/voice/wav.ts
function encodeWav(audio) {
  const { samples, sampleRate } = audio;
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 32768 : clamped * 32767, true);
    offset += 2;
  }
  return buffer;
}
function encodeWavBlob(audio) {
  return new Blob([encodeWav(audio)], { type: "audio/wav" });
}
function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}
export {
  CAMERA_MOVES,
  MODEL_REGISTRY,
  NeuralCodec,
  SSMAcousticModel,
  SSMVoiceProvider,
  TEXT_VOCAB_SIZE,
  UnsupportedVideoEncodingError,
  VideoEngine,
  VoiceCloneEngine,
  buildInterpolatedSequence,
  cameraMoveToMotion,
  composeShotPrompt,
  configureOnnxRuntime,
  cosineSimilarity,
  directorPass,
  encodeSpeaker,
  encodeWav,
  encodeWavBlob,
  estimateBlockMotion,
  getModelOfflineStatus,
  hasWebGPUSupport,
  interpolateFrames,
  isModelAvailableOffline,
  luma,
  melSpectrogram,
  melToWaveform,
  normaliseShotBudget,
  planKeyframeIndices,
  planScene,
  prepareModelOffline,
  probeDevice,
  resolveVoiceProvider,
  setOrtWasmBase,
  shotPlannerPass,
  slerp,
  storyboardFrameCount,
  tokenizeText,
  validateFrame,
  verifySpeaker,
  videoExtensionForMime
};
//# sourceMappingURL=index.mjs.map