import { CAST_KERNELS } from "./cast";
import type { KernelEntry } from "./common";
import { ELEMENTWISE_KERNELS } from "./elementwise";
import { EMBEDDING_KERNELS } from "./embedding";
import { LAYERNORM_KERNELS } from "./layernorm";
import { LAYOUT_KERNELS } from "./layout";
import { LORA_KERNELS } from "./lora";
import { MATMUL_KERNELS } from "./matmul";
import { OPTIM_KERNELS } from "./optim";
import { SOFTMAX_KERNELS } from "./softmax";

/**
 * THE kernel registry: op name → WGSL entry. Data only — the WebGPU backend
 * looks kernels up here by name and compiles each once per device. A new
 * kernel is a new entry in its family file; nothing else lists them.
 */
export const KERNEL_REGISTRY = {
  ...ELEMENTWISE_KERNELS,
  ...LAYOUT_KERNELS,
  ...MATMUL_KERNELS,
  ...SOFTMAX_KERNELS,
  ...LAYERNORM_KERNELS,
  ...EMBEDDING_KERNELS,
  ...LORA_KERNELS,
  ...OPTIM_KERNELS,
  ...CAST_KERNELS,
} satisfies Record<string, KernelEntry>;

export type KernelName = keyof typeof KERNEL_REGISTRY;
