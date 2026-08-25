// src/engine/device-router.ts
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

export {
  hasWebGPUSupport,
  probeDevice,
  watchDeviceLoss
};
//# sourceMappingURL=chunk-J5TFPZVT.mjs.map