---
title: Fixed-price milestones, with the money held until it is delivered
date: 2026-08-20
description: Escrow only works when both sides can see the same balance and the same next move. Here is how milestone funding, delivery, acceptance and release work when the schedule lives beside the work.
tags: [freelance, escrow, milestones, marketplace, contracts]
author: Sean Hogg
---

# Fixed-price milestones, with the money held until it is delivered

Fixed-price work fails in two directions, and everybody who has been on either side knows both.

The client pays up front and the work drifts. Or the contractor delivers and the invoice ages into a conversation about whether it was really finished. Hourly billing exists partly to route around this, and it solves it by making nobody accountable for an outcome.

Escrow is the old answer: money committed, held, and released against agreed deliverables. It works, and it usually fails on the software rather than the idea — because the two sides are looking at different screens that disagree about what has happened.

## One schedule, three surfaces, no second copy

```bf-figure
{
  "kind": "flow",
  "title": "The life of a milestone",
  "steps": [
    { "label": "Fund", "note": "The client commits the amount. Until this happens the milestone is not startable — the whole point of the arrangement.", "hue": "reach", "tag": "client" },
    { "label": "Deliver", "note": "The contractor marks it delivered with whatever the deliverable was.", "hue": "make", "tag": "contractor" },
    { "label": "Accept or ask", "note": "The client accepts, or requests changes with a reason. Both are recorded; neither is a silence.", "hue": "run", "tag": "client" },
    { "label": "Release", "note": "The held amount moves. The balance, the five rolled-up totals and the history all come from the same read.", "hue": "measure" }
  ],
  "caption": "Cancellation is a first-class step too, and it behaves differently before and after funding — because those are genuinely different situations, not one situation with a flag."
}
```

The panel a client sees inside their engagement, the panel an employer sees on a posting, and the contractor's own milestones tab are **one component**. Not three implementations of a shared design — one, rendered in three places.

That is not tidiness for its own sake. It is what stops the classic escrow bug, where the client's screen offers *Release* while the server has already moved the milestone into a state where release is refused, and the person clicking gets an error that reads like a system fault and feels like a swindle.

## The buttons are the server's decision

This is the design decision worth stealing, whatever you are building.

Every milestone row arrives from the server carrying the list of **actions available to this party in this state**. The panel renders the moves it was handed. It cannot offer one that would be refused, because it does not know how to compute one.

```bf-figure
{
  "kind": "compare",
  "title": "Two ways to decide what a button offers",
  "columns": [
    { "title": "The browser computes it", "hue": "bad", "items": ["The rule lives in two places", "A third copy appears in the mobile app", "They drift on the first edge case", "The user meets the drift as an error"] },
    { "title": "The server projects it", "hue": "good", "items": ["One machine decides, one machine judges", "A new state is a server change with no UI edit", "The panel cannot offer an impossible move", "Every surface agrees by construction"] }
  ],
  "caption": "The same reason a shared component decides its own visibility rather than taking a `canRelease` prop from whoever rendered it."
}
```

## A bid can propose its own schedule

A fixed price with no shape is just a number to argue about. A bid can now carry the schedule it is proposing — the milestones, what each one delivers, what each is worth — so the negotiation is about the plan rather than about the total. Accepting the bid accepts the schedule with it.

That also makes the first conversation better. "£12,000" invites haggling. "£12,000, in four pieces, the first of which is a working import you can run against your own data in week two" invites a decision.

## Where it sits

Market — sell, buy, hire, be found — is the stage after the thing works. Escrow is one of the mechanisms that makes buying work between parties who have no reason to trust each other yet, which is the normal condition of a marketplace. It sits beside the [commercial vocabulary](/blog/close-the-deal-on-the-board-you-built-it-on) on the board and the [invoices and collections](/blog/the-founder-back-office-money-ownership-and-paperwork) in the back office: the same money, at three different distances from the work.

---

**Related reading:** [Close the deal on the board you built it on](/blog/close-the-deal-on-the-board-you-built-it-on) · [Hire, assign and pay for work in one place](/blog/hire-assign-and-pay-for-work-in-one-place) · [The founder back office](/blog/the-founder-back-office-money-ownership-and-paperwork)

Browse the [freelance marketplace](/freelancer) or [open a canvas](/create) and scope the work first.
