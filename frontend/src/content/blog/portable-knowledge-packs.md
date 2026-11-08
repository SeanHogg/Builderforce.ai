---
title: Pack the knowledge your review proved — and let any agent use it
date: 2026-11-08
description: Your team's codebase review turns a folder into facts. Now those facts pack up as a portable .bfpack you can share, version, and hand to any LLM — so the understanding your review earned travels with the work.
tags: [knowledge, agents, vscode, product]
author: Sean Hogg
---

# Pack the knowledge your review proved — and let any agent use it

A knowledge review earns something hard-won: a graph of what a codebase actually means — its systems, facts, relations and the judgement calls behind them. Until now that understanding lived in one place and answered for one tool. Re-reviewing the same folder in a second host meant paying the whole cost again, and two hosts could disagree.

That is the gap this closed: **the understanding your review proved was trapped in the host that ran it.** Now it packs up and travels.

## A portable pack, not a pile of files

The unit is the portable knowledge pack — a `.bfpack` on disk. It carries the reviewed facts, the findings and the judgement, model-agnostic by design: no embeddings are baked in, so any consumer re-derives vectors from the card text by hash. What makes a pack trustworthy rides along as provenance — who reviewed it, with which judge model, under which policy, and when.

```bf-figure
{
  "kind": "flow",
  "title": "Review in, pack out",
  "steps": [
    { "label": "Review a folder", "note": "The review builds a graph of systems, facts and relations, with judgement recorded.", "hue": "make" },
    { "label": "Create the pack", "note": "One command turns the reviewed graph into a portable .bfpack, provenance included.", "hue": "run" },
    { "label": "Any agent retrieves", "note": "The single PackRegistry → retrieval seam serves chat, Synapse, web and the Canvas Evermind turn.", "hue": "measure" }
  ],
  "caption": "One review, one pack, every consumer — no second retrieval path."
}
```

## One seam, every consumer

There is exactly one way to retrieve from a pack: the `PackRegistry` → `PackRetrievalPort` seam. VS Code chat, the context pack, Synapse, web `knowledge.ask`, and the Canvas Evermind turn all go through it. A new consumer adds a registry implementation — never a second merge or a second retrieval path — so "which knowledge did the model see" always has one answer.

Upload a pack to a project and it becomes a knowledge root there: its facts join the project's and seed its Evermind, and removing it removes only what it brought.

## Why it matters

- **Pay once, use everywhere.** The expensive part is the review. Packing means you pay it once and the understanding serves every host and every model.
- **Trust is carried, not asserted.** Provenance is recorded at pack time and shown at pick time — "Reviewed by … with …" — so a pack's credibility is a fact, not a claim.
- **One answer to what the model knew.** A single retrieval seam means the context behind an answer is reproducible.

## Where it sits in the method

This is **Make** compounding into **Measure**: the review is the investment, the pack is the return, and retrieval is how the rest of the platform spends it.

## What you can do with it today

Review a folder, create a pack, and watch the same reviewed knowledge answer in chat, Synapse and the Canvas. Upload a pack to a project and see its facts join the project's Evermind.
