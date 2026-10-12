---
title: Synapse now runs models itself
date: 2026-10-12
description: "Synapse no longer needs a separately installed Ollama. It supervises bfi, our native engine, so 2-bit PQ2_0 and PTQ1_0 GGUF load on your machine, and VS Code finds those models in ~/.builderforce/desktop.json. The CPU sidecar ships; we have not claimed GPU 70% of llama-bench."
tags: [llm, local-first, vscode, on-device]
author: Sean Hogg
---

# Synapse now runs models itself

Synapse now runs models itself. Ollama is not required.

Until this cut-over, local models in Synapse meant installing someone else's runtime, hoping it was on PATH, and living with whatever GGUF types that runtime happened to accept. That was a product we did not control, on the critical path of a product we do.

```bf-figure
{
  "kind": "flow",
  "title": "From install to a model in the editor",
  "steps": [
    { "label": "Synapse", "note": "The desktop app starts and supervises bfi serve. No Ollama install.", "hue": "idea" },
    { "label": "bfi", "note": "The native engine loads GGUF — including PrismML PQ2_0 and PTQ1_0.", "hue": "make" },
    { "label": "desktop.json", "note": "Synapse writes ~/.builderforce/desktop.json with the models endpoint.", "hue": "run" },
    { "label": "VS Code", "note": "The BuilderForce extension discovers provider id synapse and lists those models.", "hue": "run" }
  ],
  "caption": "One runtime on the machine. The editor finds it. Ollama is not in the path."
}
```

## Why we replaced Ollama

Three costs, all paid by the person trying to run a model on their own machine.

**An install step outside our control.** If Ollama was missing, the Models view pointed at someone else's download page. Synapse could not start local inference until that other product was present and healthy.

**The formats we most want did not run on it.** PrismML's Ternary Bonsai 2 27B ships as `PQ2_0` / `PTQ1_0` GGUF — 2-bit and ~1.75-bit ternary blocks. Stock llama.cpp, which Ollama embeds, rejects both types. Only a fork ran them. A local-models product that cannot load the weights we care about is not a local-models product.

**Sizing was a guess.** Memory estimates came from a fixed bits-per-weight table. It knew nothing about ternary formats, hybrid-attention KV cost, or the runtime's real overhead. `bfi fit` estimates from the GGUF we actually load.

## The 2-bit story

`bfi` is a pure-Rust engine in [builderforce-inference](https://github.com/SeanHogg/builderforce-inference). It reads GGUF v2/v3, including PrismML's `PQ2_0` (type 142) and `PTQ1_0` (type 143). Those are the 2-bit / ternary layouts Bonsai 2 27B actually ships — not Q2_0 or TQ1_0, which cannot represent a group-128 checkpoint losslessly.

Synapse supervises `bfi serve` as a child: health checks, backoff, restart. If the engine dies, Synapse keeps running. The CPU sidecar ships with the app. You can also install the CLI yourself:

```sh
cargo install --git https://github.com/SeanHogg/builderforce-inference bfi
```

Signed GitHub Release binaries are not published yet. That waits on owner signing secrets, not on this cut-over.

## VS Code finds it on the machine

The BuilderForce VS Code extension does not guess a port. It reads `~/.builderforce/desktop.json` (Windows: `%USERPROFILE%\.builderforce\desktop.json`; override `BUILDERFORCE_DESKTOP_DISCOVERY`):

```json
{
  "models": {
    "endpoint": "http://127.0.0.1:…",
    "provider": "synapse"
  }
}
```

The local provider id is `synapse`, never `bfi`. Catalog and install go through Synapse (`GET /v1/synapse/catalog`, `POST /api/pull`). If Synapse is not running, the group does not render. An existing Ollama provider still works against any Ollama-compatible server, including a standalone `bfi serve`.

## What we are not claiming

The CPU sidecar ships. That is the cut-over.

We have **not** claimed GPU 70% of llama-bench tok/s on Metal or NVIDIA. CubeCL kernels compile; the go/no-go measurement has not been run.

We have **not** claimed live greedy identity of Bonsai 27B against the PrismML llama.cpp fork. Fit tests at 32K / 36 GiB pass on CPU; the live compare needs weights we do not run in CI.

Those stay on the ROADMAP. This post is the cut-over, not the finish line.
