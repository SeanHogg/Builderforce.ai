---
title: Build a 3D world in the browser — and walk around in it
date: 2026-08-21
description: Place props, move a camera and walk a scene with real physics, on the same canvas that writes your code. Games made here play, including a Roblox place decoded and walked in the browser.
tags: [creation-canvas, 3d, game-development, roblox, webgl]
author: Sean Hogg
---

# Build a 3D world in the browser — and walk around in it

There has been a 3D view on the Creation Canvas for a while. It was a reading of the flat board — your cards, arranged in space, pleasant to fly around, and a view rather than a place. Nothing lived in it. You could not put a crate down.

A **world** is the other thing: an object with its own camera, its own props and real physics, that opens the way a website opens into a site preview or a game opens into a play surface.

## What authoring a world actually means

```bf-figure
{
  "kind": "flow",
  "title": "From empty scene to something you can walk",
  "steps": [
    { "label": "Place", "note": "Drop props into the scene and move them. Each one is an object on your board, with the same settings panel every other object has.", "hue": "make" },
    { "label": "Frame", "note": "Move the camera. What you set is what somebody else opens the world into.", "hue": "make" },
    { "label": "Walk", "note": "Take control of a character and move through the scene with real weight, real gravity and real collisions.", "hue": "make", "tag": "physics" }
  ],
  "caption": "Built on Three.js with a Rapier physics runtime — colliders, not the illusion of them, so a wall stops you and a ramp slows you down."
}
```

```bf-figure
{
  "kind": "screen",
  "frame": "A world open on the canvas",
  "ratio": 1.62,
  "regions": [
    { "label": "The scene", "note": "Props with colliders, a camera you move, a body the floor holds up", "x": 4, "y": 8, "w": 60, "h": 72, "hue": "make" },
    { "label": "Props", "note": "Each one an object on your board", "x": 67, "y": 8, "w": 29, "h": 34, "hue": "idea" },
    { "label": "Settings", "note": "The same panel every other object has", "x": 67, "y": 46, "w": 29, "h": 34, "hue": "accent" },
    { "label": "Play · camera · share", "x": 4, "y": 86, "w": 92, "h": 9, "hue": "accent" }
  ],
  "caption": "A world is an object like any other — which is why it inherits settings, sharing and the command bar rather than being a separate editor bolted to the side."
}
```

The distinction that matters is **colliders**. A great many browser 3D tools give you a scene you can orbit. Very few give you a body that the scene resists. The moment there is a character with mass, a floor that holds it and walls that do not, the thing you are making stops being a diagram of a space and starts being a space — and the questions change from "does this look right" to "can you get from here to there".

## Games made here now play

Two failures used to sit between "ask for a game" and "play a game", and they were unrelated to each other, which is why fixing one never seemed to help.

**The first was authoring.** Asking for a Roblox game produced a four-thousand-word design document — pillars, classes, a monetisation plan, a twelve-month roadmap — and nothing playable. The shipping half was built and the authoring half had never been connected: one tool created the object, another produced artifacts, and nothing joined them. The route to a playable build was an inspector button that only appeared once a build existed. So the button that would have made a game required a game.

**The second was recognition.** A `.rbxlx` place is XML. Everything that held a game asked "is this HTML?" to decide which runtime to use — and treated "no" as *there is no game here*. So a generated, downloadable, correctly titled Roblox place sat on the board while the play surface underneath it read **"No game yet."**

```bf-figure
{
  "kind": "compare",
  "title": "Two questions that had been collapsed into one",
  "columns": [
    { "title": "Which runtime does this use?", "hue": "make", "items": ["HTML → the web runtime", "A Roblox place → decode and walk it", "A world → the scene runtime"] },
    { "title": "Does this game exist?", "hue": "measure", "items": ["Is there an artifact at all?", "Answered by the artifact, not by its format", "A real file now answers yes"] }
  ],
  "caption": "One question wearing two hats is the most common shape of a bug that makes no sense from the outside."
}
```

A Roblox place is now playable in the browser — not by pretending to run Luau, which is a server-authoritative engine no web page is, but by reading the world back out of the file and walking it in the same Three.js and Rapier runtime the canvas already owns. Parts become props at a scale derived from the character height, so a place built in studs arrives at the size it was designed at.

And one more, reported from a live play surface: a hazard respawn loop that pinned the character at the spawn point, arrow keys dead, scoreboard reading `0/3 collected, 2076 hits`. Every hazard touch rebuilt the collision handler, which re-registered the collider, which re-fired the overlap that rebuilt the handler. The character was not failing to move; it was being teleported back every frame. It moves now.

## Why a build tool has a 3D engine in it at all

Because "make it real" does not always mean a web page.

The [eight ways to make an idea real](/blog/eight-ways-to-make-an-idea-real) run from a 90-second demo reel to a live system, and the right proof for a spatial idea — a training scenario, a floor plan somebody has to move through, a game loop that either feels good or does not — is almost never a screenshot with arrows on it. A walkable scene is a genuinely cheap proof of a thing that is otherwise impossible to argue about in a document.

The same board holds the design notes, the code, the tickets and the world. That is the whole argument: not that a canvas can do 3D, but that the 3D is next to everything else that decides whether the thing gets made.

---

**Related reading:** [Run the app your board just built](/blog/run-your-app-on-the-canvas) · [Forty-eight live objects, one Creation Canvas](/blog/forty-eight-live-objects-one-creation-canvas) · [Design, build, debug — one spatial workspace](/blog/design-build-debug-one-spatial-workspace)

[Open a canvas](/create) and ask for a world with a ramp and a locked door in it.
