---
title: Sign it off, read the numbers, plug in your own tools — inside the room
date: 2026-09-12
description: The canvas could already tell you a change needed a signature, define every metric once, and register a third-party widget. It just had nowhere to do any of the three. The room now has an approval desk, a live metrics board and stands for third-party widgets.
tags: [creation-canvas, approvals, governance, metrics, widgets, 3d, product]
author: Sean Hogg
---

# Sign it off, read the numbers, plug in your own tools — inside the room

Three things on the canvas were finished and could not be reached.

**The approval gate.** Ask the assistant to rebalance a budget and it records every figure it moves: who moved it, from what, to what, and why. Acts that leave the building or that someone will later rely on — sending a campaign, issuing an invoice, approving a budget — are gated, and an agent cannot approve its own change. That part worked. The part that didn't: there was no place where a person could see what was waiting and sign it off. So the record filled up, the gated acts stayed blocked, and "who approved this figure?" had an honest answer that nobody could act on.

**The metric layer.** A metric on the canvas is a *definition* — source, filter, aggregate, target, which direction counts as good — rather than a number someone typed into a tile, so two tiles called "MRR" cannot disagree. The engine that evaluates a whole set of them at once, derived ratios included, had no card. Every definition was correct, and you couldn't see any of them together.

**Third-party widgets.** An integrator could register a widget, declare its permissions and place it on a board through the API. Nothing in the browser mounted it. The contract existed on both sides and the rectangle in the middle was empty.

All three now live in the room, the canvas's one spatial surface, next to the people and the session.

```bf-figure
{
  "kind": "screen",
  "frame": "The room, with its stations",
  "ratio": 1.62,
  "regions": [
    { "label": "Approval desk", "note": "What is waiting on a signature, counted on its face", "x": 3, "y": 14, "w": 22, "h": 40, "hue": "prove" },
    { "label": "The session and its people", "note": "The board on the table, the team around it", "x": 30, "y": 22, "w": 38, "h": 52, "hue": "idea" },
    { "label": "Metrics board", "note": "Behind-target first, every number with its evidence", "x": 72, "y": 14, "w": 22, "h": 40, "hue": "measure" },
    { "label": "Widget on a stand", "note": "A third-party tool, live on the face", "x": 72, "y": 58, "w": 22, "h": 30, "hue": "run" },
    { "label": "Stations list", "note": "Every station, one keypress away", "x": 3, "y": 58, "w": 22, "h": 30, "hue": "accent" }
  ],
  "caption": "Each station stands in the room like a creation does: you can drag it anywhere, the room remembers where you left it, and its caption opens a full 2D panel. The same list sits beside the roster, so every station is reachable by keyboard, by screen reader, and on a device without 3D."
}
```

## The approval desk

The desk shows how many changes are waiting and on what. Open it and each object lists its pending moves the way a reviewer needs to read them: the field, what it was, what it became, who changed it, when, and where the new value came from. Then you choose.

- **Approve** signs every waiting change on that object in your name. The signature stamps the same entries the change created, so there is never an approval without the change it approved.
- **Approve and send** (or *issue*, or *publish*) appears only when your signature is exactly what the gate needs for that act. It signs, then runs the act, in that order, in one click.
- **Refuse** records that someone looked and said no. The figure isn't silently rolled back, because that would be a second unattributed change. The act stays blocked until somebody makes a change they are willing to sign.

```bf-figure
{
  "kind": "flow",
  "title": "A figure's path from change to act",
  "steps": [
    { "label": "Moved", "note": "The assistant or a widget changes a budget line. The move is recorded with who, from, to and why.", "hue": "build" },
    { "label": "Waiting", "note": "The gate refuses the budget's gated acts. The desk counts one more change.", "hue": "prove", "tag": "at the desk" },
    { "label": "Signed", "note": "A person who did not make the change approves it. You cannot approve your own work, and an agent cannot approve at all.", "hue": "prove" },
    { "label": "Acted", "note": "The act the signature authorised runs, and the record shows who stood behind it.", "hue": "run" }
  ],
  "caption": "Separation of duties is one rule, read by both the gate and the desk. A desk that let you sign what the gate would refuse you would just be a way around the gate."
}
```

This is the control a finance lead or a CMO needs before handing a board to an agent. It's also the evidence an auditor asks for: a change, the person who approved it, and when, all in one record.

## The metrics board

Once a session defines a metric, a board stands in the room. Every metric on the board is evaluated together — plain aggregates over their datasets, and derived ratios like gross margin or net revenue retention through the metrics they are made of — so the tiles cannot drift apart.

It reads as an insight first and as tiles second. Metrics behind target come first. Metrics that can't be computed say why, and never show a zero, because a margin computed against a missing cost line reads as 100% and is the most dangerous wrong answer a dashboard can give. Every number carries its evidence: how many rows it was computed from, or how many metrics a derived figure depends on. Time-grained metrics carry a trend line.

## Third-party widgets on a stand

A widget registered for your workspace and placed on the board now runs twice over: on its card on the flat canvas, and on a stand in the room with the live frame on its face. The containment is the part we care most about:

```bf-figure
{
  "kind": "compare",
  "title": "What a widget can and cannot do",
  "columns": [
    { "title": "It can", "hue": "run", "items": ["Read the board's title and its objects' names, if granted", "Create, edit and remove objects, if granted — through the same edit path a person uses", "Keep a small private store on its own placement", "Raise a notice on the canvas"] },
    { "title": "It cannot", "hue": "bad", "items": ["Share the canvas's origin, cookies or storage — it runs in an opaque sandbox", "See object data beyond an id, kind, title and status", "Re-point a placement, change an approval mode, or touch another widget's store", "Change a money-bearing figure without that change waiting at the approval desk"] }
  ],
  "caption": "Every message is checked in the protocol's order: it came from this frame, the frame is still on its registered address, the type is on the allowlist, and the permission was granted at registration. If the frame navigates away from its registered address, the board stops answering it."
}
```

That last line on the right-hand side is where the three stations meet. A widget with write access is an agent from the gate's point of view: its moves to attributed fields are recorded against the widget and wait at the desk like any other change.

```bf-figure
{
  "kind": "devices",
  "title": "The desk's panel, at the widths people actually use",
  "devices": [
    { "label": "Desktop", "width": 1280, "hue": "prove", "note": "Beside the room" },
    { "label": "Tablet", "width": 834, "hue": "measure", "note": "Over the room" },
    { "label": "Phone", "width": 390, "hue": "run", "note": "Full width, 44px targets" }
  ],
  "caption": "The 2D panel is the accessible equivalent of walking up to a stand. It works on a phone and a coarse pointer, and follows the viewer's theme."
}
```

## Where it sits in the method

The method is an arc: **Idea → Make → Run → Measure**. Inside it, [Read → Prove → Build](/blog/read-prove-build-the-inner-loop) is how you cross from an idea into something made. The loop closes in *Measure*, where the number you committed to is checked against what actually happened. These three stations sit at the two ends of that arc that had nothing to stand on:

- **The metrics board is Measure** — the kill condition a proof committed to, read from the same definitions every tile and report uses.
- **The approval desk is the hinge between Build and Run.** What an agent built becomes something the business relies on only after a named person signs it off.
- **Widgets bring your own tools into Run**, contained, so an operating board can use the systems your team already works in.

The room's teaching features — for classes and cohorts — are arriving the same way, as stations in the same room.

---

**Related reading:** [Approval gates and human oversight](/blog/approval-gates-and-human-oversight) · [Stand up inside your board](/blog/stand-up-inside-your-board) · [Grade the proof and close the loop](/blog/grade-the-proof-and-close-the-loop)

[Open a canvas](/create), ask the assistant to draft a budget, then walk over to the desk.
