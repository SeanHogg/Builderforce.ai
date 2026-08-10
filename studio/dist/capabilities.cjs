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

// src/engine/device-router.ts
var device_router_exports = {};
__export(device_router_exports, {
  hasWebGPUSupport: () => hasWebGPUSupport,
  probeDevice: () => probeDevice,
  watchDeviceLoss: () => watchDeviceLoss
});
module.exports = __toCommonJS(device_router_exports);
function hasWebGPUSupport() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}
async function probeDevice(target = "auto", opts = {}) {
  const order = target === "auto" ? ["webnn", "webgpu", "cpu"] : target === "cpu" ? ["cpu"] : target === "webgpu" ? ["webgpu"] : ["webnn"];
  for (const candidate of order) {
    const probed = await probeOne(candidate, opts);
    if (probed) return probed;
  }
  return null;
}
function watchDeviceLoss(device, onLost) {
  void device.lost.then((info) => {
    if (info.reason === "destroyed") return;
    onLost(info);
  });
}
async function probeOne(kind, opts) {
  if (kind === "webnn") return probeWebNN();
  if (kind === "webgpu") return probeWebGPU(opts);
  return probeCpu();
}
async function probeWebNN() {
  if (typeof navigator === "undefined") return null;
  const nav = navigator;
  if (!nav.ml || typeof nav.ml.createContext !== "function") return null;
  for (const deviceType of ["npu", "gpu"]) {
    try {
      const ctx = await nav.ml.createContext({ deviceType, powerPreference: "high-performance" });
      if (ctx) {
        return {
          kind: "webnn",
          mlContext: ctx,
          label: `WebNN (${deviceType.toUpperCase()})`,
          approxMemoryMb: null
        };
      }
    } catch {
    }
  }
  return null;
}
async function probeWebGPU(opts) {
  if (!hasWebGPUSupport()) return null;
  const nav = navigator;
  if (!nav.gpu) return null;
  try {
    const adapter = await nav.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxBufferSize: Math.min(adapter.limits.maxBufferSize, 2147483648),
        maxStorageBufferBindingSize: Math.min(
          adapter.limits.maxStorageBufferBindingSize,
          2147483648
        )
      }
    });
    watchDeviceLoss(device, (info2) => {
      console.warn("[device-router] WebGPU device lost:", info2.message || info2.reason);
      opts.onDeviceLost?.(info2);
    });
    const info = adapter.info;
    const label = [info?.vendor, info?.architecture, info?.device].filter(Boolean).join(" ") || "WebGPU device";
    return { kind: "webgpu", gpuDevice: device, label, approxMemoryMb: null };
  } catch {
    return null;
  }
}
function probeCpu() {
  return {
    kind: "cpu",
    label: "CPU (WASM SIMD)",
    approxMemoryMb: null
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  hasWebGPUSupport,
  probeDevice,
  watchDeviceLoss
});
//# sourceMappingURL=capabilities.cjs.map