---
title: Local-First AI in the Browser, Done Properly
date: 2026-07-24
description: SitePoint's WebGPU guide lays out the blueprint for running LLMs entirely on-device. Here's how Builderforce implements every best practice — Chrome's Prompt API, real token streaming, Web Worker isolation, GPU-loss recovery, and a progressive-enhancement cascade — and goes beyond it with on-device WebGPU training.
tags: [webgpu, local-first, privacy, deep-dive, evermind]
author: Sean Hogg
---

# Local-First AI in the Browser, Done Properly

SitePoint recently published an excellent blueprint for running large language models entirely inside the browser: [*Local-First AI With WebGPU: A Practical Guide for Chrome*](https://www.sitepoint.com/local-first-ai-webgpu-chrome-guide/). It's the clearest write-up we've seen of *why* on-device inference is finally viable, and *what* a production-grade implementation has to get right.

We read it the way you read a checklist for something you've already shipped. Builderforce has run WebGPU inference — and training — in the browser tab for over a year. So this post does two things: it walks through the article's recommended architecture, and then shows exactly how our platform implements every item on that list, plus the parts the guide doesn't cover.

## The blueprint, in one paragraph

The guide argues that three developments made local-first AI real: **4-bit quantized small models**, **WebGPU shipping stable in Chrome 113**, and Chrome's **built-in Gemini Nano** exposed through the Prompt API. Its recommended architecture splits the work by hardware strength — WebGPU compute shaders (WGSL) for the matmul-heavy forward pass, WebAssembly for tokenization and sampling — behind a **progressive-enhancement cascade**: Prompt API (Tier 1) → a WebGPU framework like Web-LLM (Tier 2) → cloud fallback (Tier 3), all behind one uniform interface. Then it lists the operational must-haves: run inference in a **Web Worker**, pre-warm to cut time-to-first-token, **cache weights** locally, recover from **`GPUDevice.lost`**, and feature-detect everything.

It's a great list. Here's how we do each part.

## 1. The compute layer: we ship our own WGSL kernels

The guide recommends leaning on a framework (Web-LLM, Transformers.js) to map transformer math onto GPU workgroups. We went a layer deeper. Builderforce's engine ships **hand-written WGSL kernels** for a Mamba **state-space model** — the selective-scan (S6) core implemented as a Kogge-Stone parallel prefix scan that runs in O(log N) on the GPU, with numerically-stable softplus and zero-order-hold discretisation.

Crucially, our kernels implement the **backward pass**, not just the forward pass. That means we don't only *run* a model on-device — we **train** one on-device, with real AdamW gradient steps on your own code, all inside the tab. The SitePoint guide stops at inference; this is the capability that makes ["memory-first" learning](/blog/evermind-self-updating-model) and [in-browser LoRA fine-tuning](/blog/webgpu-lora-explained) possible.

## 2. Device selection: WebNN → WebGPU → CPU

The article treats WebGPU as *the* compute path. We treat it as the middle of three. Our device router probes, in priority order:

1. **WebNN** — the neural-network API that can target a dedicated **NPU** (Snapdragon X, Apple Neural Engine, Intel AI Boost) before touching the GPU.
2. **WebGPU** — the high-performance GPU path the guide focuses on.
3. **CPU (WASM SIMD)** — the honest fallback.

One probe, one decision, shared by every consumer — no component recomputes "can this browser run it?" for itself. And we deliberately **don't fabricate a VRAM number**: WebGPU doesn't expose real memory, so we report `null` rather than mistake a 2 GB spec limit for a 2 GB card and wrongly lock out a 16 GB GPU.

## 3. Tier 1: Chrome's built-in Gemini Nano

This is the guide's headline feature, and it's a first-class engine in Builderforce. The Prompt API engine wraps Chrome's `LanguageModel` API — **zero download** for the app (the model ships with the browser), no VRAM budget to manage, and **real token streaming** out of the box. It sits beside two engines that run downloaded models on WebGPU — our own 1-bit **Bonsai** engine and **WebLLM** — behind one `PageEngine` contract:

```ts
import { createPageEngineSet } from '@seanhogg/builderforce-brain-embedded';

// Bonsai, WebLLM and the Prompt API — one set per page, one fetch shim, one model store.
const engines = createPageEngineSet({ loadBfi });
```

The engine feature-detects the API, handles the `downloadable`/`downloading`/`available` states the browser reports, and every engine reports its real context window, so a conversation is packed to fit *before* it reaches a smaller on-device model.

## 4. The progressive-enhancement cascade

The guide's most important idea is architectural: **one interface, many backends, graceful fallback**. In Builderforce that's one routing step, `createHostModelStream` — the same function the web app, the VS Code extension and the Chrome side panel all run:

```ts
import { createHostModelStream } from '@seanhogg/builderforce-brain-embedded';

const stream = createHostModelStream({
  probes: () => engines.probe(),  // what this page can run right now
  fetch: engines.fetch(),         // the engines' one transport
  cloud: () => gatewayStream,     // the terminal tier
});
```

Per call it orders:

1. **A model you pinned** from the "On this device" picker — it runs here, full stop
2. **Local first** — when a ready engine can serve the request, it answers on-device
3. **Cloud LLM** — always available, and the **invisible failover** if a local attempt fails

The "which backend?" decision lives in exactly one place. Your UI just streams and never branches on availability itself.

## 5. Web Worker isolation

The guide is right that heavy work must never block the main thread — sampling over a 150k-entry logit vector *per token* will jank the UI. WebLLM runs in a Web Worker when the host supplies one, and our on-device **Mamba** engine — the one you train — runs fully inside a worker. Because a `GPUDevice` can't be transferred across the worker boundary, the worker hosts the whole engine and the main thread talks to it over a small RPC protocol:

```ts
import { initMambaProvider } from '@/lib/mamba-worker-client';

// Off the main thread when the runtime allows it; in-page otherwise.
const mamba = await initMambaProvider({ dModel: 512, numLayers: 8 });
await mamba.train(code, { epochs: 3, onEpochEnd: (epoch, loss) => plot(epoch, loss) });
```

Token and per-epoch progress events stream back as messages; the trained checkpoint is **transferred** (not copied) home. And if the runtime can't spawn a worker, it falls back to the in-page engine — nothing breaks.

## 6. `GPUDevice.lost` recovery

A backgrounded tab, a driver reset, or a laptop switching GPUs silently invalidates every buffer and pipeline you hold. The guide flags this; most in-browser demos ignore it. Builderforce subscribes to the device-lost promise at the single point of device acquisition. A genuine loss tears down the model and flips the provider back to *not ready*, so the next call cleanly re-initialises — while a deliberate `destroy()` is filtered out so it never reads as a fault.

## 7. Weight caching, streaming downloads, and privacy

Model weights are cached in **IndexedDB** after first download, from a multi-source chain (our R2 proxy → Hugging Face CDN) with streaming progress — so a multi-gigabyte checkpoint downloads once, not every page load. And the privacy property the guide describes as "an architectural fact" is exactly why we built this: with local inference, **your prompts and your code never leave the machine**. It's not a policy promise; the network request simply doesn't happen.

## Scorecard: the guide's checklist vs. Builderforce

| Best practice from the guide | Builderforce |
| --- | --- |
| WebGPU compute shaders | ✅ Hand-written WGSL Mamba SSM kernels |
| WASM tokenization/sampling | ✅ BPE tokenizer, trained on your own corpus |
| Chrome Prompt API (Tier 1) | ✅ Prompt API page engine, real streaming |
| Web-LLM / WebGPU (Tier 2) | ✅ WebLLM and our 1-bit Bonsai engine, on WebGPU |
| Cloud fallback (Tier 3) | ✅ Terminal tier in the cascade |
| Uniform interface + fallback | ✅ `createHostModelStream`, one step on every surface |
| Web Worker isolation | ✅ WebLLM and the Mamba engine hosted in workers |
| `GPUDevice.lost` recovery | ✅ Single-source device-loss handling |
| Local weight caching | ✅ IndexedDB, streaming, multi-source |
| Feature-detect everything | ✅ WebNN → WebGPU → CPU probe |
| **On-device *training*** | ✅ **Beyond the guide** — real backward pass + AdamW |
| **NPU via WebNN** | ✅ **Beyond the guide** |
| **On-device answer memory** | ✅ **Beyond the guide** — on-device SSM embeddings |

## How to use it

Every piece above is available today:

- **Chat / assistant surfaces** get the local-first cascade for free — Gemini Nano or a model you downloaded from the "On this device" picker when the browser can run it, the cloud otherwise, with the same routing on the web, in VS Code and in the Chrome side panel.
- **Privacy-sensitive work** pins an on-device model, so the request never leaves the machine.
- **Fine-tuning** happens in the [AI Training panel](/training): point it at your code, and real WebGPU gradient descent produces a checkpoint that never touches a server.

The SitePoint guide is the right map. Builderforce is a platform that has already walked the whole territory — and kept going, into on-device training that the browser was, until recently, never supposed to be able to do.

*Want the deep technical version? Read [Inside the Evermind Architecture](/blog/inside-evermind-architecture) and [WebGPU LoRA Fine-Tuning Explained](/blog/webgpu-lora-explained).*
