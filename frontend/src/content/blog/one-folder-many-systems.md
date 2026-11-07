---
title: One folder, many systems — each on its own map, with stray copies called out
date: 2026-11-07
description: A big folder used to read as one tangled system, and stray copies polluted the map. Now every system in a monorepo or a workspace of many repos is its own system, and duplicated trees are found and offered as a one-click Exclude.
tags: [knowledge-map, monorepo, vscode, product]
author: Sean Hogg
---

# One folder, many systems — each on its own map, with stray copies called out

You point a review at the folder where you keep your work. It holds five repositories, and two loose copies of one of them that someone made for a test and never deleted. You expect a map of five systems.

You got one system. Every line on it was named after whatever came first, most of them stopped after a single station, and the copies were counted as if they were real code, so the same problems showed up three times. On the biggest folders, most files were never read at all, because the review stopped after a fixed number.

That is the gap: **a big folder read as one tangled system, and stray copies polluted the map.**

## Each system is its own system

The review now looks at what is in the folder and divides it up. A child folder that is its own repository is a system. A folder with a project manifest is a system. Inside a system, its workspace packages are the apps it is made of. A folder that is itself one repository is simply one system, as before.

```bf-figure
{
  "kind": "compare",
  "title": "The same folder, before and after",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["Five repos and two copies read as one project", "Lines named after the copies", "Every line stopping after one station", "Problems counted again for each copy", "Most files never read on a big folder"] },
    { "title": "Now", "hue": "make", "items": ["Each repo is its own system", "Lines grouped by system, named system and package", "Every line says where it stops, and why", "Problems counted within a system, never across", "No cap on files: the whole folder is mapped"] }
  ],
  "caption": "Nothing about your folder changed. The map simply stopped pretending it was one thing."
}
```

Lines are grouped by system, and shared out fairly, so one large system cannot crowd the others off the map. The header starts at the system you are in. When the folder holds more than one system, the System view shows one tier for each.

## Stray copies are found, not guessed at

When two systems carry the same project and their files match almost entirely, the review treats it as a copy. It tells you which folder looks like the stray, usually the one without a repository behind it, and why. Until you decide, the copy stays on the map, marked as a copy, with its lines folded under the original so it does not double the noise.

You decide, with one click.

```bf-figure
{
  "kind": "flow",
  "title": "From a cluttered folder to a clean map",
  "steps": [
    { "label": "Review", "note": "Point it at the folder. Each system is found and drawn on its own.", "hue": "idea" },
    { "label": "Detect strays", "note": "A vendored or duplicated tree is flagged as a copy, with the reason it looks like one.", "hue": "make" },
    { "label": "Exclude", "note": "One click adds the folder to your ignore list and starts a re-review with the usual estimate and confirm.", "hue": "run", "tag": "your call" },
    { "label": "Clean map", "note": "Only the real code is left, grouped by system.", "hue": "measure" }
  ],
  "caption": "The review finds the problem and offers the fix. It never changes your folder behind your back, and you never have to edit an ignore file by hand."
}
```

**Exclude is a normal re-review.** It goes through the same plan, estimate and confirm as any other, so you see what it will cost before it spends anything, and afterwards the copy is gone from the map.

## No cap, and nothing dropped quietly

A big folder is read in full. The only limit left is the size of a single file, and every file that is skipped is counted and named in the diagnostics, so a gap in the map is something you can read rather than something you have to suspect. A system that was cut short says so.

References between systems are shown as external, not as a layering mistake. A service that calls another repository is no longer reported as breaking its own architecture.

```bf-figure
{
  "kind": "screen",
  "frame": "Reviewing a folder of many systems",
  "ratio": 1.62,
  "regions": [
    { "label": "Systems", "note": "One tier per system when the folder holds more than one", "x": 4, "y": 8, "w": 56, "h": 52, "hue": "make" },
    { "label": "Lines by system", "note": "Grouped by system, named system and package, each with its stopping reason", "x": 64, "y": 8, "w": 32, "h": 52, "hue": "idea" },
    { "label": "Copy found · Exclude from review", "note": "The stray folder, why it looks like a copy, and the button", "x": 4, "y": 64, "w": 56, "h": 30, "hue": "run" },
    { "label": "Diagnostics", "note": "Systems, copies, skipped files, where each line stops", "x": 64, "y": 64, "w": 32, "h": 30, "hue": "measure" }
  ],
  "caption": "What a workspace of many repos looks like now: the systems, the copy and the way to remove it on one screen."
}
```

## Where it sits in the method

This is the **Read** step: understanding what you have before you build. The method runs Read, Prove, Build, and the arc around it runs Idea, Make, Run, Measure. A map that merges five systems into one, or counts a stray copy as real code, gives you a wrong picture to decide from, and every later step inherits the mistake. Reading each system as itself, and clearing the copies out of the way, means the decision to build rests on what is actually there.

## What you can do with it today

- **Review a workspace of many repos** and see each as its own system.
- **Read a monorepo by package**, with lines grouped under the system they belong to.
- **Spot stray copies** and remove them from the map with one click, after the usual estimate.
- **Trust the size of the map**, because no file is dropped for being the many-thousandth.

---

**Related reading:** [Watch your codebase review run](/blog/watch-your-codebase-review-run) · [Run the app your board just built](/blog/run-your-app-on-the-canvas)
