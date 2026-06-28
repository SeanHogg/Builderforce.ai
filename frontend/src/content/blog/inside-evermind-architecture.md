---
title: "Inside Evermind: The Architecture of a Self-Updating Model"
date: 2026-06-28
description: A technical deep-dive into Evermind — the selective state-space cortex, the write-through knowledge memory with its single-incumbent invariant, and the trainable limbic layer. The math, the proofs, and an honest account of what is measured versus what is hypothesized.
tags: [evermind, ssm, mamba, write-through-cognition, architecture, webgpu, research]
author: Sean Hogg
---

# Inside Evermind: The Architecture of a Self-Updating Model

We published the short version of [why Evermind exists](/blog/evermind-self-updating-model): frozen models go stale the moment they ship, and bolting a RAG store on the side just moves the staleness somewhere else. This is the long version — the actual architecture, the equations behind it, and a deliberately honest account of what we have *proven*, what we have *built*, and what is still a *hypothesis*.

It accompanies a full technical report written for peer review. If you want the dissertation-grade treatment with every equation cited to its source file, that document is the place to go. This post is the guided tour.

## The thesis, stated precisely

Evermind treats **currency**, not scale, as the primary design axis. The bet is not "a small model can out-parameter a big one" — it can't, and we don't claim it does. The bet is that an architecture whose *knowledge is always current by construction*, that *owns its own generation*, and that *fits inside the runtime where the work happens* wins on the axes a frozen frontier model structurally gives up.

Evermind is the model itself — not memory bolted onto someone else's LLM. It is three cooperating layers that mirror a coarse neuro-functional decomposition.

![Evermind's three-layer architecture: a selective state-space cortex, a write-through hippocampus, and a trainable limbic layer, fronted by an inference router with an optional frontier bridge](/blog/evermind-architecture-full.svg)

- **Cortex** — a shared-expert hybrid state-space model that generates language in linear time *and* can take a gradient step on the device that serves it.
- **Hippocampus** — a write-through knowledge memory that *replaces* beliefs on write instead of appending them.
- **Limbic** — a small trainable recurrent cell that modulates affect.

All three are differentiable. All three run on WebGPU with zero runtime dependencies. Let's take them in turn.

## The cortex: a selective state-space generator

The generator is not an attention stack — it is a selective state-space model (SSM) of the Mamba family. Each channel keeps a hidden state `h_t` that evolves under an input-dependent linear recurrence. After a zero-order-hold discretization with a content-selective step size `Δ_t`, the per-token update is simply:

```
Ā_t = exp(Δ_t · A)              # state decay (A stored as log(−A) for stability)
B̄_t = (Ā_t − 1) / A · B_t       # input gain
h_t = Ā_t ⊙ h_{t−1} + B̄_t · x_t  # recurrence
y_t = C_t · h_t + D · x_t        # readout
```

The word that matters is **selective**: `Δ_t`, `B_t`, and `C_t` are projected from the token itself, so the dynamics depend on content. That is what gives an SSM attention-like expressivity at linear cost.

Inside a block, the input is RMS-normalized, projected, passed through a causal 1-D convolution and a SiLU gate, run through the selective scan, gated again by `SiLU(z)`, down-projected, and added back to a residual stream. Three variants share this skeleton: **Mamba-1** (the S6 scan above), **Mamba-2** (structured state-space duality — one scalar `A` per head, exposing a matrix-multiply form), and **Mamba-3** (a complex-valued state with exponential-trapezoidal discretization, giving oscillatory modes a real diagonal `A` cannot represent). Optional attention layers can be interleaved in a hybrid schedule.

![The selective SSM block: RMSNorm, input projection, causal conv, the selective scan driven by input-dependent (Δ, B, C), a SiLU gate, and a residual add](/blog/evermind-ssm-block.svg)

### Why it parallelizes

A linear recurrence looks sequential, but it isn't. Write each step as a pair `(a, b) = (Ā_t, B̄_t·x_t)` and define the operator

```
(a₁, b₁) ∘ (a₂, b₂) = (a₁·a₂,  a₁·b₂ + b₁)
```

This operator is **associative** (the technical report proves it, with identity `(1, 0)`), and the running second component of the prefix product is exactly `h_t`. Associativity is the whole game: any associative scan computes all prefixes in `⌈log₂ L⌉` parallel sweeps. So the states for a length-`L` sequence come out in `O(log L)` span and `O(L)` work — versus the `O(L²)` work of dense attention.

![The selective recurrence evaluated as a parallel associative prefix scan — log L sweeps over pairs (a, b)](/blog/evermind-parallel-scan.svg)

### It trains on the device that serves it

The engine ships a tape-based reverse-mode autograd and a GPU AdamW optimizer, so the cortex can take gradient steps in the browser. We also use **WSLA** (Weight-Selective Layer Adaptation): online updates touch only the selective-projection rows that decide how content is routed into state, freezing the bulk representation. That is what makes online learning cheap enough to run in a few epochs without a separate training cluster.

## The hippocampus: Write-Through Cognition

Here is the part that is genuinely different. Caching keeps *answers* fresh; the hippocampus keeps *knowledge* fresh.

Every candidate fact flows through one pipeline: **canonicalize** to a stable subject key → **recall** the incumbent belief → **evaluate** evidence → **reconcile** → **write through**. Reconciliation returns one of four verdicts:

- **augment** — brand-new subject; write it.
- **confirm** — identical to the incumbent; just refresh confidence.
- **supersede** — conflicts, and the evidence backs the new claim; *replace* the incumbent.
- **reject** — conflicts, evidence doesn't back it; keep the incumbent.

The store is a partial map from key to *one* content. There is no append. That gives a property we can state as a theorem and prove: **at every step, the store holds at most one content per key, and a superseded fact is gone — not merely outranked.** An append-only RAG store can resurface a stale fact at retrieval time; Evermind structurally cannot, because the stale content no longer exists. By construction, the contradiction rate is zero.

Recall is served through a **version-token cache**: the cache key embeds a global version counter, and any `supersede`/`augment` increments it. One increment invalidates *every* cached recall in `O(1)` — no per-entry sweep. Reads are therefore always current.

## Recall: hybrid retrieval

When the model reaches into memory, it fuses two rankers — dense cosine similarity over normalized embeddings and a BM25 lexical score — with reciprocal rank fusion (`k = 60`), then diversifies the top of the list with maximal marginal relevance (`λ = 0.7`). The result is a hard-capped top-K (default 5) with truncated content, so memory *lowers* prompt size instead of inflating it.

![Hybrid recall: dense cosine and sparse BM25 rankings fused by reciprocal rank fusion and diversified by MMR](/blog/evermind-hybrid-recall.svg)

## The limbic layer

The smallest of the three: a gated recurrent cell that maps an experience embedding and an affective state to a bounded affect delta and a reward estimate. The update is a leaky integrator — a learned gate decides how much prior affect persists versus how much new experience is admitted. **Personality is encoded as fixed setpoints; the limbic cell supplies the dynamics around them.** It is trained with a simple MSE objective on observed `(Δaffect, reward)` targets.

## Routing and online distillation

A request first hits a cheapest-first router. No frontier bridge configured? Serve from the on-device SSM. Otherwise the router escalates only when a cheap syntactic test (complexity keywords, input length) or, last, a perplexity probe says the on-device model is out of its depth. When it does escalate, the frontier response is not just returned — it becomes a **teacher signal**: the cortex distills on it with WSLA, gated so it skips patterns it has already learned. The loop closes on-device, and the adapted weights persist to a checkpoint.

## What is proven, what is built, and what is still a hypothesis

This is the part most architecture posts skip, and the part that matters most for anyone evaluating the claims.

**Proven and implemented.** The three SSM kernel families, the autograd and optimizer, the reconciliation operator with its single-incumbent invariant and `O(1)` invalidation, the hybrid recall, the limbic cell, the router, the distillation loop, and the export pipeline (safetensors / ONNX / GGUF / Hugging Face — ONNX verified to under `1e-5` logit parity against the reference forward pass) are all built and tested.

**Still a hypothesis.** The comparative claims — that Evermind beats a frozen frontier model on *currency*, that it sustains interactive generation at a fraction of the memory footprint, that WSLA distillation improves without catastrophic forgetting — are stated in the report as **falsifiable hypotheses with a measurement protocol**, not as benchmark results. We have not run them at scale, and we are not going to pretend we have. The honest contribution today is the formalization and the open implementation; the numbers are the next milestone.

We think that is the right way to ship a research claim: make it precise, make it open, and make it easy to falsify.

---

*Evermind is built on the open `builderforce-memory` package family (engine / runtime / MCP). The full technical report — with every equation cited to its source file, the proofs in full, and the evaluation protocol — is available on request.*

[Explore Evermind →](/evermind) · [Read the short version →](/blog/evermind-self-updating-model) · [Start building for free →](/register)
