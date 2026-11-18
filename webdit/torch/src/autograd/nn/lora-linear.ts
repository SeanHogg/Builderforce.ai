import { uniform, zeros, type TensorOptions } from "../creation";
import type { DeviceTensor } from "../device-tensor";
import { linear } from "../functional/linalg";
import { loraMerge } from "../functional/nn";
import { Linear } from "./layers";
import { Module } from "./module";

/**
 * LoRA linear: a frozen base `Linear` plus trainable low-rank adapters,
 *
 *   y = x (W + (α / r) · B A)ᵀ + b,    A: [r, in],  B: [out, r]
 *
 * PEFT's init: A ~ U(-1/√in, 1/√in), B = 0, so the merged weight starts equal
 * to the base. The merge runs as one op (`loraMerge`), which on WebGPU is the
 * `LORA_FORWARD_WGSL` kernel and its chain-rule `LORA_BACKWARD_WGSL`.
 */

export interface LoraOptions {
  rank: number;
  alpha?: number;
  backend?: TensorOptions["backend"];
  bias?: boolean;
  /** An existing Linear to adapt instead of a freshly initialized one. */
  base?: Linear;
}

export class LoRALinear extends Module {
  readonly base: Linear;
  readonly loraA: DeviceTensor;
  readonly loraB: DeviceTensor;
  readonly rank: number;
  readonly scale: number;

  constructor(inFeatures: number, outFeatures: number, options: LoraOptions) {
    super();
    if (!Number.isInteger(options.rank) || options.rank < 1) throw new Error(`LoRALinear: rank must be a positive integer, got ${options.rank}`);
    this.rank = options.rank;
    this.scale = (options.alpha ?? options.rank) / options.rank;
    const base = options.base ?? new Linear(inFeatures, outFeatures, { backend: options.backend, bias: options.bias });
    if (base.inFeatures !== inFeatures || base.outFeatures !== outFeatures) {
      throw new Error(`LoRALinear: base is ${base.inFeatures}→${base.outFeatures}, expected ${inFeatures}→${outFeatures}`);
    }
    this.base = this.registerModule("base", base);
    for (const p of this.base.parameters()) p.setRequiresGrad(false);
    const bound = 1 / Math.sqrt(inFeatures);
    const o = { backend: options.backend, requiresGrad: true };
    this.loraA = this.registerParameter("lora_A", uniform([this.rank, inFeatures], -bound, bound, o));
    this.loraB = this.registerParameter("lora_B", zeros([outFeatures, this.rank], o));
  }

  /** Wrap an existing (e.g. pretrained) Linear; its parameters are frozen. */
  static fromLinear(base: Linear, options: Omit<LoraOptions, "bias" | "base">): LoRALinear {
    return new LoRALinear(base.inFeatures, base.outFeatures, { ...options, backend: base.weight.backend, base });
  }

  forward(x: DeviceTensor): DeviceTensor {
    const merged = loraMerge(this.base.weight, this.loraA, this.loraB, this.scale);
    return linear(x, merged, this.base.bias);
  }
}
