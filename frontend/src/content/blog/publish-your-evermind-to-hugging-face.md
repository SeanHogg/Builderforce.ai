---
title: Put the model you trained on Hugging Face, from the page you trained it on
date: 2026-09-28
description: A trained Evermind used to leave Builderforce as a zip on your laptop, and getting it onto the Hugging Face Hub was a separate job with separate tools. Now you pick a repository, paste your own token, and the full model repo lands on the Hub from the export panel.
tags: [evermind, hugging-face, model-publishing, llm-studio, product]
author: Sean Hogg
---

# Put the model you trained on Hugging Face, from the page you trained it on

You taught an Evermind your codebase, your support tone, your house style. It passed its readiness check. It answers in the workspace. And then someone outside the workspace asks to try it.

Until today the honest answer was a zip file. The export panel would build the whole Hugging Face repository — weights in safetensors, an ONNX graph, a GGUF container, the config, the tokenizer and a model card — and hand it to you as a download. Getting it onto the Hub was your job: unpack it, install the command-line tools, log in, create the repository, upload the large files the right way, and hope the model card survived the trip. That is a small software project standing between a finished model and the people who could use it.

## Publish, not download

Pick **Hugging Face repo** in the export panel and a second section opens under it: **Publish to Hugging Face**. Name the repository as `owner/name`, paste a Hugging Face token with write access, choose whether the repository starts private, and publish.

```bf-figure
{
  "kind": "flow",
  "title": "What happens when you press Publish",
  "steps": [
    { "label": "Export", "note": "The server builds the same repo bundle the download gives you: safetensors, ONNX, GGUF, config, tokenizer and model card.", "hue": "make" },
    { "label": "Unpack", "note": "Your browser opens the bundle into the files a Hub repository is made of.", "hue": "run" },
    { "label": "Push", "note": "The repository is created if it does not exist, and every file is uploaded with the large weights handled the way the Hub expects.", "hue": "reach", "tag": "your token, your repo" }
  ],
  "caption": "The export itself is unchanged. What is new is the last hop: it no longer needs a terminal, a login or a second set of tools."
}
```

The link to the new repository appears the moment the upload finishes. Anyone you share it with can load the model with the tools they already use.

```bf-figure
{
  "kind": "screen",
  "frame": "The export panel with Hugging Face picked",
  "ratio": 1.4,
  "regions": [
    { "label": "Published model", "note": "Any Evermind the workspace has published", "x": 5, "y": 6, "w": 90, "h": 12, "hue": "make" },
    { "label": "Format: Hugging Face repo", "x": 5, "y": 21, "w": 90, "h": 12, "hue": "make" },
    { "label": "Export & download", "note": "Still there, for an offline copy", "x": 5, "y": 36, "w": 40, "h": 9, "hue": "muted" },
    { "label": "Publish to Hugging Face", "note": "Repository · your token · private or public", "x": 5, "y": 49, "w": 90, "h": 45, "hue": "reach" }
  ],
  "caption": "Publishing sits under the download rather than replacing it. The same bundle serves both, so what you publish is exactly what you would have downloaded."
}
```

## Your token stays yours

The token goes from the page straight to Hugging Face. Builderforce never receives it, never stores it and never needs to. The repository belongs to your Hugging Face account, not to ours, and you can revoke the token the moment you are done. That is also why this needs no setup on our side: there is no integration to connect and no key to hand over.

## Where it sits in the method

The arc runs Idea → Make → Run → Measure, and then **Reach**: getting what you made in front of the people it is for. A model that only answers inside the workspace that trained it has been measured by the people who built it, not by anyone who might want it. Reach is the stage where that changes, and until now it started with a manual packaging job.

```bf-figure
{
  "kind": "compare",
  "title": "From a finished model to one other people can load",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["Export and download a zip", "Unpack it", "Install the Hub command-line tools", "Log in", "Create the repository", "Upload the weights as large files", "Check that the model card made it"] },
    { "title": "Now", "hue": "reach", "items": ["Pick Hugging Face repo", "Name the repository", "Paste your token", "Publish"] }
  ],
  "caption": "The steps that disappeared were not decisions. They were packaging, and packaging is where a finished model sits unshared."
}
```

## What you can do with it today

- **Share a trained Evermind publicly** under your own Hugging Face account, with its model card, in one step.
- **Start private** and open the repository to the world when you are ready.
- **Publish a new version** into the same repository after you teach the model more. Publishing again adds a new commit to the repository.
- **Keep the offline copy**: the download is still one click away, built from the same bundle.

---

**Related reading:** [Build and train an Evermind on the Creation Canvas](/blog/build-and-train-evermind-on-the-creation-canvas) · [Evermind, the self-updating model](/blog/evermind-self-updating-model) · [Inside Evermind's architecture](/blog/inside-evermind-architecture)

Open the LLM Studio, export a published model, and pick **Hugging Face repo**.
