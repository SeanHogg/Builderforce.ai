/**
 * `@webdit/torch/kernels` — the kernel registry and the WGSL sources, as plain
 * strings. No WebGPU types are needed to import this entry, so a consumer that
 * drives a kernel itself (the frontend's browser trainer) takes its WGSL from
 * here instead of keeping a copy.
 */
export { KERNEL_REGISTRY, type KernelName } from "./registry";
export { type KernelEntry, WORKGROUP_SIZE, MAX_RANK } from "./common";
export { LORA_FORWARD_WGSL, LORA_BACKWARD_WGSL } from "./lora";
export { ADAMW_WGSL, SGD_WGSL, TRAINER_PARAM_FLOATS } from "./optim";
