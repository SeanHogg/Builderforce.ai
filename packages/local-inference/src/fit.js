/**
 * Can THIS device run a catalog model — and on which backend? Answered from what the
 * engine reports (WebGPU present, `shader-f16` offered, the largest buffer binding it
 * grants; for `bfi`, its CPU backend's memory budget too) before anyone downloads a
 * gigabyte to find out. Pure: the host asks its engine for the support record
 * (`BfiEngine.support()` or a WebGPU adapter read) and passes it in.
 *
 * WebGPU wins when the model fits it. A row that declares `requires.cpu` may otherwise
 * run on the engine's CPU backend (`bfi` compiled to wasm runs the native kernels in
 * wasm memory) when the device has the memory: its weights + the CPU KV budget + the
 * working set under the memory the browser will grant ({@link cpuMemoryCeiling}), and the
 * device's RAM at least the row's floor. Every constant is Rust's (`kv_plan`, generated
 * into `bfiLimits.generated.ts` at vendor time); the engine applies the same rule.
 */
import { BFI_CPU_LIMITS } from './bfiLimits.generated.js';
/**
 * WebGPU reports no VRAM figure, only the largest single allocation (`maxBufferSize`).
 * A model whose stated GPU memory need exceeds this many such buffers is clearly beyond
 * the adapter; anything under it is left to the engine (advisory, never a false refusal).
 */
export const VRAM_PER_MAX_BUFFER = 8;
const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i;
/** Whether `nav` is a phone or tablet: the UA Client Hint when the browser sends it, else
 *  the user-agent string — with iPadOS, which reports a desktop Mac, caught by touch. */
function isMobileDevice(nav) {
    if (!nav)
        return false;
    const hinted = nav.userAgentData?.mobile;
    if (typeof hinted === 'boolean')
        return hinted;
    const ua = nav.userAgent ?? '';
    return MOBILE_UA.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
}
/**
 * The RAM assumed where nobody reports it (no `navigator.deviceMemory`: Safari, Firefox):
 * Rust's conservative `ASSUMED_DEVICE_MEMORY_BYTES` on a phone or tablet, so it is never
 * offered a model it cannot hold, and `ASSUMED_DESKTOP_MEMORY_BYTES` on a desktop (or a
 * host with no navigator) — whose half is wasm32's 4 GiB cap. Both are generated
 * constants (`bfiLimits.generated.ts`).
 */
export function assumedDeviceMemoryBytes(nav = globalThis.navigator) {
    return isMobileDevice(nav) ? BFI_CPU_LIMITS.assumedDeviceMemoryBytes : BFI_CPU_LIMITS.assumedDesktopMemoryBytes;
}
/**
 * The memory the CPU backend may plan to use on a device with `deviceMemoryBytes` of RAM:
 * wasm32's cap, or the device's share when smaller — an unreported RAM reads as
 * {@link assumedDeviceMemoryBytes} (a phone's conservative size, a desktop's 8 GiB).
 * Rust's `kv_plan::cpu_memory_ceiling`, over the same generated constants.
 */
export function cpuMemoryCeiling(deviceMemoryBytes) {
    const device = deviceMemoryBytes && deviceMemoryBytes > 0 ? deviceMemoryBytes : assumedDeviceMemoryBytes();
    return Math.min(BFI_CPU_LIMITS.wasm32MemoryBytes, Math.floor(device / BFI_CPU_LIMITS.deviceMemoryShareDivisor));
}
function webGpuFit(model, support) {
    if (!support.supported) {
        return { fits: false, reason: 'webgpu_unavailable', ...(support.reason ? { detail: support.reason } : {}) };
    }
    if (model.requires.f16 && !support.f16)
        return { fits: false, reason: 'shader_f16_unavailable' };
    const bindingBytes = support.maxStorageBufferBindingSizeBytes ?? support.maxBufferBytes;
    if (bindingBytes < model.requires.minBufferBytes)
        return { fits: false, reason: 'buffer_too_small' };
    const { vramBytes } = model.requires;
    const maxBuffer = support.maxBufferSizeBytes;
    if (vramBytes && maxBuffer && vramBytes > maxBuffer * VRAM_PER_MAX_BUFFER)
        return { fits: false, reason: 'vram_too_small' };
    return { fits: true, backend: 'webgpu' };
}
/** Whether the CPU backend can hold `model`: Rust's `cpu_memory_bytes` with the KV at its
 *  whole budget (the served context never needs more), under the grantable ceiling. */
function cpuFits(model, cpu) {
    const floor = model.requires.cpu?.minDeviceMemoryBytes;
    if (floor === undefined || !cpu.supported)
        return false;
    if ((cpu.deviceMemoryBytes ?? assumedDeviceMemoryBytes()) < floor)
        return false;
    const need = model.bytes + (cpu.kvBudgetBytes ?? BFI_CPU_LIMITS.cpuKvBudgetBytes) + BFI_CPU_LIMITS.cpuWorkingSetBytes;
    return need <= (cpu.maxMemoryBytes ?? cpuMemoryCeiling(cpu.deviceMemoryBytes));
}
export function localModelFit(model, support) {
    const gpu = webGpuFit(model, support);
    if (gpu.fits)
        return gpu;
    const cpu = support.backends?.cpu;
    if (!model.requires.cpu || !cpu?.supported)
        return gpu;
    if (cpuFits({ requires: model.requires, bytes: model.bytes ?? 0 }, cpu))
        return { fits: true, backend: 'cpu' };
    // A CPU-capable row the device cannot hold: memory, not the GPU, is what is short.
    return { fits: false, reason: 'memory_insufficient' };
}
//# sourceMappingURL=fit.js.map