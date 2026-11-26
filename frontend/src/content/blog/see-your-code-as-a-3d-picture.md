---
title: See your code as a 3D picture, with the code beside it
date: 2026-11-26
description: The knowledge view now puts the code and a 3D picture of the system side by side at one shared location. Click a shape to read its code, click a method to fly into it, and preview a restructure before anyone changes a line.
tags: [knowledge-view, code-understanding, visualization, refactoring, idea-to-real, product]
author: Sean Hogg
---

# See your code as a 3D picture, with the code beside it

Most people who depend on software cannot read it. Product managers, founders, auditors and new hires still have to answer questions about it: how big is this part, what depends on it, is it safe to change. The usual answer is to ask the one engineer who knows, and wait.

So **the knowledge view now shows the code and a 3D picture of the system side by side, and moving in either one moves both.**

## One location, two views

The code sits on the left and the picture sits on the right. They share a single location, which runs from the whole system down through a component, a class and a method to a line.

```bf-figure
{
  "kind": "screen",
  "frame": "The knowledge view",
  "ratio": 1.62,
  "regions": [
    { "label": "Code", "note": "Classes and methods, with lenses above them", "x": 3, "y": 8, "w": 44, "h": 78, "hue": "read" },
    { "label": "3D picture", "note": "Shapes for the same system, at the same place", "x": 50, "y": 8, "w": 47, "h": 78, "hue": "make" },
    { "label": "system > component > class > method > line", "x": 3, "y": 89, "w": 94, "h": 8, "hue": "accent" }
  ],
  "caption": "One location, shown twice. Where you are in the code is where the picture is looking, and the other way round."
}
```

- **Click a shape and its code opens** on the left.
- **Click a class or method in the code and the picture drills in** to that spot.
- **Zoom into a shape and it opens up.** A component becomes its classes, a class becomes its methods, and a method becomes its code. You never have to know which file you are in.

If you cannot read code, you can still see it through shapes: what is large, what is tangled, what connects to what. If you can read it, you no longer have to hold the map in your head.

## Lenses above the code

Above each class and method there is a row of small actions:

- **Go inside** and **out**, to move down or up a level.
- **Callers**, to see what depends on this.
- **No test · Simulate**, shown when nothing covers this path. It opens the path simulator so you can run the path and see what happens.
- **Restructure**, shown on anti-patterns. A warning glyph in the gutter marks the same code, so you can find it by scrolling.

## Flow and Sequence, at every level

Each level has a **Flow** view and a **Sequence** view: how data moves, and in what order things call each other. They work for the system, a component, a class and a method. One switch moves any of them between 3D and Flat, so you can pick the one that is easier to read for a given question.

## Before and After

An anti-pattern is easier to judge as a picture than as a description. Take a god module that has absorbed everything, or a layer violation where the wrong part reaches into another.

```bf-figure
{
  "kind": "compare",
  "title": "Previewing a restructure",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["One large file holding several jobs", "Edges crossing layers they should not cross", "Hard to say where a change will land"] },
    { "title": "After (proposed)", "hue": "make", "items": ["New modules grow out of the old file", "Edges re-route through the right layer", "New, changed and removed are coloured apart"] }
  ],
  "caption": "The proposal is a preview. Nothing in your code changes until you apply it."
}
```

Switch to **After** and new modules grow out of the old file while the edges re-route. Colour separates what is new, what changed and what is removed. You can judge the shape of the change before reading any of the diff.

You can also pick **a commit from history**. The map shows what that commit changed, and the code shows which lines.

Proposals are previews. Applying one goes through the normal reviewed fix flow, so a person still approves the change, and it is checked like any other.

## Where it sits in the method

Builderforce works as **Read, Prove, Build** inside the arc of Idea, Make, Run, Measure. Read and Prove are the cheap acts, and they decide whether Build is worth doing. This feature belongs to **Read and Prove, in Idea**.

It was needed there because reading existing code is the slow part of that stage. If you inherit a system, or have to judge a change to one, the only way in used to be a file tree and an afternoon. Now you can read the shape of it in minutes. The restructure preview is a proof in the same sense: you see what a change would do, with a kill condition you can check (does this proposal actually remove the violation?), before you spend any build effort on it. What you decide to build goes on to [Make](/blog/read-prove-build-the-inner-loop), and a commit you can compare against history is how Measure later shows what it did.

---

**Related reading:** [Read, Prove, Build: the inner loop](/blog/read-prove-build-the-inner-loop) · [Design, build, debug: one spatial workspace](/blog/design-build-debug-one-spatial-workspace) · [Build a 3D world in the browser](/blog/build-a-3d-world-in-the-browser)

[Open a canvas](/create), switch to the knowledge surface on a project and click a shape.
