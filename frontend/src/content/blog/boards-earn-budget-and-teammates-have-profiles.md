---
title: A board now earns its budget — and your teammates finally have a page
date: 2026-11-08
description: Delivery never showed up in what a board earns or what investors see. Now every ticket that reaches Done earns its board budget, milestones roll up to the investor seam, and each teammate has a profile you can reach from a mention.
tags: [boards, delivery, investors, people, personality, product]
author: Sean Hogg
---

# A board now earns its budget — and your teammates finally have a page

A board could close a hundred tickets in a month and nothing anywhere would say so. The work was real, the tickets were Done, and the number that answers "what did this board earn?" did not exist. Investors had the same problem from the other side: the update they read described the company in sentences, while the delivery that justified the sentences sat on a board they would never open.

Two gaps, one root. Delivery was a fact on a ticket and never became a fact about the board, or about the company.

## A board earns when its tickets reach Done

Every ticket that moves into a Done lane now earns its board budget, in points: the ticket's story points, or one point when nobody estimated it. It happens in the single place every lane move passes through, so dragging a card, an agent finishing a run and a merged pull request all pay the same way, and a ticket that is reopened and closed again pays once.

```bf-figure
{
  "kind": "flow",
  "title": "From a closed ticket to a number a board can show",
  "steps": [
    { "label": "Ticket reaches Done", "note": "Any path: a drag, an agent run, a merged pull request.", "hue": "make" },
    { "label": "Board earns points", "note": "Its story points, or one. Recorded once per ticket, so a reopen never pays twice.", "hue": "run" },
    { "label": "Milestone reached", "note": "An epic completes or a release ships, and the board's earnings for it are totalled.", "hue": "measure", "tag": "to the investor seam" }
  ],
  "caption": "Earning rides the same ledger that holds every other balance in the product. There is no second table to drift from the work it describes."
}
```

Spend sits beside it, not inside it. What a board's runs cost is already recorded per ticket, so the panel reads that figure rather than writing a second copy that could disagree with the first.

```bf-figure
{
  "kind": "screen",
  "frame": "A board with its budget open",
  "ratio": 1.62,
  "regions": [
    { "label": "The board", "note": "Lanes and tickets, exactly as before", "x": 4, "y": 8, "w": 56, "h": 74, "hue": "make" },
    { "label": "Earned budget", "note": "Points earned, run spend, milestones reached, recent earnings", "x": 63, "y": 8, "w": 33, "h": 74, "hue": "run" },
    { "label": "Board toolbar", "note": "One new button, next to configure", "x": 4, "y": 88, "w": 92, "h": 8, "hue": "accent" }
  ],
  "caption": "The budget opens in a side panel over the board, so the lanes stay in view while you read it."
}
```

## Milestones that reach investors

A milestone is a thing that happened to a board: an epic completed, or a release scoped to its project shipped. Each one now carries the points its tickets earned, and one read lists every milestone reached since a given date, per board. The investor update composes its delivery section from that read. The update no longer says "we shipped" without a board and a number behind it.

## Teammates have a page, and mentions know who they are talking to

The second gap was smaller and more human. A teammate's personality showed up in a hover on the board and nowhere you could link to. There was no page for a person at all.

- **A profile for every teammate**, at their own address: name, avatar, role in your workspace, personality, and a summary of the work on their plate: open tickets, what they touched in the last thirty days, what they have finished. It is visible to people in the same workspace and to nobody else.
- **Reachable from where you meet people**: the board hovercard and the members directory both link to it.
- **Mentions carry the signal.** Type `@` and each person in the list shows a one-line read of their personality, such as their type and strongest trait. It comes from the same cached map the hovercard uses, loaded once, so opening the list and typing in it adds no requests.

```bf-figure
{
  "kind": "compare",
  "title": "Choosing who to direct a message to",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["A list of names", "Open a board to find out how someone works", "No page to send a colleague to"] },
    { "title": "Now", "hue": "make", "items": ["Names with a one-line personality read", "A profile one click from the hovercard or the directory", "Work summary beside the personality"] }
  ],
  "caption": "Personality shapes tone, not permissions. Nothing about who can do what changed."
}
```

```bf-figure
{
  "kind": "devices",
  "title": "The profile page at three widths",
  "devices": [
    { "label": "Desktop", "width": 1280, "hue": "make", "note": "Header, work summary and personality in one column" },
    { "label": "Tablet", "width": 834, "hue": "run", "note": "Counts wrap into rows" },
    { "label": "Phone", "width": 360, "hue": "measure", "note": "Everything stacks; nothing scrolls sideways" }
  ],
  "caption": "Widths drawn to scale."
}
```

## Where it sits in the method

Builderforce arranges work as one arc: Idea, Make, Run, Measure. This change touches the last three, and the join between them is the point.

**Make** is where the board lives and where tickets get done. That is where a board now earns. **Run** is where the work costs money, and the budget panel puts what a board earned next to what its runs cost. **Measure** is where you find out whether any of it mattered, and a milestone is the first measurement that leaves the board: it reaches the investor update with a number behind it. The people page belongs to Make as well. Knowing who you are working with, and how, is part of making well.

Before, the arc broke between Make and Measure: the work happened and the evidence stayed behind. It now travels with the work.

---

**Related reading:** [Run the app your board just built](/blog/run-your-app-on-the-canvas) · [Your private Evermind on your machine](/blog/your-private-evermind-on-your-machine)

[Open a board](/tasks) and move a ticket to Done.
