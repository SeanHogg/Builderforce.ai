---
title: Write the idea down before it's gone — and know which ones you've actually tested
date: 2026-09-15
description: Every canvas now has an Ideas scratchpad. Capture an idea in a sentence, track it from first thought to validated, and plan the customer interview that tests it — on the same board where it becomes real.
tags: [creation-canvas, product-ideation, validation, idea-to-real, methodology]
author: Sean Hogg
---

# Write the idea down before it's gone — and know which ones you've actually tested

Most ideas don't die because they were bad. They die in a notes app.

You have one in the shower, on a walk, halfway through a call about something else. You write it somewhere — a notes app, the back of a receipt, a Slack message to yourself — and it sits there with forty others, none of them any further along than the day you had them. Six months later you can't say which ones you ever tested with a real customer, and which ones you only *felt* good about.

The canvas had the opposite problem. It could hold a researched customer segment, a competitor battlecard, a customer interview and a scored experiment. It had nowhere to put the half-formed thought that started all of them.

## The Ideas scratchpad

Every canvas now has a fourth way to read the board, right next to Board: **Ideas**.

```bf-figure
{
  "kind": "screen",
  "frame": "The Ideas scratchpad on a canvas",
  "ratio": 1.62,
  "regions": [
    { "label": "Capture", "note": "Type the thought, press Capture — the first line becomes its title, the whole note is kept", "x": 4, "y": 8, "w": 92, "h": 20, "hue": "idea" },
    { "label": "Stages", "note": "How many ideas sit at each stage — press one to filter", "x": 4, "y": 32, "w": 26, "h": 60, "hue": "accent" },
    { "label": "Your ideas", "note": "Newest first, each with its stage, next step and evidence", "x": 33, "y": 32, "w": 63, "h": 60, "hue": "make" }
  ],
  "caption": "The scratchpad is a reading of the board, not a second place to keep things. Every captured idea is a card on the board, so Brain sees it and you can drag it next to the work it turns into."
}
```

Writing one down takes about as long as it takes to have it. Type a sentence, or three, and press **Capture**. The first line becomes the idea's title and the whole note is kept exactly as you wrote it. Half-formed is the point: a scratchpad that asks for a problem statement before it will take a note is a form, and the note gets lost.

Then the scratchpad keeps track for you. Every idea has a stage, and the stages are the ones an idea actually passes through:

```bf-figure
{
  "kind": "flow",
  "title": "The life of an idea",
  "steps": [
    { "label": "Captured", "note": "Written down. Nothing more is asked of it.", "hue": "idea" },
    { "label": "Exploring", "note": "Being researched — the problem, who has it, who else is solving it.", "hue": "idea" },
    { "label": "Validating", "note": "A customer interview or an experiment is under way.", "hue": "make" },
    { "label": "Validated", "note": "The evidence came back yes.", "hue": "run", "tag": "earned, not felt" }
  ],
  "caption": "Three more stages are exits, and each means something different a month later: Parked is 'not now', Dropped is 'the evidence said no', and Promoted is 'it became something' — a project, a company, a proof."
}
```

## Where customer interviews come in

An idea is only as good as the conversations behind it, so every idea in the scratchpad has a **Plan an interview** button. Press it and three things happen at once: a customer interview card lands on the board, titled after the idea; the idea records that this interview tests it; and an idea that was only captured or being explored moves to Validating.

When the interview is written up — the questions, the pains the person raised without being asked, the verbatim quotes — the idea counts it. Every idea shows its evidence in plain words: *tested by 2 interviews and 1 experiment*, or *untested — talk to someone before you build*. If an idea names an interview that isn't on the board, it says so instead of counting it.

And at the top of the scratchpad is the one number worth acting on: how many of your open ideas nobody has tested with a customer yet.

```bf-figure
{
  "kind": "compare",
  "title": "Keeping ideas vs. tracking them",
  "columns": [
    { "title": "A notes app", "hue": "muted", "items": ["Forty ideas, all in the same state", "No record of who you asked", "'Validated' means it still feels good", "Starting the work means copying it somewhere else"] },
    { "title": "The Ideas scratchpad", "hue": "idea", "items": ["Every idea has a stage", "Interviews and experiments linked to the idea they test", "Validated means the evidence said yes", "The idea is already a card on the board where the work happens"] }
  ],
  "caption": "The difference is not where the words are stored. It is whether 'have we talked to anyone about this?' has an answer."
}
```

## Where it sits in the method

Idea to Real runs **Idea → Make → Run → Measure**, and the first act is the cheapest on purpose: [Read and Prove](/blog/read-prove-build-the-inner-loop) come before Build so that deciding to build is a decision, not momentum.

The scratchpad is the front door of that first act. **Capture** is the moment before Read — the idea has to exist somewhere before anyone can research it. **Exploring** is Read: Brain can take any idea on the board and research the problem, the segment and the competition around it. **Validating** is Prove: the customer interview or experiment that turns an assumption into a fact, and the cheapest of the [eight ways to make an idea real](/blog/eight-ways-to-make-an-idea-real). Only an idea that has been through both should be **Promoted** into something you build.

That stage needed this because it was the one place the method had no object. Everything after it did — proofs, projects, releases, metrics. The idea itself lived in whatever app you happened to have open when you had it.

## What you can do with it today

- **Capture an idea in seconds** from any canvas, in a sentence, without deciding what it is yet.
- **See every idea at once**, newest first, filtered by stage with one press.
- **Plan the customer interview that tests an idea** in one click, linked both ways.
- **See which ideas are actually tested** — and how many open ideas nobody has talked to a customer about.
- **Ask Brain to research any idea** on the board, because every idea is already a card it can read and fill in.

---

**Related reading:** [Read, Prove, Build — the inner loop](/blog/read-prove-build-the-inner-loop) · [Eight ways to make an idea real](/blog/eight-ways-to-make-an-idea-real) · [Customer feedback to ten mockups](/blog/customer-feedback-to-ten-mockups)

[Open a canvas](/create), press Ideas, and write down the one you've been meaning to test.
