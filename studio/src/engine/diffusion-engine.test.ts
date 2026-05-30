import { describe, it, expect, vi } from 'vitest';

/**
 * Registry contract guard for the "input 'X' is missing in 'feeds'" family of
 * runtime ORT errors:
 *
 *   1. Every name in a model's `unetInputNames` must have a registered builder
 *      in UNET_INPUT_BUILDERS. A name without a builder fails the build at
 *      session.run() time — this test catches it before that.
 *   2. LCM exports require the `timestep_cond` input + an embedding dim.
 *   3. Standard SD UNets (SD-Turbo) must NOT declare `timestep_cond` — feeding
 *      it would trigger an "unknown input" error from the other direction.
 *
 * Mock the heavy runtime modules so this test runs in node without a browser
 * or a real ORT/WASM load; we only inspect the declared shape of the registry.
 */

vi.mock('onnxruntime-web', () => ({
  env: { versions: { common: '0.0.0-test' }, wasm: {} },
  // Tensor is referenced by UNET_INPUT_BUILDERS at module load; provide a stub
  // so importing diffusion-engine doesn't blow up.
  Tensor: class {
    constructor(_type: string, _data: unknown, _dims: number[]) {}
  },
  InferenceSession: { create: vi.fn() },
}));
vi.mock('@huggingface/transformers', () => ({
  env: { allowLocalModels: true, backends: { onnx: { wasm: {} } } },
  AutoTokenizer: { from_pretrained: vi.fn() },
}));

import { MODEL_REGISTRY, KNOWN_UNET_INPUTS } from './diffusion-engine';

describe('MODEL_REGISTRY × UNet input contract', () => {
  for (const [id, descriptor] of Object.entries(MODEL_REGISTRY)) {
    it(`${id}: every declared UNet input has a registered builder`, () => {
      for (const name of descriptor.unetInputNames) {
        expect(
          KNOWN_UNET_INPUTS.has(name),
          `Model '${id}' declares UNet input '${name}' but UNET_INPUT_BUILDERS has no builder for it. Add one to diffusion-engine.ts.`,
        ).toBe(true);
      }
    });
  }

  it("lcm-dreamshaper-v7 declares 'timestep_cond' + lcmGuidanceEmbedDim (regression: 'input timestep_cond is missing in feeds')", () => {
    const lcm = MODEL_REGISTRY['lcm-dreamshaper-v7'];
    expect(lcm.unetInputNames).toContain('timestep_cond');
    expect(lcm.lcmGuidanceEmbedDim).toBeGreaterThan(0);
  });

  it("sd-turbo does NOT declare 'timestep_cond' (it is a non-LCM UNet)", () => {
    const sdt = MODEL_REGISTRY['sd-turbo'];
    expect(sdt.unetInputNames).not.toContain('timestep_cond');
    expect(sdt.lcmGuidanceEmbedDim).toBeUndefined();
  });

  it("every model declares the three base inputs sample / timestep / encoder_hidden_states", () => {
    for (const [id, descriptor] of Object.entries(MODEL_REGISTRY)) {
      for (const required of ['sample', 'timestep', 'encoder_hidden_states']) {
        expect(
          descriptor.unetInputNames,
          `${id} is missing required base UNet input '${required}'`,
        ).toContain(required);
      }
    }
  });
});
