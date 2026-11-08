import {
  BUNDLE_IO
} from "./chunk-PAJI6YLR.mjs";

// node_modules/.pnpm/@webdit+runtime@file+..+web_9071895a3a20f5eafecc8e05e48e76a3/node_modules/@webdit/runtime/src/runners-ort.ts
import * as ort from "onnxruntime-web/webgpu";
var OrtDitRunner = class {
  constructor(session) {
    this.session = session;
  }
  session;
  async run(latent, t, textEmb) {
    const ts = new ort.Tensor("float32", new Float32Array([t]), [1]);
    const result = await this.session.run({
      [BUNDLE_IO.dit.inputs.latent]: toOrt(latent),
      [BUNDLE_IO.dit.inputs.timestep]: ts,
      [BUNDLE_IO.dit.inputs.textEmb]: toOrt(textEmb)
    });
    return fromOrt(result[BUNDLE_IO.dit.outputs.velocity]);
  }
  release() {
    return this.session.release();
  }
};
var OrtTextEncoderRunner = class {
  constructor(session) {
    this.session = session;
  }
  session;
  async run(inputIds, attentionMask) {
    const ids = new ort.Tensor("int64", inputIds, [1, inputIds.length]);
    const mask = new ort.Tensor("int64", attentionMask, [1, attentionMask.length]);
    const result = await this.session.run({
      [BUNDLE_IO.textEncoder.inputs.inputIds]: ids,
      [BUNDLE_IO.textEncoder.inputs.attentionMask]: mask
    });
    return fromOrt(result[BUNDLE_IO.textEncoder.outputs.embeddings]);
  }
  release() {
    return this.session.release();
  }
};
var OrtVaeRunner = class {
  constructor(session) {
    this.session = session;
  }
  session;
  async run(latent) {
    const result = await this.session.run({
      [BUNDLE_IO.vae.inputs.latent]: toOrt(latent)
    });
    return result[BUNDLE_IO.vae.outputs.pixels].data;
  }
  release() {
    return this.session.release();
  }
};
function toOrt(t) {
  return new ort.Tensor("float32", t.data, [...t.dims]);
}
function fromOrt(t) {
  return { data: t.data, dims: t.dims };
}
export {
  OrtDitRunner,
  OrtTextEncoderRunner,
  OrtVaeRunner
};
//# sourceMappingURL=runners-ort-PHTNJDIR.mjs.map