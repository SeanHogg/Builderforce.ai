---
title: Four bands of chrome, removed — the canvas gave the screen back to the board
date: 2026-08-21
description: A workspace that spent a quarter of the window on controls, and what changed when the rule became: collapse hides controls, never status. With before and after.
tags: [creation-canvas, design, ux, product, mobile]
author: Sean Hogg
---

# Four bands of chrome, removed

Open a canvas and the board is the product. Everything else — the title, the surface switcher, the roster, the save state, the seven buttons — is scaffolding around it.

For a long time that scaffolding was arranged as **bands**: full-width strips stacked down the window, each one drawing a hard line, each one taking height from the thing people came for. The worst offender was a 54-pixel session bar carrying a title, a switcher, seven buttons, a roster and a save button spread across an entire window — mostly empty space between controls that had nothing to do with each other.

```bf-figure
{
  "kind": "screen",
  "frame": "Before — the board gets what is left",
  "ratio": 1.6,
  "regions": [
    { "label": "Session bar", "note": "Title · switcher · seven buttons · roster · save", "x": 2, "y": 3, "w": 96, "h": 11, "hue": "bad" },
    { "label": "Surface controls", "x": 2, "y": 16, "w": 96, "h": 9, "hue": "bad" },
    { "label": "The board", "x": 2, "y": 27, "w": 96, "h": 46, "hue": "muted" },
    { "label": "Team bar — always on", "x": 2, "y": 75, "w": 96, "h": 9, "hue": "bad" },
    { "label": "Live dock · legal corner", "x": 2, "y": 86, "w": 96, "h": 11, "hue": "bad" }
  ],
  "caption": "Four bands, measured out of every canvas on every page — including the live dock, which reserved a strip of the window for a call almost nobody was about to start."
}
```

```bf-figure
{
  "kind": "screen",
  "frame": "After — the board fills the window, everything floats",
  "ratio": 1.6,
  "regions": [
    { "label": "The board", "note": "Edge to edge, running behind the chrome rather than beginning below it", "x": 2, "y": 3, "w": 96, "h": 94, "hue": "make" },
    { "label": "What this canvas IS", "x": 5, "y": 7, "w": 30, "h": 10, "hue": "idea" },
    { "label": "How it is READ", "x": 38, "y": 7, "w": 26, "h": 10, "hue": "accent" },
    { "label": "How work LEAVES it", "x": 67, "y": 7, "w": 28, "h": 10, "hue": "reach" },
    { "label": "What you DO to it", "x": 20, "y": 84, "w": 60, "h": 10, "hue": "accent" }
  ],
  "caption": "Which card a control lands in is DATA, not a judgement call in a component: one table declares the four slots, and a control cannot be added to one without the test noticing it is missing from the other."
}
```

## The rule that made it safe to collapse

A canvas fills the screen and its bar does not change for minutes at a time, so folding it away is worth having. What makes that dangerous is the half of the bar that **reports** rather than acts.

Fold away "who is in this session", "is the connection live" and "is a run happening", and the operator is working blind on a board other people are editing.

```bf-figure
{
  "kind": "compare",
  "title": "Collapse hides controls, never status",
  "columns": [
    { "title": "Survives a collapse — status", "hue": "good", "items": ["The title — which canvas you are on", "Save state — the FACT of whether it is saved", "The roster — who is here", "Surface status — is this thing live"] },
    { "title": "Folds away — controls", "hue": "muted", "items": ["The surface switcher", "The action cluster", "Surface-specific controls", "The save BUTTON — pressing it opens the account gate"] }
  ],
  "caption": "Save is the interesting case: it reads as a state and behaves as a control, so the button folds and the state beside it stays. A thing you can press is a control however much its label sounds like a fact."
}
```

It is written as a table rather than a condition because "the actions" is not the boundary — the surface switcher is a control and the realtime indicator is not, and they sit two elements apart in the same row. A rule that has to be remembered by reviewers is a rule that lasts about three pull requests.

## One bar per canvas, not one per runtime

Adding a way to *run* an app on the board immediately produced the thing every visual editor is trying to avoid: two toolbars, same height, same styling, disagreeing about which one you press.

Now the surface contributes its controls **into** the one bar. A surface added next year gets a place in it for free, and an action declares what it *needs* — objects, a board — rather than listing the surfaces it applies to. The alternative would have every future surface added to every list that happens to apply to it, in a file nobody opens for that reason.

## And a phone could not share a canvas at all

This is the part worth generalising.

A blanket mobile rule hid every unlabelled button in the bar. The overflow sheet that survived it listed none of them. So a phone silently lost undo, redo, diagnostics, the outcome scorecard **and every route to the invite panel** — five actions, none of them declared missing anywhere. It fell out of one line of CSS keyed on a class name.

Placement is data now: every action declares whether a phone shows it in the bar or in the overflow, and both are rendered from that one list, so bar and menu are complements of each other. An action cannot land in neither, and a test asserts it — including the two-action budget for the phone bar, because past two, the thing that gets squeezed out is the title, which is the only thing telling you which canvas you are on.

---

**Related reading:** [Run the app your board just built](/blog/run-your-app-on-the-canvas) · [The Creation Canvas is not a chat window](/blog/creation-canvas-beyond-chat) · [Multiplayer Creation Canvas, web and VS Code](/blog/multiplayer-creation-canvas-web-vscode)

[Open a canvas](/create) — it is the same on a phone now, which it was not.
