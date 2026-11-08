"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; }// src/engine/device-router.ts
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
    } catch (e) {
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
      _optionalChain([opts, 'access', _ => _.onDeviceLost, 'optionalCall', _2 => _2(info2)]);
    });
    const info = adapter.info;
    const label = [_optionalChain([info, 'optionalAccess', _3 => _3.vendor]), _optionalChain([info, 'optionalAccess', _4 => _4.architecture]), _optionalChain([info, 'optionalAccess', _5 => _5.device])].filter(Boolean).join(" ") || "WebGPU device";
    return { kind: "webgpu", gpuDevice: device, label, approxMemoryMb: null };
  } catch (e2) {
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





exports.hasWebGPUSupport = hasWebGPUSupport; exports.probeDevice = probeDevice; exports.watchDeviceLoss = watchDeviceLoss;
//# sourceMappingURL=chunk-VKVEFIZW.cjs.map