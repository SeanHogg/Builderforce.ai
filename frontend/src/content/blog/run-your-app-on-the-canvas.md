---
title: Run the app your board just built — without leaving the board
date: 2026-08-22
description: A canvas that writes a backend, a page and a setup note used to have nowhere to run them. The app surface assembles every code card into one working application, at real device widths, on the same board you built it on.
tags: [creation-canvas, app-development, preview, no-code, product]
author: Sean Hogg
---

# Run the app your board just built — without leaving the board

Ask for an SMS sender and four cards land on the board: `backend/server.js`, `frontend/index.html`, a rendered page, a setup note. All connected, all correct, all sitting there.

Then what?

For a while the honest answer was: nothing, on that screen. The board could describe an application in complete detail and had no way to run one. The only route to a live URL ran through a card inspector, behind a publish action, framed as commerce — three clicks deep and invisible until you had selected exactly the right card. A canvas that can build software and cannot run it is a very good notebook.

## The app surface

There is now a fourth way to read a board, alongside the conversation, the graph and the 3D space: **the app**.

```bf-figure
{
  "kind": "flow",
  "title": "What happens when you switch to the app surface",
  "steps": [
    { "label": "Gather", "note": "Every code card on the board becomes a file. Not the selected one — all of them, in the structure they describe.", "hue": "make" },
    { "label": "Assemble", "note": "The entry page is found, and its sibling stylesheets and scripts are inlined so a preview has something to resolve them against.", "hue": "make" },
    { "label": "Run", "note": "One working document, framed at a real device width, with build and runtime errors travelling back to the assistant that wrote it.", "hue": "make", "tag": "on the board" }
  ],
  "caption": "The surface reads the whole session, not one card. An application spread across six cards is one artifact, which is what nothing on the board could previously express."
}
```

Two things about that were harder than they look.

```bf-figure
{
  "kind": "screen",
  "frame": "A board reading as an app",
  "ratio": 1.62,
  "regions": [
    { "label": "The running application", "note": "Every code card on the board, assembled and served as one document", "x": 4, "y": 8, "w": 62, "h": 74, "hue": "make" },
    { "label": "Brain", "note": "Asks for the change, sees the error", "x": 69, "y": 8, "w": 27, "h": 74, "hue": "idea" },
    { "label": "Surface switcher", "x": 4, "y": 88, "w": 30, "h": 8, "hue": "accent" },
    { "label": "Run · widths · share", "x": 38, "y": 88, "w": 58, "h": 8, "hue": "accent" }
  ],
  "caption": "One command bar for the whole canvas, not one per runtime. The app surface contributes Run and the three widths INTO that bar rather than drawing a second one under it."
}
```

**A preview needs an origin.** A document handed to a frame has no address, so `href="styles.css"` resolves against nothing and you get a correct-looking page with none of its styling — the classic "why does the preview look broken when the code is fine" report. The surface inlines siblings for exactly that reason.

**Device widths are not a max-width.** Desktop, tablet and phone used to be three buttons that changed nothing you could see, because the frame was told both to be a certain width and to fill the space, and filling won. Worse, even where a cap did apply, capping a document hands it the *smaller* width — so its own media queries fire for the frame and your "desktop" reading renders the mobile collapse. The three settings now lay the document out at 1280, 834 and 390 real CSS pixels and scale the result into the box. They differ the way three real machines differ, because that is what they now are.

```bf-figure
{
  "kind": "devices",
  "title": "Three readings, at three real widths",
  "devices": [
    { "label": "Desktop", "width": 1280, "hue": "make", "note": "The document lays out at 1280 and is scaled into the frame" },
    { "label": "Tablet", "width": 834, "hue": "run", "note": "Its own media queries fire for 834, not for the frame" },
    { "label": "Phone", "width": 390, "hue": "measure", "note": "The mobile collapse you actually ship" }
  ],
  "caption": "Widths drawn to scale: each frame's share of the row is its width over the sum of them. A capped frame hands the document the SMALLER width, which is why the old Desktop reading rendered the mobile layout."
}
```

## The defect underneath

While building this we found something worth saying out loud, because it had been silently costing people whole sessions.

The app surface read a code card's source from one field. The assistant writes it to another — the field its own tool carries, and the first one the card preview reads. So every code card the assistant authored looked perfect on the board and contributed **nothing** to the app. No error, no warning, no empty state explaining itself: just "Nothing to run yet" under a board full of code.

A second one sat next to it. Every workspace file read and write was asking the server for an empty path, because of a routing detail that returns `undefined` for the part of the URL that carries the filename. A canvas could create a project and then never write a line of code into it — four tool calls failing in a row and a turn ending with a shrug.

Both are fixed. We mention them because a feature announcement that only lists new capabilities is a marketing document; the reason the app surface now works is as much these two as the surface itself.

## Where it sits in the method

Building is the third act, and the expensive one. [Read and Prove](/blog/read-prove-build-the-inner-loop) come first and cost nothing, precisely so that the decision to build is a decision. But once you are building, the loop from *change something* to *see it* is the whole experience — and every hop out of that loop, into a terminal, a deploy, a preview URL, a different tab, is a place where attention leaks.

```bf-figure
{
  "kind": "compare",
  "title": "The distance from edit to evidence",
  "columns": [
    { "title": "The usual loop", "hue": "muted", "items": ["Edit in the editor", "Save", "Wait for a build", "Switch to a browser", "Refresh", "Discover the styling did not load", "Guess why"] },
    { "title": "On the board", "hue": "make", "items": ["Ask for the change", "Watch the cards update", "Read it at the width you meant", "Errors go back to the assistant that wrote them"] }
  ],
  "caption": "Build and runtime errors now travel back to the agent, so a broken build is something that gets fixed rather than something that sits there looking finished."
}
```

## What you can do with it today

- **Describe an application and run it in the same minute** — the backend, the page and the assets assemble into one thing you can click.
- **Read it at three real widths** before anyone opens it on a phone.
- **Turn it into a project** when it stops being a sketch: one button gives the board its own runtime, its own data, its own people and its own web address, and the address is chosen up front rather than discovered at publish.
- **Package it** as an installable web app, an Android build or a signed iOS build — what ships inside the package is exactly what you previewed.

None of that requires leaving the board, and that is the point. The board is not a planning artifact that precedes the real work. It is where the work is.

---

**Related reading:** [The Creation Canvas is not a chat window](/blog/creation-canvas-beyond-chat) · [Create before you sign up](/blog/create-before-you-sign-up) · [Design, build, debug — one spatial workspace](/blog/design-build-debug-one-spatial-workspace)

[Open a canvas](/create) and ask for something with a backend in it.
