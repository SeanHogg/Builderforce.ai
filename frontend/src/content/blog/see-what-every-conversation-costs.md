---
title: See what every conversation costs, and what memory saved you
date: 2026-10-17
description: Every chat now shows what it cost, split between your Builderforce plan and your own provider keys at list price, and what memory kept off the bill: answers replayed from memory, the provider's prompt cache, and context kept lean. Recorded figures and estimates are always shown apart. The same panel now appears in the web app, the editor and Rovr.
tags: [cost, evermind, memory, agents, product]
author: Sean Hogg
---

# See what every conversation costs, and what memory saved you

"Builderforce remembers, so it spends less." We have said that for months. Until today you had to take our word for it.

The memory layer was doing its job. It answered repeated questions from memory and kept long conversations inside a lean context. The provider's prompt cache served most of a long prompt at a tenth of the price. None of that showed up anywhere you could look. A question answered from memory left a note on the timeline saying the model was skipped, and nothing about what skipping it was worth. A turn on your own Claude key was recorded as costing nothing, because Builderforce paid nothing for it. It still cost you.

So "how much does this cost, and is memory actually helping?" had no answer on the screen where you were working. Now it does.

## The number above every chat

The strip above each conversation now shows what that conversation has cost and what memory saved it, beside its ticket health.

```bf-figure
{
  "kind": "screen",
  "frame": "The strip above a conversation",
  "ratio": 3.2,
  "regions": [
    { "label": "Ticket health", "note": "104 tickets · 83%", "x": 2, "y": 12, "w": 46, "h": 76, "hue": "make" },
    { "label": "$0.42 · 1.2M tok · ≈$0.31 saved", "note": "Click for the breakdown", "x": 52, "y": 12, "w": 46, "h": 76, "hue": "measure" }
  ],
  "caption": "The figure arrives with the chat the page already loads. It needs no request of its own and nothing to poll."
}
```

Click the figure to see where the money went:

- **Spent** has two lines. **Builderforce plan** is what your plan was billed. **Your key** is what your own provider accounts would charge, priced at list. A turn on your connected Claude or OpenAI account is not free just because we did not pay for it.
- **Saved by memory** is listed by source, and each source is either *recorded* or an *estimate*.

## What counts as a saving, and how sure we are

Only some savings can be measured. We show the two kinds apart and never add an estimate into a recorded figure.

```bf-figure
{
  "kind": "compare",
  "title": "Recorded figures and estimates",
  "columns": [
    {
      "title": "Recorded",
      "hue": "measure",
      "items": [
        "Answered from memory. When a model first answered the question, we stored its token count with the answer. A repeat of the question saves exactly that turn.",
        "Repeated request. The gateway replayed an identical request, and the stored response still carries the original call's usage.",
        "Prompt cache. Your provider reports how many prompt tokens it served from cache, at about a tenth of the price."
      ]
    },
    {
      "title": "Estimated (shown with ≈)",
      "hue": "idea",
      "items": [
        "Answered by Evermind. No paid model produced this answer, so we count the question and the answer at about four characters per token.",
        "Context kept lean. Compaction kept older turns out of each call.",
        "Recall added. The cost side: what recalled memories added to each prompt. It is subtracted from the estimate."
      ]
    }
  ],
  "caption": "The estimates err low. A real model turn also sends the system prompt, the history and the tool definitions, and none of that is counted."
}
```

That last line matters. Recall costs tokens too, because recalled memories are added to the prompt. We subtract that cost, so the saving you see is net. If memory is not paying for itself on a conversation, the figure says so.

## The Work panel, the same everywhere

The `/` panel in the prompt box is the same on every surface. That covers the web Brain, the canvas, the VS Code panel and Rovr in Chrome. It has the same four tabs: Mode, Effort, Model and Status.

```bf-figure
{
  "kind": "devices",
  "title": "One prompt area, four places",
  "devices": [
    { "label": "Web Brain", "width": 1280, "height": 800, "note": "Mode · Effort · Model · Status", "hue": "make" },
    { "label": "Canvas", "width": 1024, "height": 720, "note": "Same panel, same Status tab", "hue": "make" },
    { "label": "VS Code panel", "width": 320, "height": 720, "note": "Same panel in a narrow sidebar", "hue": "run" },
    { "label": "Rovr side panel", "width": 360, "height": 720, "note": "Same panel in Chrome", "hue": "run" }
  ],
  "caption": "One shared component. A setting cannot exist in one place and be missing from another."
}
```

**Status** now shows your workspace's AI spend and savings over the last 30 days, beside the plan and its meters. It also says plainly when every limit is lifted because you are a superadmin operator, rather than showing "Free" next to a column of "Unlimited". The project's Evermind shows as the two separate facts it really is: whether it is **learning** from this project's chats, and whether it is allowed to **answer** in place of a paid model.

**Memory**, in the Mode tab, is now a setting of the conversation itself. Turn it off in the editor and it is off on the web too. Off also means the agent's own recall and remember tools are switched off, not only the recall that happens before each answer.

## Where it sits in the method

Idea to Real closes in **Measure**: every proof has a number that could stop the project, and that number is checked once the work is running. Cost is one of those numbers, and memory is supposed to lower it. A saving that nobody can see cannot be checked. You cannot decide whether to leave memory on for a conversation, whether to connect your own key, or which effort level a task needs, without knowing what each one costs.

This puts that number where the decision is made, on the conversation, while you work, with recorded figures and estimates kept apart, so the check is honest.

It also costs nothing extra to run. The savings are written to the same usage records the platform already keeps. The figures arrive with data each surface already loads. Adding the counter did not add a single request.
