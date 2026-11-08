"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { newObj[key] = obj[key]; } } } newObj.default = obj; return newObj; } }

var _chunkK2U2AOBXcjs = require('./chunk-K2U2AOBX.cjs');

// node_modules/.pnpm/@webdit+runtime@file+..+web_9071895a3a20f5eafecc8e05e48e76a3/node_modules/@webdit/runtime/src/runners-ort.ts
var _webgpu = require('onnxruntime-web/webgpu'); var ort = _interopRequireWildcard(_webgpu);
var OrtDitRunner = class {
  constructor(session) {
    this.session = session;
  }
  
  async run(latent, t, textEmb) {
    const ts = new ort.Tensor("float32", new Float32Array([t]), [1]);
    const result = await this.session.run({
      [_chunkK2U2AOBXcjs.BUNDLE_IO.dit.inputs.latent]: toOrt(latent),
      [_chunkK2U2AOBXcjs.BUNDLE_IO.dit.inputs.timestep]: ts,
      [_chunkK2U2AOBXcjs.BUNDLE_IO.dit.inputs.textEmb]: toOrt(textEmb)
    });
    return fromOrt(result[_chunkK2U2AOBXcjs.BUNDLE_IO.dit.outputs.velocity]);
  }
  release() {
    return this.session.release();
  }
};
var OrtTextEncoderRunner = class {
  constructor(session) {
    this.session = session;
  }
  
  async run(inputIds, attentionMask) {
    const ids = new ort.Tensor("int64", inputIds, [1, inputIds.length]);
    const mask = new ort.Tensor("int64", attentionMask, [1, attentionMask.length]);
    const result = await this.session.run({
      [_chunkK2U2AOBXcjs.BUNDLE_IO.textEncoder.inputs.inputIds]: ids,
      [_chunkK2U2AOBXcjs.BUNDLE_IO.textEncoder.inputs.attentionMask]: mask
    });
    return fromOrt(result[_chunkK2U2AOBXcjs.BUNDLE_IO.textEncoder.outputs.embeddings]);
  }
  release() {
    return this.session.release();
  }
};
var OrtVaeRunner = class {
  constructor(session) {
    this.session = session;
  }
  
  async run(latent) {
    const result = await this.session.run({
      [_chunkK2U2AOBXcjs.BUNDLE_IO.vae.inputs.latent]: toOrt(latent)
    });
    return result[_chunkK2U2AOBXcjs.BUNDLE_IO.vae.outputs.pixels].data;
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




exports.OrtDitRunner = OrtDitRunner; exports.OrtTextEncoderRunner = OrtTextEncoderRunner; exports.OrtVaeRunner = OrtVaeRunner;
//# sourceMappingURL=runners-ort-ZS33O7ZV.cjs.map