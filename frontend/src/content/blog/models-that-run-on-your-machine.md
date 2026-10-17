---
title: Run a model on your own machine, and hand off without losing the thread
date: 2026-10-17
description: Pick a model that runs on this device from the same picker you use today, download it once, and chat or run agent turns in your browser's GPU, privately and offline. When a run moves between models, builderforce-memory packs the conversation to fit the next model's window.
tags: [local-models, on-device, webgpu, memory, llm, product]
author: Sean Hogg
---

# Run a model on your own machine, and hand off without losing the thread

Every token you send to a cloud model leaves your machine, and every one of them is billed. For most work that is a fair trade. For a private note, a quick rewrite, a question about code you would rather not paste anywhere, or an afternoon on a train with no signal, it is not.

Running a small model locally has always been the obvious answer, and it has always broken in the same place. A small model has a small window. Start a task on a frontier model, switch to a local one halfway through, and the local model receives a transcript several times larger than it can hold. It truncates, forgets the instruction, or fails outright. Go the other way and the cloud model picks up with no idea what the local one just did.

This release closes both halves. You can now run a model on your own machine, from the picker you already use, and when a run moves between models, the next one gets a conversation packed for its own window.

## Pick a model that runs on this device

Open the `/` menu in the composer, go to **Model** and choose **On this device**. The list shows every model that can run in your browser's GPU through WebGPU. Press **Download** once; the model is saved by your browser, and from then on it loads from disk.

```bf-figure
{
  "kind": "screen",
  "frame": "/ menu · Model · On this device",
  "ratio": 1.6,
  "regions": [
    { "label": "On this device", "note": "The same picker as cloud models, filtered to what runs in your GPU", "x": 3, "y": 5, "w": 94, "h": 13, "hue": "idea" },
    { "label": "Bonsai 8B", "note": "1-bit · 1.16 GB · tool calling · Builderforce engine", "x": 3, "y": 22, "w": 62, "h": 15, "hue": "run" },
    { "label": "Ready", "note": "Downloaded once, loads from disk, works offline", "x": 68, "y": 22, "w": 29, "h": 15, "hue": "good" },
    { "label": "Bonsai 4B", "note": "1-bit · 0.57 GB · tool calling", "x": 3, "y": 41, "w": 62, "h": 15, "hue": "run" },
    { "label": "62%", "note": "Downloading, with progress you can watch", "x": 68, "y": 41, "w": 29, "h": 15, "hue": "prove" },
    { "label": "Bonsai 1.7B", "note": "1-bit · 0.25 GB · tool calling", "x": 3, "y": 60, "w": 62, "h": 15, "hue": "run" },
    { "label": "Download", "note": "One press; never started by a chat turn", "x": 68, "y": 60, "w": 29, "h": 15, "hue": "make" },
    { "label": "Hermes 3 8B", "note": "Does not fit this GPU, and the row says why", "x": 3, "y": 79, "w": 94, "h": 15, "style": "ghost" }
  ],
  "caption": "Download, progress, ready. A model that cannot run on your device stays in the list and tells you what it would need."
}
```

Two engines sit behind that list.

- **1-bit Bonsai 8B, 4B and 1.7B** from PrismML, Apache-2.0, at roughly 1.16 GB, 0.57 GB and 0.25 GB. They run on Builderforce's own engine, the same one [Synapse runs on the desktop](/blog/synapse-runs-models-itself), compiled for the browser. All three call tools, so they can do agent work, not just chat.
- **WebLLM models**: Qwen3 1.7B and 4B, Llama 3.2 3B, and Hermes 3 8B, which also calls tools.

The picker is the same everywhere you work with Builderforce: the VS Code extension, [Rovr](/blog/rovr-your-assistant-in-the-browser) in Chrome, and builderforce.ai. Before it offers a model, it checks your device. A model too large for your GPU's memory, or one that needs a GPU feature yours does not have, is not hidden; it says why it will not run.

When you pick one, your prompts for those turns never leave your machine. There is no request to a server to log, no tokens to bill, and once the model is downloaded, no network needed at all.

## Moving between models without losing the thread

Real work rarely stays on one model. You draft privately on a local model and hand the hard part to a cloud one. A plan is written by one model and coded by another. A provider fails mid-run and Builderforce fails over to the next. Each of those moves used to send the next model the whole conversation and hope it fit.

Now every move goes through **builderforce-memory**, which packs the conversation for the model about to take over.

```bf-figure
{
  "kind": "flow",
  "title": "A hand-off from your device to the cloud",
  "steps": [
    { "label": "Local model", "note": "Bonsai drafts privately in your browser, with a window of about 14,000 tokens.", "hue": "run", "tag": "on device" },
    { "label": "Memory packs", "note": "builderforce-memory keeps the system prompt, your latest instruction verbatim and the recent work, and turns the rest into one summary or recall.", "hue": "prove", "tag": "fits the next window" },
    { "label": "Hand-off note", "note": "The packed context opens with a line saying which model handed over to which.", "hue": "idea" },
    { "label": "Cloud model", "note": "Picks up the task knowing what happened, not just where the transcript ended.", "hue": "make", "tag": "in the cloud" }
  ],
  "caption": "The same packing runs in the other direction, so a small local model never receives a transcript it cannot hold."
}
```

The rules are simple. The system prompt stays. Your latest instruction stays word for word. A tool call is never separated from its result. The most recent turns stay verbatim for as long as the next model's window allows, and the older middle becomes one note: a summary when one can be made, otherwise what memory recalls for your instruction. The packed conversation always fits the window of the model receiving it, with room left for its answer.

The result is that a small model gets a conversation it can actually work with, and a large model picking up after a small one knows what was done.

```bf-figure
{
  "kind": "compare",
  "title": "On this device or in the cloud",
  "columns": [
    { "title": "On this device", "hue": "run", "items": ["Prompts never leave your machine", "No per-token cost", "Works offline once downloaded", "Bonsai and WebLLM models, up to about 8B", "Needs a WebGPU browser and GPU", "A smaller window and less depth than frontier models"] },
    { "title": "Builderforce cloud", "hue": "make", "items": ["Frontier models and long windows", "Nothing to download", "Runs on any browser and device", "Billed per token", "Takes over a run with a hand-off note", "The right choice for large, hard tasks"] }
  ],
  "caption": "Choose per turn. builderforce-memory makes switching between them cost you nothing in context."
}
```

## What to expect

A few honest limits, because a local model that disappoints you is worse than one you never tried.

- **It needs WebGPU.** Current Chrome and Edge on most desktops have it. A browser or GPU without it cannot run these models, and the picker says so instead of failing later.
- **The first download is large.** Bonsai 8B is about 1.16 GB. It downloads once and loads from disk after that; you can remove it from the same picker.
- **These are small models.** They are good at drafting, rewriting, short questions and focused tool calls. They are not frontier models, and on a long, tangled task a cloud model will do better.
- **The window is smaller than the cloud's.** Bonsai 8B in the browser holds about 14,000 tokens of context on a GPU with half-precision support, and about 7,000 without. That is exactly why the hand-off packing exists, and why it matters most in this direction.

## Where it sits in the method

Work on Builderforce follows one arc, **Idea → Make → Run → Measure → Reach**, and inside it the loop that decides what is worth building: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

- **Read** gets cheaper and more private. Thinking an idea through, rereading your own notes and asking the questions you would not paste into a cloud tool can all happen on your device, at no cost.
- **Prove** keeps the cheap part cheap. Read and Prove are the acts that should spend nothing; a local model lets the small checks run without spending a token, so the budget is saved for the proof that needs a frontier model.
- **Build** is where hand-offs pay off. A plan drafted locally reaches the coding model packed, with the instruction intact and a note of what was decided.
- **Run** gets steadier. When a provider fails mid-run, the model that takes over receives a conversation that fits it, so a failover continues the work rather than restarting it.
- **Measure** gets the plainest saving there is: a turn answered on your device is a turn nobody billed.

## What you can do with it today

- **Draft privately.** Pick Bonsai or a WebLLM model under **On this device** and nothing you type in those turns leaves your machine.
- **Work offline.** Download a model before you travel; it runs with no connection at all.
- **Start small, finish big.** Begin on a local model and switch to a cloud model when the task grows. The cloud model gets a packed conversation and a hand-off note.
- **Use the same model everywhere.** The picker is the same in VS Code, in Rovr and on builderforce.ai.
- **See why a model will not run.** A model that does not fit your device tells you what is missing, instead of failing halfway through a download.

Open the `/` menu, choose **Model**, then **On this device**, and download one.

---

**Related reading:** [Synapse now runs models itself](/blog/synapse-runs-models-itself) · [Local-first AI with WebGPU in the browser](/blog/local-first-ai-webgpu-in-the-browser) · [Meet Rovr](/blog/rovr-your-assistant-in-the-browser) · [Read, Prove, Build](/blog/read-prove-build-the-inner-loop)
