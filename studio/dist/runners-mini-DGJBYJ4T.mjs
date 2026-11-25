import {
  dequantize
} from "./chunk-PAJI6YLR.mjs";

// node_modules/.pnpm/@webdit+runtime@file+..+web_9071895a3a20f5eafecc8e05e48e76a3/node_modules/@webdit/runtime/src/runners-mini.ts
var MiniDitRunner = class {
  scale;
  bias;
  constructor(weights) {
    this.scale = requireWeight(weights, "dit.scale");
    this.bias = requireWeight(weights, "dit.bias");
  }
  async run(latent, t, textEmb) {
    const dims = latent.dims;
    if (dims.length !== 5) {
      throw new Error(`MiniDitRunner: expected 5D latent, got ${dims.length}D`);
    }
    const [_b, c, T, H, W] = dims;
    const planeSize = T * H * W;
    let textPool = 0;
    for (const v of textEmb.data) textPool += v;
    textPool /= Math.max(1, textEmb.data.length);
    const out = new Float32Array(latent.data.length);
    for (let ci = 0; ci < c; ci++) {
      const s = this.scale[ci] * t;
      const b = this.bias[ci] + textPool;
      const base = ci * planeSize;
      for (let p = 0; p < planeSize; p++) {
        const idx = base + p;
        out[idx] = latent.data[idx] * s + b;
      }
    }
    return { data: out, dims };
  }
};
var MiniTextEncoderRunner = class {
  proj;
  vocab;
  embedDim;
  constructor(weights, manifest) {
    const tensor = requireWeightWithShape(weights, "te.proj");
    this.proj = tensor.data;
    this.vocab = tensor.shape[0];
    this.embedDim = tensor.shape[1];
    if (manifest.textEncoder.embedDim !== this.embedDim) {
      throw new Error(
        `MiniTextEncoderRunner: manifest embedDim=${manifest.textEncoder.embedDim} but te.proj is [${this.vocab}, ${this.embedDim}]`
      );
    }
  }
  async run(inputIds, _attentionMask) {
    const L = inputIds.length;
    const D = this.embedDim;
    const out = new Float32Array(L * D);
    for (let l = 0; l < L; l++) {
      const id = Number(inputIds[l]) % this.vocab;
      const safeId = id < 0 ? id + this.vocab : id;
      const src = safeId * D;
      const dst = l * D;
      for (let d = 0; d < D; d++) out[dst + d] = this.proj[src + d];
    }
    return { data: out, dims: [1, L, D] };
  }
};
var MiniVaeRunner = class {
  proj;
  outChannels;
  inChannels;
  spatialUp;
  temporalUp;
  constructor(weights, manifest) {
    const tensor = requireWeightWithShape(weights, "vae.proj");
    this.proj = tensor.data;
    this.outChannels = tensor.shape[0];
    this.inChannels = tensor.shape[1];
    this.spatialUp = manifest.vaeCompression.spatial;
    this.temporalUp = manifest.vaeCompression.temporal;
  }
  async run(latent) {
    const [_b, c, T, H, W] = latent.dims;
    if (c !== this.inChannels) {
      throw new Error(
        `MiniVaeRunner: latent channels=${c} but vae.proj expects ${this.inChannels}`
      );
    }
    const Tout = T * this.temporalUp;
    const Hout = H * this.spatialUp;
    const Wout = W * this.spatialUp;
    const outChan = this.outChannels;
    const out = new Float32Array(outChan * Tout * Hout * Wout);
    const planeIn = T * H * W;
    const planeOut = Tout * Hout * Wout;
    for (let oc = 0; oc < outChan; oc++) {
      for (let t = 0; t < Tout; t++) {
        for (let h = 0; h < Hout; h++) {
          for (let w = 0; w < Wout; w++) {
            const it = Math.floor(t / this.temporalUp);
            const ih = Math.floor(h / this.spatialUp);
            const iw = Math.floor(w / this.spatialUp);
            let acc = 0;
            for (let ic = 0; ic < this.inChannels; ic++) {
              const lat = latent.data[ic * planeIn + it * H * W + ih * W + iw];
              acc += lat * this.proj[oc * this.inChannels + ic];
            }
            out[oc * planeOut + t * Hout * Wout + h * Wout + w] = Math.tanh(acc);
          }
        }
      }
    }
    return out;
  }
};
function requireWeight(weights, name) {
  return requireWeightWithShape(weights, name).data;
}
function requireWeightWithShape(weights, name) {
  const t = weights.get(name);
  if (!t) {
    throw new Error(
      `MiniRunner: missing required weight '${name}'. Available: ${Array.from(weights.keys()).join(", ") || "<none>"}`
    );
  }
  return { data: dequantize(t), shape: t.shape };
}
export {
  MiniDitRunner,
  MiniTextEncoderRunner,
  MiniVaeRunner
};
//# sourceMappingURL=runners-mini-DGJBYJ4T.mjs.map