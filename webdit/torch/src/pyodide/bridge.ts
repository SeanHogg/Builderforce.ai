import { UnsupportedOpError } from "../backend/backend";
import { cpu } from "../backend/cpu/cpu-backend";
import { createWebGPUBackend } from "../backend/webgpu/webgpu-backend";
import { intTensor, manualSeed, ones, randn, tensor, uniform, zeros } from "../autograd/creation";
import type { AnyBackend, DeviceTensor } from "../autograd/device-tensor";
import { isGradEnabled, setGradEnabled } from "../autograd/mode";
import { keep } from "../autograd/scope";
import { AdamW } from "../autograd/optim/adamw";
import type { Optimizer } from "../autograd/optim/optimizer";
import { SGD } from "../autograd/optim/sgd";
import { HandleTable } from "./handles";
import { runOp, type OpArg } from "./ops";
import { copyInto, decodeStateDict, encodeStateDict } from "./state-dict";

/**
 * `@webdit/torch/pyodide` — the JS module the Python `torch` package drives,
 * registered as `pyodide.registerJsModule('_webdit_torch', bridge)` in the same
 * Worker as the engine. Tensor data never enters the Python heap: Python holds
 * integer ids (see `HandleTable` for the lifetime rule), passes scalars, shapes
 * (`to_js(list)` → JS Array) and buffers (`to_js(memoryview)` → TypedArray, one
 * memcpy, no element loop), and gets back ids, numbers and strings.
 *
 * Readback is the only async call (`read`, `item`, `to_device`, `save`,
 * `load`): each returns a Promise, which the Python side waits on with
 * `pyodide.ffi.run_sync` (JSPI) or exposes as an awaitable (`item_async()`).
 */

export type DeviceName = "webgpu" | "cpu";

export interface TorchBridgeOptions {
  /** The WebGPU entry point (`navigator.gpu` by default); `false` keeps the bridge on the CPU. */
  gpu?: GPU | false;
  /** A ready backend to serve as the `webgpu` device instead of creating one (tests, a host sharing its device). */
  webgpuBackend?: AnyBackend;
  /** The CPU backend (default: the engine's reference backend). */
  cpuBackend?: AnyBackend;
}

type Shape = ArrayLike<number>;
type MaybeDevice = string | undefined | null;

export interface TorchBridge {
  /** Devices this worker has, best first ("webgpu,cpu" or "cpu"). */
  devices(): string;
  /** Why WebGPU is absent ("" when present). */
  webgpu_unavailable_reason(): string;
  default_device(): DeviceName;
  set_default_device(name: string): void;
  manual_seed(seed: number): void;

  from_buffer(data: Float32Array | Int32Array, shape: Shape, device?: MaybeDevice, requiresGrad?: boolean): number;
  zeros(shape: Shape, device?: MaybeDevice, requiresGrad?: boolean): number;
  ones(shape: Shape, device?: MaybeDevice, requiresGrad?: boolean): number;
  full(shape: Shape, value: number, device?: MaybeDevice, requiresGrad?: boolean): number;
  randn(shape: Shape, device?: MaybeDevice, requiresGrad?: boolean, std?: number): number;
  uniform(shape: Shape, low: number, high: number, device?: MaybeDevice, requiresGrad?: boolean): number;

  /** "dtype|d0,d1,…|device" — fixed for the tensor's life, cached by Python. */
  meta(id: number): string;
  requires_grad(id: number): boolean;
  set_requires_grad(id: number, flag: boolean): void;
  is_leaf(id: number): boolean;
  /** A new id for `.grad`, or undefined (Python None). */
  grad(id: number): number | undefined;

  op(name: string, ...args: OpArg[]): number;
  backward(id: number, gradient?: number, retainGraph?: boolean): void;
  set_grad_enabled(flag: boolean): boolean;
  is_grad_enabled(): boolean;
  zero_grad(ids: ArrayLike<number>, setToNone?: boolean): void;
  copy_into(dst: number, src: number): void;
  /** The storage version (`Tensor._version`). */
  version(id: number): number;
  /** `t.grad = g`: `g` (same shape, dtype, device) becomes the tensor's gradient, owned by it. */
  set_grad(id: number, gradId: number): void;

  optimizer(kind: string, ids: ArrayLike<number>, lr: number, a?: number, b?: number, c?: number, d?: number): number;
  optimizer_step(optId: number, lr: number): void;
  optimizer_release(optId: number): void;

  read(id: number): Promise<Float32Array | Int32Array>;
  item(id: number): Promise<number>;
  to_device(id: number, device: string): Promise<number>;
  /** `metadata`: a JSON object of string values for the safetensors `__metadata__` (peft's `peft_type`, …). */
  save(names: ArrayLike<string>, ids: ArrayLike<number>, metadata?: string): Promise<Uint8Array>;
  /** Resolves to `{ names, ids }` (Python: `.to_py()`). */
  load(bytes: Uint8Array, device?: MaybeDevice): Promise<{ names: string[]; ids: number[] }>;

  release(id: number): void;
  /** Run the collector now; returns the number of tensors freed. */
  collect(): number;
  /** JSON: live ids, pinned tensors, scope-held tensors, optimizers. */
  stats(): string;
}

/** Normalize a device name: `cuda` / `gpu` mean the WebGPU device (there is no CUDA in a browser). */
function normalizeDevice(name: string): DeviceName {
  const base = name.split(":")[0]!.toLowerCase();
  if (base === "webgpu" || base === "cuda" || base === "gpu") return "webgpu";
  if (base === "cpu") return "cpu";
  throw new Error(`torch: unknown device "${name}" (use "webgpu" or "cpu")`);
}

export async function createTorchBridge(options: TorchBridgeOptions = {}): Promise<TorchBridge> {
  const cpuBackend = options.cpuBackend ?? cpu;
  let gpuBackend: AnyBackend | null = options.webgpuBackend ?? null;
  let unavailable = "";
  if (!gpuBackend) {
    if (options.gpu === false) unavailable = "disabled by the host";
    else {
      try {
        gpuBackend = await createWebGPUBackend(options.gpu ? { gpu: options.gpu } : {});
      } catch (error) {
        unavailable = error instanceof Error ? error.message : String(error);
      }
    }
  }
  let defaultDevice: DeviceName = gpuBackend ? "webgpu" : "cpu";

  const handles = new HandleTable();
  const optimizers = new Map<number, Optimizer>();
  let nextOpt = 1;

  const backendFor = (device: MaybeDevice): AnyBackend => {
    const name = device ? normalizeDevice(device) : defaultDevice;
    if (name === "cpu") return cpuBackend;
    if (!gpuBackend) throw new Error(`torch: the webgpu device is unavailable here (${unavailable})`);
    return gpuBackend;
  };
  const deviceOf = (t: DeviceTensor): DeviceName => (t.backend === cpuBackend ? "cpu" : "webgpu");
  const T = (id: OpArg): DeviceTensor => {
    if (typeof id !== "number") throw new TypeError(`expected a tensor, got ${id === undefined ? "None" : typeof id}`);
    return handles.get(id);
  };
  const shapeOf = (shape: Shape) => Array.from(shape);
  const put = (t: DeviceTensor) => handles.put(t);
  /** Upload host values as a new leaf. Must run inside `handles.run` so the tensor joins the bridge scope. */
  const fromHost = (data: Float32Array | Int32Array, shape: Shape, backend: AnyBackend, requiresGrad: boolean) => {
    const o = { backend, requiresGrad };
    return put(data instanceof Int32Array ? intTensor(data, shapeOf(shape), o) : tensor(data, shapeOf(shape), o));
  };
  const optimizerOf = (optId: number) => {
    const o = optimizers.get(optId);
    if (!o) throw new Error(`torch bridge: optimizer ${optId} is not live`);
    return o;
  };

  const syncCalls: Omit<TorchBridge, AsyncCall> = {
    devices: () => (gpuBackend ? "webgpu,cpu" : "cpu"),
    webgpu_unavailable_reason: () => unavailable,
    default_device: () => defaultDevice,
    set_default_device: (name) => {
      const d = normalizeDevice(name);
      backendFor(d);
      defaultDevice = d;
    },
    manual_seed: (seed) => manualSeed(seed),

    from_buffer: (data, shape, device, requiresGrad) => fromHost(data, shape, backendFor(device), requiresGrad === true),
    zeros: (shape, device, rg) => put(zeros(shapeOf(shape), { backend: backendFor(device), requiresGrad: rg === true })),
    ones: (shape, device, rg) => put(ones(shapeOf(shape), { backend: backendFor(device), requiresGrad: rg === true })),
    full: (shape, value, device, rg) => {
      const s = shapeOf(shape);
      const data = new Float32Array(s.reduce((n, d) => n * d, 1)).fill(value);
      return put(tensor(data, s, { backend: backendFor(device), requiresGrad: rg === true }));
    },
    randn: (shape, device, rg, std) =>
      put(randn(shapeOf(shape), { backend: backendFor(device), requiresGrad: rg === true, std: std ?? undefined })),
    uniform: (shape, low, high, device, rg) =>
      put(uniform(shapeOf(shape), low, high, { backend: backendFor(device), requiresGrad: rg === true })),

    meta: (id) => {
      const t = handles.get(id);
      return `${t.dtype}|${t.shape.join(",")}|${deviceOf(t)}`;
    },
    requires_grad: (id) => handles.get(id).requiresGrad,
    set_requires_grad: (id, flag) => {
      const t = handles.get(id);
      if (!t.isLeaf) throw new Error("requires_grad_: you can only change requires_grad flags of leaf tensors");
      t.setRequiresGrad(flag);
    },
    is_leaf: (id) => handles.get(id).isLeaf,
    grad: (id) => {
      const g = handles.get(id).grad;
      return g && !g.isDisposed ? put(g) : undefined;
    },

    op: (name, ...args) => put(runOp(name, T, args)),
    backward: (id, gradient, retainGraph) => {
      handles.get(id).backward(gradient === undefined || gradient === null ? undefined : handles.get(gradient), {
        retainGraph: retainGraph === true,
      });
      handles.collect();
    },
    set_grad_enabled: (flag) => {
      const previous = setGradEnabled(flag);
      if (flag && !previous) handles.collect(); // leaving no_grad: its results hold no graph
      return previous;
    },
    is_grad_enabled: () => isGradEnabled(),
    zero_grad: (ids, setToNone) => {
      for (const id of Array.from(ids)) {
        const p = handles.get(id);
        const g = p.grad;
        if (!g || g.isDisposed) continue;
        if (setToNone === false) {
          // PyTorch: zeroed IN PLACE — a `.grad` Python holds sees the zeros.
          const zero = p.backend.full(g.shape, 0);
          p.backend.copyInPlace(g.handle, zero);
          p.backend.release(zero);
          continue;
        }
        p.grad = null;
        if (handles.isPinned(g)) handles.adopt(g);
        else g.dispose();
      }
      handles.collect();
    },
    // The write bumps the storage's version; a pending graph that read the old values fails at backward (PyTorch's check).
    copy_into: (dst, src) => copyInto(handles.get(dst), handles.get(src)),
    version: (id) => handles.get(id).version,
    set_grad: (id, gradId) => {
      const p = handles.get(id);
      const g = handles.get(gradId);
      if (g.backend !== p.backend || g.dtype !== p.dtype || g.shape.join() !== p.shape.join()) {
        throw new Error(`assigned grad has data of a different type, device or shape than the tensor ([${g.shape}] vs [${p.shape}])`);
      }
      const previous = p.grad;
      p.grad = keep(g);
      if (previous && previous !== g && !previous.isDisposed) {
        if (handles.isPinned(previous)) handles.adopt(previous);
        else previous.dispose();
      }
    },

    optimizer: (kind, ids, lr, a, b, c, d) => {
      const params = Array.from(ids, (id) => handles.get(id));
      let o: Optimizer;
      if (kind === "adamw") o = new AdamW(params, { lr, betas: [a ?? 0.9, b ?? 0.999], eps: c ?? 1e-8, weightDecay: d ?? 0.01 });
      else if (kind === "sgd") o = new SGD(params, { lr, momentum: a ?? 0, weightDecay: b ?? 0 });
      else throw new Error(`torch.optim: ${kind} is not in the @webdit/torch surface`);
      optimizers.set(nextOpt, o);
      return nextOpt++;
    },
    optimizer_step: (optId, lr) => {
      const o = optimizerOf(optId) as Optimizer & { lr: number };
      o.lr = lr;
      o.step();
      handles.collect();
    },
    optimizer_release: (optId) => {
      optimizers.get(optId)?.dispose();
      optimizers.delete(optId);
    },

    release: (id) => handles.release(id),
    collect: () => handles.collect(),
    stats: () => JSON.stringify({ ...handles.stats(), optimizers: optimizers.size }),
  };

  // Readback awaits; whatever it creates afterwards is created inside `handles.run`.
  const asyncCalls: Pick<TorchBridge, AsyncCall> = {
    read: (id) => handles.get(id).data(),
    item: (id) => handles.get(id).item(),
    /**
     * A copy on another device. A leaf keeps its `requires_grad` (a new leaf);
     * a non-leaf that requires grad is refused while grad mode is on — the copy
     * crosses a readback, which cannot be recorded in the graph.
     */
    to_device: async (id, device) => {
      const t = handles.get(id);
      if (!t.isLeaf && t.requiresGrad && isGradEnabled()) {
        throw new UnsupportedOpError("Tensor.to(device)", "on a non-leaf that requires grad (the device copy is not differentiable); move the leaves instead");
      }
      const backend = backendFor(device);
      const data = await t.data();
      return handles.run(() => fromHost(data, t.shape, backend, t.requiresGrad && t.isLeaf));
    },
    save: (names, ids, metadata) => {
      const n = Array.from(names);
      const meta = metadata ? (JSON.parse(metadata) as Record<string, unknown>) : {};
      const strings = Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v)]));
      return encodeStateDict(
        Array.from(ids, (id, i) => [n[i]!, handles.get(id)] as [string, DeviceTensor]),
        strings,
      );
    },
    load: async (bytes, device) => {
      const backend = backendFor(device);
      const entries = await decodeStateDict(bytes);
      const ids = handles.run(() => entries.map((e) => fromHost(e.data, e.shape, backend, false)));
      return { names: entries.map((e) => e.name), ids };
    },
  };

  return { ...enterScopeAround(handles, syncCalls), ...asyncCalls };
}

type AsyncCall = "read" | "item" | "to_device" | "save" | "load";

/** Every synchronous call runs inside the bridge's scope, so each tensor it makes is tracked — and nothing else is. */
function enterScopeAround<T extends object>(handles: HandleTable, calls: T): T {
  const wrapped: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(calls)) {
    wrapped[name] = (...args: unknown[]) => handles.run(() => (fn as (...a: unknown[]) => unknown)(...args));
  }
  return wrapped as T;
}
