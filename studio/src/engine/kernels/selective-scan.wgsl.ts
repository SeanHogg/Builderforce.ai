/**
 * WGSL source for one diagonal selective-scan (SSM recurrence) step:
 *
 *     h'[c,k] = decay * h[c,k] + gain * u[c]
 *
 * One invocation per state cell (idx = c * order + k). Identical math to the
 * CPU reference `selectiveScanStepCpu` in ../selective-scan.ts.
 *
 * Why in-studio rather than the builderforce-memory-engine export: that
 * package's SELECTIVE_SCAN_FORWARD_WGSL is the full Mamba-1 block kernel
 * (input-dependent delta/A/B/C, [batch, seq, d_inner] layouts, many bindings).
 * Coherence state advance is a fixed-decay leaky integrator over a handful of
 * cells; mapping it onto that kernel would change the math and pull a peer
 * dependency the studio does not declare.
 */

export const SELECTIVE_SCAN_WORKGROUP_SIZE = 64;

export const SELECTIVE_SCAN_STEP_WGSL: string = /* wgsl */ `
struct Params {
  channels : u32,
  order    : u32,
  decay    : f32,
  gain     : f32,
};

@group(0) @binding(0) var<uniform>             params : Params;
@group(0) @binding(1) var<storage, read>       state  : array<f32>;
@group(0) @binding(2) var<storage, read>       pooled : array<f32>;
@group(0) @binding(3) var<storage, read_write> next   : array<f32>;

@compute @workgroup_size(${SELECTIVE_SCAN_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let total = params.channels * params.order;
  if (idx >= total) { return; }
  let c = idx / params.order;
  next[idx] = params.decay * state[idx] + params.gain * pooled[c];
}
`;
