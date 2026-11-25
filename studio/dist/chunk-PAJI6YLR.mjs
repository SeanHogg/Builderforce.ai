// node_modules/.pnpm/@webdit+shared@file+..+webdit+shared/node_modules/@webdit/shared/src/quant.ts
var Q4_GROUP = 32;
var f32buf = new ArrayBuffer(4);
var f32 = new Float32Array(f32buf);
var u32 = new Uint32Array(f32buf);
function halfToFloat(half) {
  const sign = (half & 32768) << 16;
  const exp = (half & 31744) >>> 10;
  const mant = half & 1023;
  if (exp === 0) {
    if (mant === 0) {
      u32[0] = sign;
      return f32[0];
    }
    const s = sign ? -1 : 1;
    return s * (mant / 1024) * Math.pow(2, -14);
  }
  if (exp === 31) {
    u32[0] = sign | 2139095040 | mant << 13;
    return f32[0];
  }
  u32[0] = sign | exp - 15 + 127 << 23 | mant << 13;
  return f32[0];
}
var bf16buf = new ArrayBuffer(4);
var bf16f32 = new Float32Array(bf16buf);
var bf16u32 = new Uint32Array(bf16buf);
function dequantize(q) {
  switch (q.quantization) {
    case "f16": {
      const aligned = new Uint8Array(q.data);
      const u16 = new Uint16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 2);
      const out = new Float32Array(u16.length);
      for (let i = 0; i < u16.length; i++) out[i] = halfToFloat(u16[i]);
      return out;
    }
    case "q8f16_0": {
      const aligned = new Uint8Array(q.data);
      const i8 = new Int8Array(aligned.buffer, aligned.byteOffset, aligned.byteLength);
      const scale = halfToFloat(q.scales[0]);
      const out = new Float32Array(i8.length);
      for (let i = 0; i < i8.length; i++) out[i] = i8[i] * scale;
      return out;
    }
    case "q4f16_1": {
      const out = new Float32Array(q.data.length * 2);
      for (let g = 0; g < q.scales.length; g++) {
        const scale = halfToFloat(q.scales[g]);
        const base = g * Q4_GROUP;
        for (let i = 0; i < Q4_GROUP; i += 2) {
          const byte = q.data[(base + i) / 2];
          out[base + i] = signExtend4(byte & 15) * scale;
          out[base + i + 1] = signExtend4(byte >>> 4 & 15) * scale;
        }
      }
      return out;
    }
  }
}
function signExtend4(v) {
  return v & 8 ? v - 16 : v;
}

// node_modules/.pnpm/@webdit+shared@file+..+webdit+shared/node_modules/@webdit/shared/src/shard.ts
function parseBundleShard(buf) {
  if (buf.byteLength < 8) {
    throw new Error("shard: file shorter than 8-byte header length prefix");
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerLen = Number(view.getBigUint64(0, true));
  if (headerLen < 0 || 8 + headerLen > buf.byteLength) {
    throw new Error(`shard: declared header length ${headerLen} exceeds file size ${buf.byteLength}`);
  }
  const headerStr = new TextDecoder().decode(buf.subarray(8, 8 + headerLen));
  let header;
  try {
    header = JSON.parse(headerStr);
  } catch (e) {
    throw new Error(`shard: header is not valid JSON: ${e.message}`);
  }
  const dataStart = 8 + headerLen;
  const tensors = /* @__PURE__ */ new Map();
  for (const [name, entry] of Object.entries(header)) {
    const dataLo = dataStart + entry.data[0];
    const dataHi = dataStart + entry.data[1];
    const scaleLo = dataStart + entry.scales[0];
    const scaleHi = dataStart + entry.scales[1];
    if (dataHi > buf.byteLength || scaleHi > buf.byteLength) {
      throw new Error(`shard: tensor '${name}' offsets exceed file size`);
    }
    const data = copyOwned(buf.subarray(dataLo, dataHi));
    const scaleBytes = copyOwned(buf.subarray(scaleLo, scaleHi));
    if (scaleBytes.byteLength % 2 !== 0) {
      throw new Error(`shard: tensor '${name}' scale length not multiple of 2`);
    }
    const scales = new Uint16Array(scaleBytes.buffer, scaleBytes.byteOffset, scaleBytes.byteLength / 2);
    tensors.set(name, {
      data,
      scales,
      shape: entry.shape,
      quantization: entry.quantization
    });
  }
  return {
    tensors,
    headerBytes: 8 + headerLen,
    totalBytes: buf.byteLength
  };
}
function copyOwned(view) {
  const owned = new Uint8Array(view.byteLength);
  owned.set(view);
  return owned;
}

// node_modules/.pnpm/@webdit+shared@file+..+webdit+shared/node_modules/@webdit/shared/src/index.ts
var BUNDLE_IO = {
  dit: {
    inputs: { latent: "latent", timestep: "timestep", textEmb: "text_emb" },
    outputs: { velocity: "velocity" }
  },
  textEncoder: {
    inputs: { inputIds: "input_ids", attentionMask: "attention_mask" },
    outputs: { embeddings: "text_emb" }
  },
  vae: {
    inputs: { latent: "latent" },
    outputs: { pixels: "pixels" }
  }
};

export {
  dequantize,
  parseBundleShard,
  BUNDLE_IO
};
//# sourceMappingURL=chunk-PAJI6YLR.mjs.map