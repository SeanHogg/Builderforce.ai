/**
 * Real-mini architecture: a small but structurally-correct DiT expressed in
 * @webdit/torch primitives. ~few-hundred-K params. Used to prove the full
 * pipeline (convert → bundle → load → forward → frames) on a real
 * transformer architecture, not a hand-rolled toy.
 *
 *   - Patch embedding via Linear (no Conv2d in V0; latent voxels treated as tokens)
 *   - N transformer blocks: MHA(RoPE) + MLP, with timestep+text conditioning
 *     added at block input (V0 simplification of AdaLN-Zero)
 *   - Final LayerNorm + Linear back to latent channels
 *
 * Weight tensor names (in shards):
 *   "in_proj.weight"  : [hidden, c]
 *   "in_proj.bias"    : [hidden]
 *   "out_proj.weight" : [c, hidden]
 *   "out_proj.bias"   : [c]
 *   "final_norm.gamma": [hidden]
 *   "final_norm.beta" : [hidden]
 *   "t_emb.proj1.weight": [hidden, t_dim]
 *   "t_emb.proj1.bias"  : [hidden]
 *   "t_emb.proj2.weight": [hidden, hidden]
 *   "t_emb.proj2.bias"  : [hidden]
 *   "text_pool.weight": [hidden, text_dim]
 *   "text_pool.bias"  : [hidden]
 *   For each block i in 0..N-1:
 *     "block{i}.norm1.gamma" / "norm1.beta" : [hidden]
 *     "block{i}.qkv_*" / "out_proj"         : 4 × [hidden, hidden] linears
 *     "block{i}.norm2.gamma" / "norm2.beta" : [hidden]
 *     "block{i}.mlp_up.weight"   : [4*hidden, hidden]
 *     "block{i}.mlp_up.bias"     : [4*hidden]
 *     "block{i}.mlp_down.weight" : [hidden, 4*hidden]
 *     "block{i}.mlp_down.bias"   : [hidden]
 */
import {
  add,
  expand,
  fromArray,
  fromIntArray,
  matmul,
  mean,
  permute,
  reshape,
  Tensor,
  tensorOf,
  unsqueeze,
} from "@webdit/torch";
import {
  type RopeFreqs,
  Linear,
  LayerNorm,
  MultiHeadAttention,
  TimestepEmbedding,
  TransformerBlock,
  ropeFreqs,
} from "@webdit/torch/nn";
import { dequantize, type QuantizedTensor } from "@webdit/shared";

export interface RealMiniConfig {
  latentChannels: number; // C
  hiddenDim: number; // D
  numHeads: number;
  numBlocks: number;
  textDim: number;
  timestepInDim: number;
}

export const REAL_MINI_CONFIG: RealMiniConfig = {
  latentChannels: 4,
  hiddenDim: 32,
  numHeads: 4,
  numBlocks: 2,
  textDim: 8,
  timestepInDim: 32,
};

export class RealMiniDit {
  private readonly rope: RopeFreqs;

  constructor(
    readonly config: RealMiniConfig,
    readonly inProj: Linear,
    readonly tEmb: TimestepEmbedding,
    readonly textPool: Linear,
    readonly blocks: TransformerBlock[],
    readonly finalNorm: LayerNorm,
    readonly outProj: Linear,
    /** Pre-computed RoPE table sized to the largest sequence we expect. */
    ropeMaxLen: number,
  ) {
    this.rope = ropeFreqs(ropeMaxLen, config.hiddenDim / config.numHeads);
  }

  forward(latent: Tensor, timestep: number, textEmb: Tensor): Tensor {
    // latent : [1, C, T, H, W]
    // textEmb: [1, L, text_dim]
    if (latent.ndim !== 5) {
      throw new Error(`RealMiniDit: expected 5D latent, got ${latent.ndim}D`);
    }
    const B = latent.shape[0]!;
    const C = latent.shape[1]!;
    const T = latent.shape[2]!;
    const H = latent.shape[3]!;
    const W = latent.shape[4]!;
    const D = this.config.hiddenDim;
    const seq = T * H * W;

    // [B, C, T, H, W] -> [B, C, T*H*W] -> [B, T*H*W, C]
    const flat = permute(reshape(latent.contiguous(), [B, C, seq]), [0, 2, 1]).contiguous();
    let h = this.inProj.forward(flat); // [B, seq, D]

    // Conditioning: timestep (broadcast over batch) + text-pool
    const tCond = this.tEmb.forward(timestep); // [1, D]
    const textPooled = mean(textEmb, [1]); // [B, text_dim]
    const textCond = this.textPool.forward(textPooled); // [B, D]
    const cond = add(expand(tCond, textCond.shape), textCond); // [B, D]

    for (const block of this.blocks) {
      h = block.forward(h, cond, this.rope);
    }
    h = this.finalNorm.forward(h);
    h = this.outProj.forward(h); // [B, seq, C]

    // Back to [B, C, T, H, W]
    return reshape(permute(h, [0, 2, 1]).contiguous(), latent.shape);
  }
}

export class RealMiniVae {
  /** vae.proj : [3, C] — channel projection only (no spatial upsampling in V0). */
  constructor(readonly proj: Tensor) {}

  forward(latent: Tensor): Tensor {
    // latent: [B, C, T, H, W] -> [B, 3, T, H, W]
    if (latent.ndim !== 5) {
      throw new Error(`RealMiniVae: expected 5D latent, got ${latent.ndim}D`);
    }
    const B = latent.shape[0]!;
    const C = latent.shape[1]!;
    const T = latent.shape[2]!;
    const H = latent.shape[3]!;
    const W = latent.shape[4]!;
    // Reshape to [B, C, T*H*W] -> [B, T*H*W, C] -> matmul with proj^T [C, 3] -> [B, T*H*W, 3]
    const flat = permute(reshape(latent.contiguous(), [B, C, T * H * W]), [0, 2, 1]).contiguous();
    const projT = permute(this.proj, [1, 0]); // [C, 3]
    const projected = matmul(flat, projT); // [B, T*H*W, 3]
    // Tanh squash to [-1, 1]
    const tanhData = new Float32Array(projected.size);
    const src = projected.contiguous().data as Float32Array;
    for (let i = 0; i < src.length; i++) tanhData[i] = Math.tanh(src[i]!);
    const squashed = Tensor.contiguous(tanhData, projected.shape, "float32");
    // Permute back to [B, 3, T*H*W] -> reshape to [B, 3, T, H, W]
    return reshape(permute(squashed, [0, 2, 1]).contiguous(), [B, 3, T, H, W]);
  }
}

export class RealMiniTextEncoder {
  /** vocab table: [vocab_size, text_dim]. */
  constructor(readonly vocab: Tensor) {}

  forward(inputIds: BigInt64Array): Tensor {
    const L = inputIds.length;
    const D = this.vocab.shape[1]!;
    const V = this.vocab.shape[0]!;
    const data = new Float32Array(L * D);
    const w = (this.vocab.contiguous().data as Float32Array);
    for (let l = 0; l < L; l++) {
      const id = Number(inputIds[l]!) % V;
      const safeId = id < 0 ? id + V : id;
      const src = safeId * D;
      const dst = l * D;
      for (let d = 0; d < D; d++) data[dst + d] = w[src + d]!;
    }
    return Tensor.contiguous(data, [1, L, D], "float32");
  }
}

/**
 * Build all three real-mini modules from a flat shard map. Throws with the
 * missing tensor name if anything is absent — easy to debug a bad bundle.
 */
export function loadRealMini(
  ditShards: Map<string, QuantizedTensor>,
  textShards: Map<string, QuantizedTensor>,
  vaeShards: Map<string, QuantizedTensor>,
  config: RealMiniConfig = REAL_MINI_CONFIG,
  ropeMaxLen = 256,
): {
  dit: RealMiniDit;
  textEncoder: RealMiniTextEncoder;
  vae: RealMiniVae;
} {
  const tensorFromShard = (
    shards: Map<string, QuantizedTensor>,
    name: string,
  ): Tensor => {
    const t = shards.get(name);
    if (!t) {
      throw new Error(
        `loadRealMini: missing weight '${name}' (have: ${Array.from(shards.keys()).join(", ") || "<none>"})`,
      );
    }
    return tensorOf(dequantize(t), t.shape, "float32");
  };
  const w = (n: string) => tensorFromShard(ditShards, n);

  const linearOf = (weightName: string, biasName?: string): Linear =>
    new Linear(w(weightName), biasName ? w(biasName) : null);

  const layerNormOf = (gammaName: string, betaName: string): LayerNorm =>
    new LayerNorm(w(gammaName), w(betaName), 1e-6);

  const tEmb = new TimestepEmbedding(
    linearOf("t_emb.proj1.weight", "t_emb.proj1.bias"),
    linearOf("t_emb.proj2.weight", "t_emb.proj2.bias"),
    config.timestepInDim,
  );

  const blocks: TransformerBlock[] = [];
  for (let i = 0; i < config.numBlocks; i++) {
    const prefix = `block${i}`;
    const mha = new MultiHeadAttention(
      linearOf(`${prefix}.q.weight`, `${prefix}.q.bias`),
      linearOf(`${prefix}.k.weight`, `${prefix}.k.bias`),
      linearOf(`${prefix}.v.weight`, `${prefix}.v.bias`),
      linearOf(`${prefix}.attn_out.weight`, `${prefix}.attn_out.bias`),
      config.numHeads,
    );
    blocks.push(
      new TransformerBlock(
        layerNormOf(`${prefix}.norm1.gamma`, `${prefix}.norm1.beta`),
        mha,
        layerNormOf(`${prefix}.norm2.gamma`, `${prefix}.norm2.beta`),
        linearOf(`${prefix}.mlp_up.weight`, `${prefix}.mlp_up.bias`),
        linearOf(`${prefix}.mlp_down.weight`, `${prefix}.mlp_down.bias`),
      ),
    );
  }

  const dit = new RealMiniDit(
    config,
    linearOf("in_proj.weight", "in_proj.bias"),
    tEmb,
    linearOf("text_pool.weight", "text_pool.bias"),
    blocks,
    layerNormOf("final_norm.gamma", "final_norm.beta"),
    linearOf("out_proj.weight", "out_proj.bias"),
    ropeMaxLen,
  );

  const textEncoder = new RealMiniTextEncoder(
    tensorFromShard(textShards, "vocab"),
  );

  const vae = new RealMiniVae(tensorFromShard(vaeShards, "proj"));

  // Silence unused imports kept available for callers building tensors directly.
  void fromArray;
  void fromIntArray;
  void unsqueeze;

  return { dit, textEncoder, vae };
}
