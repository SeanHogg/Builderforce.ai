---
title: No account, no GPU, no network — and you choose where every word goes
date: 2026-10-21
description: Studio and Rovr now open with a working model and no account, no sign-up call and no GPU required. Every surface — the web, the VS Code extension and the Rovr side panel — asks one question about where your words run: Local only, Hybrid or one Specific model. And Hybrid learns, on your device, which turns to keep local.
tags: [local-models, on-device, privacy, inference-modes, rovr, vscode, product]
author: Sean Hogg
---

# No account, no GPU, no network — and you choose where every word goes

Starting something used to come with three conditions nobody wrote down.

You needed an **account**, because the first thing the page did was call a server, and the server wanted to know who was asking. You needed a **GPU**, because running a model on your own machine meant WebGPU, and a laptop without a capable one was told, politely, to use the cloud instead. And you needed a **network**, because whichever way you came in, the words you typed went somewhere.

None of those is a reason to stop someone thinking. An idea at eleven at night, on a work laptop with integrated graphics, on a train, is still an idea. This release removes all three conditions, and adds the thing that should have come with them from the start: one plain choice about where your words are allowed to go.

```bf-figure
{
  "kind": "compare",
  "title": "What it took to ask the first question",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["Create an account", "Wait for the workspace to call home", "Have a GPU with WebGPU — or use the cloud", "Be online", "Trust the default about where your words go"] },
    { "title": "Now", "hue": "idea", "items": ["Open Studio or Rovr", "A model on this device answers", "On the GPU if you have one, on the CPU if you don't", "Offline once it's downloaded", "Pick Local only, Hybrid or Specific — and see when it switches"] }
  ],
  "caption": "Signing in is still worth it — Hybrid by default, sync, connected accounts and recall — but it is now something you choose, not a gate in front of the first word."
}
```

## One question, asked on every surface

Open the `/` menu in the composer, choose **Model**, and the first thing you see is **Run models**. It has three answers, and they mean the same thing on builderforce.ai, in the VS Code extension and in the Rovr side panel in Chrome.

```bf-figure
{
  "kind": "screen",
  "frame": "/ menu · Model · Run models",
  "ratio": 1.7,
  "regions": [
    { "label": "Local only", "note": "Only models on this device. Nothing is sent to the cloud — not a prompt, not a live connection", "x": 3, "y": 8, "w": 94, "h": 22, "hue": "good" },
    { "label": "Hybrid · Recommended", "note": "This device first, then the cloud when it needs to — and a notice when it does", "x": 3, "y": 36, "w": 94, "h": 22, "hue": "idea" },
    { "label": "Specific model", "note": "The model you pick always runs: a cloud model, one of your connected accounts, or one local model", "x": 3, "y": 64, "w": 94, "h": 22, "hue": "make" },
    { "label": "Change it any time", "x": 3, "y": 90, "w": 40, "h": 7, "hue": "accent" }
  ],
  "caption": "Three answers, not a page of settings. The same three on the web, in your editor and in the browser side panel, so a choice you make once means the same thing wherever you work."
}
```

**Local only** is a promise, not a preference. In that mode content requests are blocked before they leave, and so are live connections — the channels that would otherwise sync a canvas or stream a run to a server. If no model on this device can answer, you are told so and offered two ways forward: download one, or switch to Hybrid. Nothing quietly goes to the cloud on your behalf.

**Hybrid** is the default once you sign in. A model on your device takes the turn first; when it can't, the free cloud tier takes it next; and when that switch happens you see a notice, so you always know which side of the line a given answer came from.

**Specific model** is strict. You pick one model and that model runs — no substitution, no fallback dressed up as the thing you asked for. It is the mode for a comparison, a benchmark, or a task where you simply know which model you want.

```bf-figure
{
  "kind": "compare",
  "title": "Where your words can go, by mode",
  "columns": [
    { "title": "Local only", "hue": "good", "items": ["This device", "Blocked: content requests", "Blocked: live connections", "Works offline"] },
    { "title": "Hybrid", "hue": "idea", "items": ["This device first", "Then the free cloud tier", "A notice when it switches", "Learns which turns to keep local"] },
    { "title": "Specific", "hue": "make", "items": ["Exactly the model you picked", "Cloud, your own account or one local model", "No silent fallback"] }
  ],
  "caption": "The mode is the boundary. Everything else — which local model, which cloud model — happens inside it."
}
```

## No account, no API call

Studio and Rovr now start **anonymously**. There is no sign-up and no call to our servers to begin: the page loads, a local model loads in your browser, and you are working. Everything you do in that state stays on your device, because there is nowhere else for it to go.

Signing in adds the things that genuinely need an account — Hybrid by default, sync across devices, connected provider accounts and recall of what you've done before. If you want the cloud without an account, choosing **Hybrid** as a guest opts you into a small guest allowance; that's the only point at which a guest's words leave the device, and it's one you chose.

This builds on [creating before you sign up](/blog/create-before-you-sign-up) on the canvas. The difference is that the model answering you no longer has to live somewhere else.

## No GPU required

The [last release](/blog/models-that-run-on-your-machine) brought models you download once and run in your browser's GPU — and was honest that it needed WebGPU. That limit is gone. The 1-bit **Bonsai** models now run on the **CPU** too, spread across several threads where the browser allows it, inside a background worker so the page stays responsive while the model thinks.

```bf-figure
{
  "kind": "flow",
  "title": "Where a local model runs, by surface",
  "steps": [
    { "label": "builderforce.ai", "note": "Studio and the canvas: the GPU when WebGPU is available, otherwise the CPU, always in a background worker.", "hue": "idea" },
    { "label": "Rovr", "note": "The Chrome side panel runs the same models the same way — GPU first, CPU when there isn't one.", "hue": "run" },
    { "label": "VS Code", "note": "The extension uses the editor panel's GPU when it has one, and runs on the CPU in the extension itself when it doesn't.", "hue": "make", "tag": "both paths" }
  ],
  "caption": "The same model and the same picker on all three. A laptop with integrated graphics, a locked-down work machine and a virtual desktop can all run a model now."
}
```

A CPU is slower than a good GPU; nobody should pretend otherwise. But a model that answers in a few seconds on the machine you have beats a model that refuses to load on the machine you don't. For a rewrite, a summary, a question about a page or a first pass at a plan, it is plenty — and it is private by construction.

For how the in-browser engines themselves are built, see [Local-first AI in the browser, done properly](/blog/local-first-ai-webgpu-in-the-browser).

## Hybrid that learns which turns to keep

A naive "local first" has an obvious cost: every turn the local model can't handle is a turn you wait for it to fail before the cloud gets a chance. Do that often enough and Hybrid feels slower than just using the cloud.

So Hybrid learns. A small predictor on your device watches how your own turns turn out — which ones the local model handled, which ones it handed on — and, over time, sends the turns it already expects the local model to miss **straight to the cloud**, without the detour.

```bf-figure
{
  "kind": "flow",
  "title": "One Hybrid turn",
  "steps": [
    { "label": "Predict", "note": "Learned from your own outcomes, on your device: will the local model handle this one?", "hue": "prove" },
    { "label": "Local", "note": "If yes, this device answers. Nothing leaves.", "hue": "good" },
    { "label": "Free cloud", "note": "If no — or if the local attempt doesn't make it — the free tier takes the turn.", "hue": "run" },
    { "label": "Notice", "note": "You see that it switched, every time.", "hue": "accent", "tag": "never silent" }
  ],
  "caption": "The predictor learns from what happened to your turns, and it stays on your device. The longer you use Hybrid, the fewer turns wait on a local attempt that was never going to work."
}
```

Two smaller changes sit behind this. When a turn does go to the cloud, **free models come first whenever they are equivalent to a paid one** — an account preference, inferred from whether you've connected your own provider keys, that you can change. And **Insights** now flags **run anomalies**: runs that cost far more, took far longer, or failed far more tools than the runs before them, so an outlier is something you see rather than something you find on an invoice.

## Where it sits in the method

Work on Builderforce follows one arc, **Idea → Make → Run → Measure → Reach**, and the loop that crosses from Idea into Make is [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Read and Prove are the two acts that are meant to spend nothing, so that the decision to build is a real decision.

This release is what makes that literally true, and it lives at the very start of the arc: **Idea**.

```bf-figure
{
  "kind": "flow",
  "title": "The first two acts, with nothing standing in front of them",
  "steps": [
    { "label": "Read", "note": "Think the idea through on a model on your own machine — no account, no GPU, no network, nothing logged anywhere.", "hue": "read", "tag": "Idea" },
    { "label": "Prove", "note": "Run the cheap checks locally; Hybrid sends only the turns that need it to the cloud, free models first.", "hue": "prove", "tag": "Idea" },
    { "label": "Build", "note": "Sign in when the work earns it — sync, connected accounts and a durable project are waiting.", "hue": "build", "tag": "Make" }
  ],
  "caption": "Read and Prove were always supposed to be free. Now they are free of cost, of sign-up and of hardware — and Local only makes them private by rule, not by hope."
}
```

The most expensive moment in any project is not the build. It is the idea that never got a first question because the first question cost a sign-up, a GPU or a connection someone didn't have. Moving those costs out of Idea is how more ideas reach Prove — and how the ones that shouldn't be built get found out before anyone builds them. Run anomalies in Insights close the other end: the runs that do happen are measured, and the outliers come back to you.

## What you can do with it today

- **Start without an account.** Open Studio or Rovr and ask your first question; a model on your device answers.
- **Keep it on your machine, by rule.** Choose **Local only** and nothing is sent — not your prompts, not a live connection.
- **Run a model on any laptop.** No GPU, no problem: Bonsai runs on the CPU on the web, in Rovr and in VS Code.
- **Let Hybrid do the routing.** Local first, the free cloud tier next, a notice when it switches — and fewer wasted local attempts the longer you use it.
- **Pin one model when it matters.** **Specific model** runs exactly what you picked, with no silent substitution.
- **Spot the expensive runs.** Insights flags runs far outside the normal range for cost, time and tool failures.

Open the `/` menu, choose **Model**, and pick how you want it to run.

---

**Related reading:** [Run a model on your own machine](/blog/models-that-run-on-your-machine) · [Local-first AI in the browser, done properly](/blog/local-first-ai-webgpu-in-the-browser) · [Meet Rovr](/blog/rovr-your-assistant-in-the-browser) · [Create before you sign up](/blog/create-before-you-sign-up) · [Read, Prove, Build](/blog/read-prove-build-the-inner-loop)

[Open Studio](/studio) and ask it something — no account needed.
