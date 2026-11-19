---
title: Train a LoRA adapter in Python, in the browser tab you built it in
date: 2026-11-18
description: A Python training script in your project now runs inside your browser tab, with import torch and import peft on your GPU through WebGPU. It saves its adapter when it finishes or checkpoints when you stop it; load that adapter in the training panel and publish it as a model you can call. Built for small models and LoRA adapters.
tags: [ai-training, runtime, browser, idea-to-real, product]
author: Sean Hogg
---

# Train a LoRA adapter in Python, in the browser tab you built it in

You have a hunch that a small model would do better on your data. Finding out used to start with a detour: rent a GPU box, install PyTorch, copy the data over, run the script, copy the weights back, then work out how to load them somewhere you could actually try them.

By the time the answer arrived, the question had gone cold.

That detour is now optional. **A Python training script in your project runs in the browser tab you built it in, and the adapter it saves becomes a model you can publish and call.**

## What happens when you press Run

Declare the script as a `training` service in your project's `builderforce.json` — `python train.py`, no port. Press Run and the script starts in the tab alongside the rest of your app.

Inside it, `import torch` and `import peft` work. They run on your GPU through WebGPU, using the same engine as the in-browser trainer. The script logs its loss with `bfwc.training.log(step, loss)`. When it finishes, it saves its adapter with peft's `save_pretrained` into `bfwc.training.artifact_dir()`. If you stop it first, the runtime asks it to checkpoint: a script that checks `bfwc.training.checkpoint_requested()` saves and exits cleanly.

```bf-figure
{
  "kind": "flow",
  "title": "From a training script to a model you can call",
  "steps": [
    { "label": "Train", "note": "Your train.py runs in the tab: import torch and peft, on your GPU through WebGPU.", "hue": "make", "tag": "in the tab" },
    { "label": "Save", "note": "The script saves its LoRA adapter, at the end or when you stop it. The save stays in your browser.", "hue": "run", "tag": "in the tab" },
    { "label": "Publish", "note": "The training panel loads the save as a runnable model package you can publish, call and benchmark.", "hue": "measure" }
  ],
  "caption": "One script, one saved adapter, one model you can call. The training data and weights never leave your tab until you publish."
}
```

Open the training panel, choose the service under **Adapter from a Python training service**, and load its saved adapter. From there it is the same artifact an in-panel training run produces. Publish it, test a prompt against it and benchmark it on held-out text, exactly as you would an adapter trained in the panel.

## What it is built for, and what it is not

This is a tool for small, fast experiments, and the limits are real:

- **WebGPU is required for GPU speed.** Without it the same script runs on the CPU, which is far slower.
- **Small models only.** The browser holds the base model and the adapter in your tab's memory.
- **LoRA adapters only.** The adapter targets the token embedding of the browser's Evermind models, the module browser models load adapters on. In your script that means a `nn.Linear` named `embed_tokens` that holds an Evermind base's token embedding; a ready-made Python Evermind model is not included yet. Full fine-tunes and other target modules are out of scope.
- **The base comes with the adapter.** A save can carry its own base (`base_model.safetensors` and `tokenizer.json`); otherwise you choose the base checkpoint and tokenizer it was trained on in the panel.

Large models still belong on cloud training. This is for the step before that: finding out whether the data moves the needle at all.

```bf-figure
{
  "kind": "compare",
  "title": "Two ways to test a fine-tuning idea",
  "columns": [
    { "title": "Rent a GPU box", "hue": "muted", "items": ["Provision a machine and install PyTorch", "Copy the data up and the weights back", "Work out how to load the result", "Pay for every hour it sits there", "Right for large models"] },
    { "title": "Train in the tab", "hue": "run", "items": ["Press Run on your training script", "The data stays in your browser", "The save loads straight into the panel", "No cloud compute to train", "Right for small models and LoRA"] }
  ],
  "caption": "The GPU box is still the right tool for big runs. It stopped being the price of a first answer."
}
```

## Where it sits in the method

Idea to Real is an arc — **Idea → Make → Run → Measure** — with a loop inside it: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). A fine-tuning idea is a proof like any other. The cheapest way to prove it is a small adapter on a small model, run where you already are, graded on text the model has never seen.

Training in the tab puts that proof inside the Run stage. The benchmark in the panel is the Measure stage: perplexity and accuracy on held-out text, so you decide with a number rather than a feeling.

## What you can do with it today

- **Run a Python training script in the tab** with `import torch` and `import peft`, on your GPU through WebGPU.
- **Stop it without losing the work.** A script that checks for a checkpoint request saves before it exits.
- **Turn the save into a model** you can publish, call and benchmark, from the training panel.
- **Keep the data local.** The training data and the saved adapter stay in your browser until you choose to publish.
- **Graduate to cloud training** when the idea has earned a bigger model.

---

**Related reading:** [Your full-stack app now runs in the browser tab you built it in](/blog/your-full-stack-app-now-runs-in-your-browser-tab) · [Local-First AI in the Browser, Done Properly](/blog/local-first-ai-webgpu-in-the-browser) · [Read, Prove, Build: the inner loop](/blog/read-prove-build-the-inner-loop)

[Open a project](/create), add a training service to its `builderforce.json`, and press Run.
