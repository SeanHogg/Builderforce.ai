---
title: One canvas, running inside another
date: 2026-09-07
description: Offboarding an employee is a flow. So is promoting one — and it contains the first. Until now every canvas was a closed system and the shared part had to be redrawn in each. A canvas can now be placed on another canvas as a single step, with the parameters it accepts read off the board itself.
tags: [creation-canvas, workflow, automation, operations, product]
author: Sean Hogg
---

# One canvas, running inside another

Draw the offboarding flow once. Revoke the accounts, run the final payroll, chase the laptop, tell the team. Six steps, wired, built, running on a schedule. Good.

Now draw the promotion flow. It approves the raise, updates the contract, tells payroll — and somewhere in the middle it offboards the contractor the promotion backfills.

Those six steps again.

For as long as the canvas has been the workflow, that was the honest answer: redraw them. And the copy you fixed was never the copy that ran. Somebody corrects the payroll step in the offboarding canvas, and four other canvases keep doing it the old way, silently, on schedule, for months.

## A canvas is now a step

`Run a canvas` is a step kind like any other. Place it, choose a canvas, and the flow you drew somewhere else is one card on this board.

```bf-figure
{
  "kind": "flow",
  "title": "Promotion, with offboarding inside it",
  "steps": [
    { "label": "Approve the raise", "note": "The gate a human actually decides", "hue": "idea" },
    { "label": "Update the contract", "note": "Documents, signatures, the record", "hue": "make" },
    { "label": "Run a canvas · Offboarding", "note": "Six steps that live on their own board, with their own author and their own history", "hue": "run", "tag": "one step here" },
    { "label": "Tell payroll", "note": "Carries what the nested canvas returned", "hue": "measure" }
  ],
  "caption": "The nested canvas is not a copy and not a link to a document. It is the flow, executed, in the middle of this one."
}
```

The step is a value, not a new kind of object — the same rule that makes a new industry a `discipline` value rather than a new vocabulary. Which means it draws, connects, groups, builds and runs exactly like the switch beside it.

## What it accepts is read off the board, not declared

The tempting design is a contract card on the child canvas: a list of parameters, a list of returns, which the parent binds against. It is explicit, it is stable, and it goes wrong the first afternoon somebody adds a step — because now there are two statements of what the canvas needs and the one that runs is not the one anybody is reading.

So there is no contract card. The interface is derived from the flow that is actually drawn:

```bf-figure
{
  "kind": "compare",
  "title": "Where an interface comes from",
  "columns": [
    { "title": "A declared contract", "hue": "muted", "items": ["Author writes the parameter list", "Author writes the return list", "Somebody adds a step", "The list and the flow disagree", "The flow wins, silently"] },
    { "title": "Derived from the board", "hue": "make", "items": ["A step nothing feeds is where data enters", "What that step declares it needs IS a parameter", "A variable nothing downstream reads IS a return", "Add a step and the interface follows", "There is nothing to keep in sync"] }
  ],
  "caption": "Same rule the board already follows for what counts as a runnable section: ask the drawing, never a marker somebody has to remember to update."
}
```

Choose a canvas in the step and it tells you, on the spot, what that canvas takes and what it hands back — without you opening it.

## Frozen, or live

Reuse raises a question that has no single right answer, so the step asks it.

```bf-figure
{
  "kind": "compare",
  "title": "Two ways to depend on somebody else's canvas",
  "columns": [
    { "title": "Snapshot — the default", "hue": "make", "items": ["The child's steps are copied into this flow when you build", "One definition, one run, one timeline", "Edits over there change nothing here until you build again", "What you shipped is what runs"] },
    { "title": "Live — opt in", "hue": "run", "items": ["This flow stores a reference to the child's own build", "The child is read again every time this flow runs", "Fix the offboarding canvas once; every caller picks it up", "The child has to have been built there at least once"] }
  ],
  "caption": "A shared subroutine wants Live. A flow that has to keep behaving the way it did when it was approved wants Snapshot. Both are one dropdown on the step."
}
```

Neither binding is allowed to fail quietly. A canvas that cannot be read, one with no steps in it, one holding a step that still needs a prompt, a canvas that reaches itself, and composition nested past five deep are all **refusals** — the build stops and the message names the canvas. That is deliberate and it is the same rule the compiler has always applied to a step with no call in it: a flow that runs, reports success and does not do the thing is worse than one that will not build.

## Where it sits in the method

Composition belongs to **Build**, the third act and the expensive one, but what it actually changes is what happens after — in Run and Measure.

[Read and Prove](/blog/read-prove-build-the-inner-loop) come first so that the decision to build is a decision. Composition is about the build you already decided on being worth keeping. A process drawn once and reused is a process you can *improve* once: the payroll correction lands in one place, and everything downstream of it is correct on the next run, because the callers hold a reference rather than a copy.

```bf-figure
{
  "kind": "stack",
  "title": "What each act gets from a canvas being reusable",
  "bands": [
    { "label": "Make", "note": "Draw the shared part once. The promotion flow says \"then offboard\" the way it says \"then send the letter\".", "hue": "make" },
    { "label": "Run", "note": "The nested steps appear in the parent's own timeline, under the child canvas's name — one run to watch, one approval gate, one place to look.", "hue": "run", "tag": "live or frozen" },
    { "label": "Measure", "note": "Fix the shared step in its own canvas and every flow that calls it is right on the next run. One correction, not seven.", "hue": "measure" }
  ],
  "caption": "The arc does not gain a stage. What it gains is that the same work stops being redrawn at every stage that needs it."
}
```

## What you can do with it today

- **Turn any canvas into a reusable step** — no export, no template, no copy. It is the canvas, running.
- **See what it takes before you wire it** — parameters and returns, derived from the child board and shown in the step.
- **Choose whether it is frozen or live** — a build you can reason about, or a shared subroutine every caller inherits.
- **Compose to five levels**, with a self-reference or an over-deep chain refused by name rather than discovered as a hung run.

Onboarding, offboarding, procurement approval, incident comms, contract renewal: every organisation has eight of these, each appearing inside a dozen larger ones. They were always the same flow. Now they are the same object.

---

**Related reading:** [The canvas is the workflow](/blog/creation-canvas-beyond-chat) · [Run the app your board just built](/blog/run-your-app-on-the-canvas) · [Approval gates and human oversight](/blog/approval-gates-and-human-oversight)

[Open a canvas](/create), draw the flow everybody keeps redrawing, and place it in the next one.
