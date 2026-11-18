import { describe, expect, it } from "vitest";
import { buildCsr } from "../src/backend/webgpu/embedding-csr";
import { ADAMW_WGSL, KERNEL_REGISTRY, LORA_BACKWARD_WGSL, LORA_FORWARD_WGSL } from "../src/backend/webgpu/kernels";

/** Registry data checks — no GPU needed. (Compiling every kernel runs in webgpu-parity.) */

describe("kernel registry", () => {
  it("each entry declares as many bindings as its WGSL binds", () => {
    for (const [name, entry] of Object.entries(KERNEL_REGISTRY)) {
      const declared = (entry.wgsl.match(/@binding\(/g) ?? []).length;
      expect(declared, name).toBe(entry.bindings);
    }
  });

  it("every kernel spills its index into gid.y (no dispatch is capped at 65 535 workgroups)", () => {
    for (const [name, entry] of Object.entries(KERNEL_REGISTRY)) {
      expect(entry.wgsl.replace(/\s/g, ""), name).toContain("gid.y*65535u*256u");
    }
  });

  it("the trainer's kernels keep their bindings and parameter slots", () => {
    // The original trainer's direct-dispatch contract (16-float block); `frontend/src/lib/training/**` now uses them via the engine.
    expect(LORA_FORWARD_WGSL).toContain("merged[idx]=base[idx]+p[3]*delta;");
    expect(LORA_BACKWARD_WGSL).toContain("ga[idx]=ga[idx]+scale*sum;");
    // p[11] is never written by the trainer (stays 0) ⇒ the gradient is still consumed for it.
    expect(ADAMW_WGSL).toContain("if(p[11]==0.0){g[i]=0.0;}");
  });

  it("CSR grouping for the embedding gradient keeps position order and drops out-of-range ids", () => {
    const { rowStart, positions } = buildCsr(Int32Array.from([2, 0, 2, 9, -1, 0, 2]), 3);
    expect(Array.from(rowStart)).toEqual([0, 2, 2, 5]);
    expect(Array.from(positions)).toEqual([1, 5, 0, 2, 6]);
  });
});
