/**
 * The training engine's public surface: engine tensors with reverse-mode
 * autograd, functional ops (`F`), modules (`nn`) and optimizers (`optim`).
 * Backend-agnostic — pass `{ backend }` to the constructors (CPU by default;
 * a WebGPU backend comes from `@webdit/torch/webgpu`).
 */
export { DeviceTensor, type GradNode } from "./device-tensor";
export { noGrad, isGradEnabled, setGradEnabled } from "./mode";
export { tidy, keep, startScope, endScope, HostScope } from "./scope";
export {
  tensor,
  intTensor,
  zeros,
  ones,
  randn,
  uniform,
  fromTensor,
  toBackend,
  manualSeed,
  nextSeed,
  type TensorOptions,
} from "./creation";
export * as F from "./functional";
export * as nn from "./nn";
export * as optim from "./optim";
export { cpu, CpuBackend } from "../backend/cpu/cpu-backend";
export {
  UnsupportedOpError,
  DEFAULT_IGNORE_INDEX,
  type Backend,
  type BackendTensor,
  type EngineDType,
  type HostArray,
  type AdamWStep,
  type SgdStep,
} from "../backend/backend";
