---
title: "Fine-Tuning Cookbook"
---

# Fine-Tuning Cookbook

A practical, recipe-first guide to adapting a model **on your own data** with Builderforce — the same workflow Meta's llama-cookbook teaches for Llama, mapped onto the Evermind engine and the Builderforce API.

The premise is the same as any fine-tuning guide: *prompting and RAG take you far, but when you have your own labeled data, adapting the weights takes you further.* Builderforce is unusual in that the labeled data is already there — every agent run is scored and its prompt/completion retained — so the "collect a dataset" step is a query, not a project.

This cookbook is organized as three arcs:

1. **Efficient training** — LoRA, QLoRA, mixed precision, activation checkpointing, gradient accumulation, and optimizer-state sharding on the Evermind engine (`@seanhogg/builderforce-memory-engine`).
2. **Your data → a dataset** — turn the run-outcome ledger into SFT and DPO datasets over the API.
3. **Close the loop** — train an adapter, then gate it against the base model before you ship it.

> **When should you fine-tune at all?** Reach for prompting/RAG first. Fine-tune when you need a *behavior* the base model won't reliably produce from context alone — a house style, a tool-call format, a domain vocabulary — and you have ≥ a few hundred labeled examples of it. The recipes below make that cheap enough that the answer is "try it and measure" (Recipe 8).

---

## Background: PEFT vs. full fine-tuning

Full fine-tuning updates every weight and must hold, in memory, the **parameters + gradients + optimizer state** — with AdamW that's roughly *4× the parameter bytes* in fp32. Parameter-Efficient Fine-Tuning (PEFT) freezes the base and trains a tiny add-on instead. Payoffs:

- **Cheap** — you train a low-rank delta, not the whole matrix, so it fits a constrained device.
- **Composable** — an adapter is KB–MB, so a persona / tenant / project is an artifact you *swap*, not a whole checkpoint.
- **Forgetting-safe** — the base never moves, so an adapter can't catastrophically overwrite the pretrained model.

Everything in Arc 1 is PEFT or a memory technique that makes training fit a single device — Evermind's target.

---

## Recipe 1 — LoRA fine-tune EvermindLM

LoRA adds a low-rank delta `ΔW = (α/r)·B·A` on top of a frozen weight. In Evermind it rides the tied token embedding (the dominant parameter, shared by the input lookup and the output head).

```ts
import { EvermindLM, EvermindLMLoRA, BPETokenizer } from '@seanhogg/builderforce-memory-engine';

// A base model (or load a published checkpoint with model.loadWeights(buf)).
const model = new EvermindLM({ vocabSize: tokenizer.vocabSize, dModel: 256, numLayers: 6 });

// Wrap it with a rank-8 LoRA adapter. The base is now frozen.
const lora = new EvermindLMLoRA(model, { rank: 8, alpha: 16 });

// Your training sequences (arrays of token ids from your corpus).
const sequences = corpus.map((text) => tokenizer.encode(text));

// Train ONLY the adapter.
const history = lora.fit(sequences, { epochs: 3, lr: 5e-3 });
console.log('loss per epoch:', history);

// Generate through the adapted model.
const out = lora.generateText('function add(', tokenizer, { maxNewTokens: 64 });
```

**Ship the adapter, not the model.** The adapter serializes to a few KB and reloads onto any copy of the base:

```ts
const adapterBytes = lora.serializeAdapter();          // KB-scale artifact
// ...store it per persona / tenant / project...
const restored = EvermindLMLoRA.loadAdapter(new EvermindLM(cfg), adapterBytes);

// Or bake it into a standalone checkpoint for deployment:
const merged = lora.merge({ fp16: true });             // EVL0 checkpoint bytes
```

`lora.footprint()` reports `{ trainableParams, baseParams, adapterBytes, baseBytes }` — at real vocab the adapter is a small fraction of the full matrix.

---

## Recipe 2 — QLoRA on a constrained device

QLoRA keeps the frozen base **quantized** (int8 or fp16) and trains the adapter in full precision. On a single device — Evermind's WebGPU target — the frozen base is where most bytes live, so quantizing it is the biggest memory win.

```ts
// int8 base ≈ ¼ the fp32 bytes; fp16 ≈ ½. The adapter still trains full-precision.
const qlora = new EvermindLMLoRA(model, { rank: 8, alpha: 16, baseQuant: 'int8' });

qlora.fit(sequences, { epochs: 3, lr: 5e-3 });

const fp = qlora.footprint();
console.log(`base ${fp.baseBytes}B, adapter ${fp.adapterBytes}B`);
```

Everything else (serialize / load / merge / generate) is identical to Recipe 1.

---

## Recipe 3 — Fit longer sequences and bigger batches

Three orthogonal knobs on `EvermindLMTrainer` (full fine-tuning) let a single device train past its naive memory limit:

```ts
import { EvermindLM, EvermindLMTrainer } from '@seanhogg/builderforce-memory-engine';

const trainer = new EvermindLMTrainer(model, {
  epochs: 3,
  lr: 3e-4,

  // Gradient accumulation: average over N micro-batches before each step,
  // for a larger *effective* batch without the memory of a large real batch.
  accumSteps: 8,

  // Activation checkpointing: recompute layer activations in the backward pass
  // instead of retaining them all — identical gradients, one-layer peak memory.
  checkpoint: true,

  // Mixed precision: fp16-rounded gradients with dynamic loss scaling over fp32
  // master weights. Overflowing steps are skipped and the scale backs off.
  mixedPrecision: { initScale: 65536 },
});

trainer.fit(sequences);
console.log('loss scale settled at', trainer.lossScaler?.scale);
```

- **`accumSteps`** trades steps for batch size — use it when a single micro-batch fits but the batch you *want* doesn't.
- **`checkpoint`** trades compute for memory — use it when a longer `seqLen` or an extra layer won't fit.
- **`mixedPrecision`** halves activation/gradient precision — the `DynamicLossScaler` prevents fp16 gradients from underflowing (a gradient below ~6e-5 would round to zero unscaled).

All three compose, and all three leave the math correct (the checkpointed path is gradient-for-gradient identical to the full one).

---

## Recipe 4 — Train a larger model with optimizer-state sharding

Optimizer state (AdamW's two moments) is ~2× the parameter bytes and often the memory ceiling. Sharding (ZeRO-1 / the idea behind FSDP) splits that state across owners so each holds only a slice.

```ts
import { AdamW } from '@seanhogg/builderforce-memory-engine';

// Two owners over the SAME model — each allocates half the optimizer state.
const shard0 = new AdamW(model, { lr: 3e-4, shard: { index: 0, count: 2 } });
const shard1 = new AdamW(model, { lr: 3e-4, shard: { index: 1, count: 2 } });

model.zeroGrad();
model.lossAndBackward(seq);
shard0.step();          // updates the tensors it owns
shard1.step();          // updates the rest
// The union equals one unsharded step, at half the state each.

console.log('state held:', shard0.stateBytes(), '+', shard1.stateBytes());
```

On one process this caps resident moment memory; it is also the exact seam a multi-device trainer partitions on.

---

## Recipe 5 — Build an SFT dataset from your own runs

You don't collect a dataset — you already have one. Every terminal agent run is scored 0..1 in the outcome ledger, and its verbatim prompt/completion is retained. `GET /api/dataset/sft` distills the **positive-outcome** runs into `{prompt, completion}` examples.

```bash
# JSON envelope with a count:
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.builderforce.ai/api/dataset/sft?actionType=code&minScore=0.8"

# JSONL, ready to stream into a training job:
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.builderforce.ai/api/dataset/sft?actionType=code&minScore=0.8&requireMerged=true&format=jsonl" \
  > sft.jsonl
```

| Query param | Meaning | Default |
|---|---|---|
| `actionType` | Restrict to one task type (`code`, `chat`, …) | all |
| `minScore` | Minimum outcome score to count a run as a positive example | `0.7` |
| `requireMerged` | Only runs whose PR merged | `false` |
| `requireCiGreen` | Only runs with green CI | `false` |
| `limit` | Max records (hard-capped at 5000) | `500` |
| `format` | `jsonl` for newline-delimited records | JSON envelope |

Each record is `{ prompt, completion, meta: { model, actionType, score } }`. The prompt is the model's instruction context (system + user turns); the completion is what it produced on a run that merged / passed / was accepted.

---

## Recipe 6 — Build a DPO preference dataset

Preference tuning (DPO) needs, for the *same* prompt, a better answer and a worse one. `GET /api/dataset/dpo` finds prompts that were attempted more than once and pairs the highest-scoring completion (`chosen`) against the lowest (`rejected`), gated by a score margin.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.builderforce.ai/api/dataset/dpo?actionType=code&minMargin=0.3&format=jsonl" \
  > dpo.jsonl
```

Each record is `{ prompt, chosen, rejected, meta: { actionType, chosenScore, rejectedScore, margin } }`. Because pairing is by identical prompt, these are genuine preference pairs (the same task, a good and a bad attempt), not cross-prompt guesses.

Both dataset endpoints are cached read-through and invalidate automatically the moment a new run is scored, so a fresh pull always reflects the latest labeled runs.

---

## Recipe 7 — The full loop: telemetry → adapter → deploy

```ts
// 1. Pull your SFT set (server-side, or fetch the JSONL and load it).
const res = await fetch(`${API}/api/dataset/sft?actionType=code&minScore=0.8`, { headers });
const { records } = await res.json();

// 2. Tokenize prompt+completion into training sequences.
const sequences = records.map((r) =>
  tokenizer.encode(`${r.prompt}\n${r.completion}`),
);

// 3. LoRA-train an adapter over your base Evermind.
const lora = new EvermindLMLoRA(base, { rank: 8, alpha: 16 });
lora.fit(sequences, { epochs: 3, lr: 5e-3, accumSteps: 4 });

// 4. Ship the adapter (KB) — swap it in per tenant/persona/project.
const adapter = lora.serializeAdapter();
```

---

## Recipe 8 — Gate a fine-tune before you promote it

Never route real traffic to a fine-tune you haven't shown beats its base. `GET /api/eval/variant-compare` runs a Welch's t-test over the two variants' production outcome scores and returns both the comparison **and** a promote/hold decision.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://api.builderforce.ai/api/eval/variant-compare?base=evermind/base&candidate=evermind/ft-code&actionType=code"
```

```jsonc
{
  "comparison": {
    "base":      { "model": "evermind/base",    "n": 214, "meanScore": 0.61, "stdev": 0.18 },
    "candidate": { "model": "evermind/ft-code",  "n": 187, "meanScore": 0.74, "stdev": 0.15 },
    "delta": 0.13, "relImprovement": 0.21,
    "tStat": 7.6, "pValue": 0.000, "significant": true, "verdict": "better"
  },
  "decision": { "promote": true, "reason": "candidate wins by Δ=0.130 (p=0.000, n=187)" }
}
```

`decision.promote` is `true` only when the win is **statistically significant**, the candidate **actually wins**, and the margin clears a practical floor at a real sample size — otherwise it holds and tells you why (`insufficient samples`, `not statistically significant`, `win below margin`). This is the gate that decides whether an `evermind/<ft>` variant graduates into auto-routing.

You can run the same test in-process on any two score arrays:

```ts
import { compareVariants, passesPromotionGate } from './application/eval/variantEval';

const cmp = compareVariants('base', baseScores, 'candidate', candidateScores);
if (passesPromotionGate(cmp, { minDelta: 0.02, minSamples: 30 }).promote) {
  // promote the fine-tune
}
```

---

## API & symbol reference

**Engine — `@seanhogg/builderforce-memory-engine`**

| Symbol | Purpose |
|---|---|
| `EvermindLM` | The base generative model (forward / `lossAndBackward` / `generate`). |
| `EvermindLMTrainer` | Full fine-tuning; opts `accumSteps`, `checkpoint`, `mixedPrecision`. |
| `EvermindLMLoRA` | LoRA/QLoRA wrapper; `fit`, `serializeAdapter`, `loadAdapter`, `merge`, `footprint`. |
| `LoRAAdapter` | Standalone low-rank adapter over any matrix. |
| `AdamW` | Optimizer; opt `shard:{index,count}` for ZeRO-1 sharding. |
| `DynamicLossScaler` | Dynamic loss scaling for mixed-precision training. |
| `quantizeBase` | Quantize a frozen base (`none`/`fp16`/`int8`) for QLoRA. |

**API**

| Endpoint | Purpose |
|---|---|
| `GET /api/dataset/sft` | SFT `{prompt, completion}` examples from positive-outcome runs. |
| `GET /api/dataset/dpo` | DPO `{chosen, rejected}` pairs from same-prompt attempts. |
| `GET /api/eval/variant-compare` | Fine-tune-vs-base t-test + promote/hold decision. |
| `GET /api/eval/drift` | Per-(action, model) quality-drift report. |

All API routes are tenant-scoped (bearer auth) and cached read-through.

---

## Notes & limits

- The recipes above run on the engine's **CPU reference path** (used by the Node/on-prem runner and the test suite). The WebGPU/WGSL kernels are catching up to this toolkit; until then, treat the CPU path as the source of truth for training semantics.
- DPO pairs require a prompt to have been attempted more than once with a real score spread — high-traffic action types yield the most pairs.
- Datasets and the variant-eval read the same outcome ledger the learned router trusts, so improving your acceptance/merge/CI signal directly improves your training data quality.
