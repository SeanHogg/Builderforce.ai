/**
 * EvermindLM's forward pass expressed on the `@webdit/torch` engine, so the
 * loss, its backward and the adapter update all run through ONE autograd graph
 * on whichever backend the worker holds (WebGPU, or the CPU reference).
 *
 * It mirrors `EvermindLM.lossAndBackward` op for op:
 *
 *   x = Embed[tokens]                                   (tied, = the LoRA-merged weight)
 *   per layer:
 *     x += DepthwiseCausalConv(RMSNorm(x, nConv))
 *     x += SharedFFN(h) + Σ_{e ∈ topk} gate_e · Expert_e(h),   h = RMSNorm(x, nMoe)
 *   loss = mean next-token cross-entropy of x · Embedᵀ
 *
 * Cost is linear in sequence length except the tied head (T × vocab):
 *   - the causal conv tap j is a row gather of position t - j (`embedding` over
 *     shifted indices, zeroed before the start) — O(T·d), no T×T operator;
 *   - each routed expert runs only on the rows routed to it (gather → FFN →
 *     `indexAdd` scatter back), as the reference does;
 *   - long sequences are scored in windows (`backwardSequence`) that carry the
 *     model's whole receptive field as unscored context, so every scored
 *     position sees exactly what it sees in the full sequence.
 *
 * Every base weight is a frozen constant; only the embedding the caller passes
 * (base + LoRA delta) carries gradient. Top-k routing is discrete, so the
 * router logits are read back once per layer to pick the experts; the gates are
 * then a masked softmax ON the graph, which is exactly the reference's
 * softmax-over-selected (masked experts get gate 0 and gradient 0).
 */

import {
  DEFAULT_IGNORE_INDEX,
  F,
  endScope,
  intTensor,
  keep,
  startScope,
  tensor,
  type Backend,
  type DeviceTensor,
} from '@webdit/torch/autograd';
import type { EvermindLM } from '@seanhogg/builderforce-memory-engine';

/** EvermindLM's RMSNorm epsilon (`RMS_EPS` in evermind_lm.ts). */
const RMS_EPS = 1e-5;
/** Router logit added to an unselected expert: its softmax weight underflows to exactly 0. */
const MASKED_LOGIT = -1e30;

interface Ffn {
  w1: DeviceTensor;
  b1: DeviceTensor;
  w2: DeviceTensor;
  b2: DeviceTensor;
}

interface LayerWeights {
  /** One [dModel] vector per conv tap j (tap j reads position t - j). */
  taps: DeviceTensor[];
  nConv: DeviceTensor;
  nMoe: DeviceTensor;
  router: DeviceTensor;
  shared: Ffn;
  experts: Ffn[];
}

/** Tap j of the causal conv: row t - j, zero for t < j. */
interface Shift {
  ids: DeviceTensor;
  mask: DeviceTensor;
}

function rmsNorm(x: DeviceTensor, gain: DeviceTensor): DeviceTensor {
  const meanSquare = F.mean(F.mul(x, x), -1, true);
  const rms = F.exp(F.mulScalar(F.log(F.addScalar(meanSquare, RMS_EPS)), 0.5));
  return F.div(F.mul(x, gain), rms);
}

function ffn(h: DeviceTensor, w: Ffn): DeviceTensor {
  return F.linear(F.relu(F.linear(h, w.w1, w.b1)), w.w2, w.b2);
}

/** The experts each position routes to: top-k by router logit, ties to the lower index. */
export function selectExperts(logits: ArrayLike<number>, positions: number, numExperts: number, topK: number): boolean[][] {
  return Array.from({ length: positions }, (_, t) => {
    const row = Array.from({ length: numExperts }, (_, e) => logits[t * numExperts + e]!);
    const order = row.map((_, e) => e).sort((a, b) => row[b]! - row[a]!);
    const picked = new Set(order.slice(0, topK));
    return row.map((_, e) => picked.has(e));
  });
}

export class EvermindEngineGraph {
  private readonly layers: LayerWeights[] = [];
  private readonly constants: DeviceTensor[] = [];
  private readonly numExperts: number;
  private readonly topK: number;
  private readonly convKernel: number;
  /** Positions of unscored context a window needs: the stacked convs' receptive field. */
  readonly receptiveField: number;

  constructor(model: EvermindLM, private readonly backend: Backend) {
    const { dModel, numLayers, convKernel, hiddenDim, numExperts, topK } = model.config;
    this.numExperts = numExperts;
    this.topK = topK;
    this.convKernel = convKernel;
    this.receptiveField = numLayers * (convKernel - 1);
    const params = model.parameters().map((p) => p.data);
    let at = 1; // [0] is the embedding — the caller supplies its LoRA-merged form
    const next = (shape: number[]) => this.constant(params[at++]!, shape);
    const nextFfn = (): Ffn => ({ w1: next([hiddenDim, dModel]), b1: next([hiddenDim]), w2: next([dModel, hiddenDim]), b2: next([dModel]) });
    for (let l = 0; l < numLayers; l += 1) {
      const kernel = params[at++]!;
      const taps = Array.from({ length: convKernel }, (_, j) =>
        this.constant(Float32Array.from({ length: dModel }, (_, c) => kernel[c * convKernel + j]!), [dModel]));
      const nConv = next([dModel]);
      const nMoe = next([dModel]);
      const router = next([numExperts, dModel]);
      const shared = nextFfn();
      const experts = Array.from({ length: numExperts }, nextFfn);
      this.layers.push({ taps, nConv, nMoe, router, shared, experts });
    }
    if (at !== params.length) throw new Error(`EvermindEngineGraph: expected ${params.length} parameters, mapped ${at}.`);
  }

  /** Mean next-token loss of the whole of `tokens` (one window; the parity entry point). */
  async loss(tokens: number[], embedding: DeviceTensor): Promise<DeviceTensor> {
    return F.mulScalar(await this.lossSum(tokens, 0, embedding), 1 / Math.max(1, tokens.length - 1));
  }

  /**
   * Backward of the mean next-token loss over `tokens`, scoring at most
   * `maxScored` predictions per window; gradients accumulate into whatever
   * `embed()` derives from (it is called once per window, inside the window's
   * scope). Exactly the full-sequence gradient: each window prepends
   * {@link receptiveField} positions of context it does not score. Returns the
   * mean loss as a graph-free tensor the caller owns — no readback here.
   */
  async backwardSequence(tokens: number[], embed: () => DeviceTensor, maxScored: number): Promise<DeviceTensor> {
    const predictions = tokens.length - 1;
    if (predictions < 1) throw new Error('backwardSequence: a sequence needs at least two tokens.');
    let total: DeviceTensor | null = null;
    for (let start = 0; start < predictions; start += maxScored) {
      const from = Math.max(0, start - this.receptiveField);
      const window = tokens.slice(from, Math.min(tokens.length, start + maxScored + 1));
      let kept: DeviceTensor[] = [];
      startScope();
      try {
        const part = F.mulScalar(await this.lossSum(window, start - from, embed()), 1 / predictions);
        part.backward();
        kept = [part.detach()];
      } finally {
        endScope(kept);
      }
      const part = keep(kept[0]!);
      if (!total) { total = part; continue; }
      const sum: DeviceTensor = keep(F.add(total, part));
      total.dispose();
      part.dispose();
      total = sum;
    }
    return total!;
  }

  /** Release every frozen weight this graph uploaded. */
  dispose(): void {
    for (const t of this.constants) t.dispose();
    this.constants.length = 0;
    this.layers.length = 0;
  }

  /** Summed next-token loss over positions [firstScored, T - 2]; earlier positions are context only. */
  private async lossSum(tokens: number[], firstScored: number, embedding: DeviceTensor): Promise<DeviceTensor> {
    const T = tokens.length;
    const o = { backend: this.backend };
    const ids = intTensor(tokens, [T], o);
    const targets = intTensor(tokens.map((_, t) => (t >= firstScored && t < T - 1 ? tokens[t + 1]! : DEFAULT_IGNORE_INDEX)), [T], o);
    const shifts: Shift[] = Array.from({ length: this.convKernel - 1 }, (_, i) => {
      const j = i + 1;
      return {
        ids: intTensor(Array.from({ length: T }, (_, t) => Math.max(0, t - j)), [T], o),
        mask: tensor(Array.from({ length: T }, (_, t) => (t >= j ? 1 : 0)), [T, 1], o),
      };
    });
    let x = F.embedding(ids, embedding);
    for (const layer of this.layers) {
      const normed = rmsNorm(x, layer.nConv);
      let mixed = F.mul(normed, layer.taps[0]!);
      shifts.forEach((shift, i) => {
        mixed = F.add(mixed, F.mul(F.mul(F.embedding(shift.ids, normed), shift.mask), layer.taps[i + 1]!));
      });
      const afterConv = F.add(x, mixed);
      x = F.add(afterConv, await this.moe(layer, rmsNorm(afterConv, layer.nMoe), T));
    }
    const logits = F.matmulT(x, embedding, false, true);
    return F.crossEntropy(logits, targets, { reduction: 'sum', ignoreIndex: DEFAULT_IGNORE_INDEX });
  }

  private async moe(layer: LayerWeights, h: DeviceTensor, T: number): Promise<DeviceTensor> {
    const E = this.numExperts;
    const o = { backend: this.backend };
    const routerLogits = F.linear(h, layer.router);
    const selected = selectExperts(await routerLogits.data(), T, E, this.topK);
    const mask = new Float32Array(T * E);
    selected.forEach((row, t) => row.forEach((on, e) => { if (!on) mask[t * E + e] = MASKED_LOGIT; }));
    const gates = F.reshape(F.softmax(F.add(routerLogits, tensor(mask, [T, E], o)), -1), [T * E, 1]);
    let out = ffn(h, layer.shared);
    layer.experts.forEach((expert, e) => {
      const rows = selected.flatMap((row, t) => (row[e] ? [t] : []));
      if (rows.length === 0) return;
      const rowIds = intTensor(rows, [rows.length], o);
      const gate = F.embedding(intTensor(rows.map((t) => t * E + e), [rows.length], o), gates);
      const routed = F.mul(gate, ffn(F.embedding(rowIds, h), expert));
      out = F.add(out, F.indexAdd(rowIds, routed, T));
    });
    return out;
  }

  private constant(data: Float32Array, shape: number[]): DeviceTensor {
    const t = keep(tensor(data, shape, { backend: this.backend }));
    this.constants.push(t);
    return t;
  }
}
