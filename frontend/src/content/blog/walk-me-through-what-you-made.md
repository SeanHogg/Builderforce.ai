---
title: "Twenty-four things landed on your board. Here is where to start."
date: 2026-09-07
description: A generated canvas is the product working and, for the person who asked one question, a wall. The walkthrough groups what was made, orders it by what feeds what, and takes you round it one stop at a time.
tags: [creation-canvas, onboarding, product, ai-agents]
author: Sean Hogg
---

# Twenty-four things landed on your board. Here is where to start.

Paste a business plan into a canvas, address it to five of your agents, and go and make a coffee.

Four minutes later there are twenty-four objects on the board. A company profile. Six competitors, each with a researched revenue estimate and a headquarters. Two customer segments, sized. A go-to-market plan. A pricing model. A map with the competitive geography plotted on it.

This is the product working exactly as intended, and it is also the moment people tell us they freeze.

> It is impressive. I do not know what to do with it.

That is not a complaint about the research. It is a complaint about arrival. Twenty-four objects is more than anyone reads at once, and a board gives you no reason to look at any particular card first.

## What was actually wrong

Three things, and only one of them was about explanation.

```bf-figure
{
  "kind": "compare",
  "title": "Why a generated board felt like a wall",
  "columns": [
    { "title": "What you saw", "hue": "muted", "items": ["A tall ribbon of cards running off the bottom of the screen", "Two thirds of a wide monitor empty beside it", "Six agent cards stacked on one point, reading as one card", "The same competitor researched twice", "No indication which of these to open"] },
    { "title": "What was happening", "hue": "make", "items": ["The placer could only grow downward, never across", "Nothing measured how wide the board actually was", "Objects added in one tick all took the same coordinate", "A turn cut off at its output limit re-made what it could no longer see", "Nothing on the board knew how to introduce itself"] }
  ],
  "caption": "The first four are placement bugs and are fixed. The fifth is the one that needed something new."
}
```

The placement half is worth a sentence because it is the least interesting and was doing the most damage. New objects were placed by walking *down* from a starting point until they found a clear space — sound reasoning for one card, and wrong for a batch. Ten objects authored in a single turn, none carrying coordinates, each placed against the nine before it, produce one narrow column. On a 3440-pixel monitor that is a ribbon with most of the screen unused, which is the report we got.

Objects now fill the width the board actually has before they grow downward, and the width the board actually has is something the canvas measures rather than something it assumes.

## The walkthrough

The canvas already had a tour. It toured the *chrome*: here is the Brain dock, here is the palette, here is Share. That is the right tour for your first board and it says nothing at all about your work.

So there is a second one, and it walks the artifacts.

```bf-figure
{
  "kind": "flow",
  "title": "How the walkthrough decides what to show you",
  "steps": [
    { "label": "Group", "note": "By kind, not by card. Six competitors are one answer — here is who you are up against — not six steps.", "hue": "read" },
    { "label": "Order", "note": "By the board's own connections. What feeds what is already drawn on the canvas, so the walk follows it, and falls back to reading order when nothing is connected.", "hue": "read" },
    { "label": "Walk", "note": "The board flies to each group in turn and says what it is, in the object's own words rather than a generic caption.", "hue": "make", "tag": "on the board" }
  ],
  "caption": "Nothing here is a hand-written running order. A new kind of object joins the walk the day it can be created, because the walk is derived from the board rather than listed somewhere."
}
```

Grouping is the decision that makes it work. One stop per object is the same wall with a Next button on it — twenty-four steps is worse than twenty-four cards, because now you cannot skim. Twenty-four objects across nine kinds is nine things worth saying, and one of them is *these six were researched together; read them as a set, the comparison is the point.*

```bf-figure
{
  "kind": "screen",
  "frame": "Stop 3 of 8",
  "ratio": 1.62,
  "regions": [
    { "label": "6 competitor objects", "note": "The group in the spotlight, brought into view", "x": 4, "y": 10, "w": 58, "h": 56, "hue": "make" },
    { "label": "What this group is", "note": "Named from the object's own authored line, never an invented summary", "x": 66, "y": 16, "w": 30, "h": 34, "hue": "idea" },
    { "label": "The rest of the board", "note": "Still visible, still yours", "x": 4, "y": 70, "w": 58, "h": 18, "hue": "muted" },
    { "label": "Back · Next · leave any time", "x": 66, "y": 54, "w": 30, "h": 8, "hue": "accent" }
  ],
  "caption": "The spotlight now follows a card the canvas is still flying towards. It used to measure once, on the first frame, and pin itself to where the card had been."
}
```

It is offered once per board, on boards with enough on them to get lost in — a canvas with three cards does not need a guide, and offering one reads as the product not trusting you. Afterwards it lives in the command bar, next to the diagnostics and the outcome scorecard, because it answers the same question those do: *what have I actually got here.*

## Two duplicates that were never yours

While we were in here, the same session report showed the same competitor on the board twice, and one agent three times. Neither was a research failure.

**A seat is an identity, not an event.** Addressing the same teammate twice used to seat two cards with the same name. It now brings the one you already have into view.

**A model that gets cut off re-does its work.** When a turn hits its output limit mid-sentence, the next attempt no longer has its own transcript to check against — so it authors the company profile again. The board can still see it, so the board is now what answers: an object of the same kind with the same name gets you the id of the one that already exists and an instruction to update it. Stickies are exempt, because a wall of stickies may perfectly well have three saying Pricing.

## Where it sits in the method

[Read comes before Prove, and Prove before Build](/blog/read-prove-build-the-inner-loop) — the whole point of the order being that reading is cheap and building is not, so the decision to build should be an informed one.

This lands squarely in **Read**, and it closes a gap that had opened up there. We had made *generating* the evidence almost free: one prompt, four minutes, a researched competitive landscape with sources. What we had not made free was *absorbing* it. An unread landscape informs no decision at all, so a Read stage that produces more than a person can take in has quietly failed at the one thing it exists for — and it fails invisibly, because the board looks impressive either way.

```bf-figure
{
  "kind": "compare",
  "title": "The distance from generated to understood",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["Twenty-four cards appear", "Open one at random", "Try to work out what the set is", "Miss the segments entirely", "Ask Brain what it made"] },
    { "title": "Now", "hue": "read", "items": ["Twenty-four cards appear, laid out across the screen", "Press Show me round", "Eight stops, in the order the board itself implies", "Leave at any step and start working"] }
  ],
  "caption": "Reading is only cheap if it actually happens. This is the difference between evidence being produced and evidence being read."
}
```

## What you can do with it today

- **Ask a big question and get a legible answer** — the objects arrive laid out across your screen rather than stacked down it.
- **Press Show me round** when a board comes back fuller than you expected, and leave at whichever stop you have seen enough.
- **Come back to it later** from the command bar, on any board, as many times as you like.
- **Stop deduplicating by hand** — the same competitor, company or teammate does not land twice.

---

**Related reading:** [The Creation Canvas is not a chat window](/blog/creation-canvas-beyond-chat) · [Brain operates the Creation Canvas](/blog/brain-operates-the-creation-canvas) · [Run the app your board just built](/blog/run-your-app-on-the-canvas)

[Open a canvas](/create) and ask it something big enough to need a tour.
