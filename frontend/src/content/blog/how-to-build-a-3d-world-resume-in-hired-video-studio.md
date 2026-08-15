---
title: How to Build a 3D World Resume in the Builderforce Creation Canvas
date: 2026-05-22
description: Use the 3D World game studio in Builderforce to build an explorable, interactive resume scene with Three.js-powered objects and physics — no game-engine install required.
tags: [creation-canvas, video-resume, studio, 3d-resume, game-resume, three-js-resume]
author: Sean Hogg
---

# How to Build a 3D World Resume in the Builderforce Creation Canvas

## The Playable Resume

The boldest format the Builderforce Creation Canvas supports is a 3D World — an explorable scene a recruiter can walk through. It's overkill for an accounting role and exactly right for a game developer, a 3D artist, a technical artist, or an XR engineer who needs to prove they can ship interactive 3D.

Under the hood, the 3D World studio is a `mediaKind: "game"` document with an `engine: "world-3d"` discriminator, built on Three.js and React Three Fiber with a Rapier physics layer. You place objects, wire up interactions, and the result runs in any modern browser — no Unity or Unreal install, no plugin.

## Step 1: Create a 3D World Document

Open [Studio](/creation-canvas), create a new document, and choose the **3D World** game type. The editor loads a 3D viewport, an object palette, and an inspector. (The older 2D game templates still exist — they're now badged "Mini-game" — but a 3D World is the full scene-based engine.)

Start with a simple ground plane and a spawn point. Resist the urge to build a whole level. The goal is a short, guided walk that tells your story, not an open-world game.

## Step 2: Place Objects and Add Physics

Drag objects from the palette into the scene: platforms, props, text panels, and trigger zones. Each object has a transform (position, rotation, scale) you set in the inspector. Add a Rapier physics body to objects that should collide or fall — the engine handles the simulation so a dropped prop lands on the floor without you writing a physics loop.

Use text panels as the narrative spine: a panel at the entrance with your name and headline, panels along the path describing each project, a panel at the end with what you're looking for. The player reads the resume by moving through it.

## Step 3: Wire Interactions

Trigger zones turn the scene from a diorama into an experience. Attach an interaction to a zone so that stepping into it reveals a project panel, plays a sound, or advances the camera. Keep interactions discoverable — a recruiter exploring your world for the first time shouldn't have to guess a hidden mechanic to see your work.

A good pattern: a linear path with optional side rooms. The main path tells your core story in 60–90 seconds of walking; the side rooms hold deep-dive panels for recruiters who want more.

## Step 4: Publish and Share the Link

A 3D World publishes as a playable, link-shareable experience that runs in the browser. Because Studio runs cross-origin-isolated for its runtime, the scene loads with its assets self-hosted and plays without a download.

Share the link in your application, on your profile, or in a Creator post. For interactive-3D roles, a playable world is the portfolio piece — it proves, in the most direct way possible, that you can ship the exact thing the job is asking for.

## Frequently Asked Questions

### Do I need to know how to code to build a 3D World?

No. You place objects, set transforms in the inspector, and wire interactions through trigger zones — all visually. Coding knowledge lets you push further, but the core build is a drag-place-and-configure workflow.

### What's the difference between a 3D World and a Mini-game?

A 3D World is a full scene-based engine — `mediaKind: "game"` with the `world-3d` engine — built on Three.js, React Three Fiber, and Rapier physics. The 2D game templates are now badged "Mini-game" and are simpler, sprite-based experiences. For a resume scene a recruiter explores in 3D, use the 3D World.

### Does a recruiter need to install anything to view it?

No. The world runs in any modern browser via WebGL. You share a link; they click and explore. No game engine, no plugin, no download.

---

**Try it:** [Studio](/creation-canvas) on Builderforce.
