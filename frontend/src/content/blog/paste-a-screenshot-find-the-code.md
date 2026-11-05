---
title: Paste a screenshot, find the code behind it
date: 2026-11-05
description: You can see the symptom on screen and still have no idea where it lives in the code. Paste the screenshot into the knowledge view and it narrows a codebase to the files behind what is showing, then hands the path to the agent. A transit map of your system replaces the graph of thousands of dots.
tags: [knowledge-graph, code-quality, debugging, idea-to-real, agents, product]
author: Sean Hogg
---

# Paste a screenshot, find the code behind it

A review is stuck on "Judging". You can see it. You can screenshot it. And you have no idea which of four thousand files is responsible.

That is the gap. The symptom lives on a screen and the cause lives in a codebase, and nothing joins them except whoever happens to remember. So people reach for a graph, and the graph draws every file as a dot, and the dots tell you nothing. A picture of thousands of nodes is not an answer to "where does this go?". It is the same wall of files with a nicer background.

## One map, drawn like a transit network

The knowledge view now shows a codebase the way a city shows its trains: **lines**. Each line starts at an entry point, a route or a screen or a job, runs through the layers it passes, and ends at the stores and external services it touches. You read a path instead of a pile.

```bf-figure
{
  "kind": "screen",
  "frame": "The knowledge view, as a map",
  "ratio": 1.62,
  "regions": [
    { "label": "Ask bar", "note": "Type a question, or paste a screenshot", "x": 4, "y": 6, "w": 92, "h": 9, "hue": "idea" },
    { "label": "Lines from each entry point", "note": "Entry points, through the layers, to stores and outside services", "x": 4, "y": 19, "w": 62, "h": 60, "hue": "make" },
    { "label": "What this shows", "note": "The findings on the path you selected", "x": 69, "y": 19, "w": 27, "h": 60, "hue": "measure" },
    { "label": "Views", "note": "Map, System, Graph, Mind map, Tower 3D, Heat, List, Sequence", "x": 4, "y": 84, "w": 46, "h": 10, "hue": "accent" },
    { "label": "Overlays", "note": "Any measure can drive colour, size, ring, line width or pulse", "x": 53, "y": 84, "w": 43, "h": 10, "hue": "accent" }
  ],
  "caption": "One surface. The same codebase can be read as a map, an N-tier system, a graph, a mind map, a 3D tower, a heat map, a list or a sequence, without starting over."
}
```

You can ask questions instead of picking lenses. **Where does it go?** **What is wrong?** **What has no test?** **What patterns are here?** **What changed?** Each question sets the view and the overlay for you, so the answer is the first thing on screen.

## Paste the screenshot

This is the part that changes the afternoon. Drop the screenshot into the ask bar. A vision model reads the text that is visible in it. Then plain search takes over: it matches that text against your translation catalogs and your source, finds the files, and goes one import further. The view filters down to the code behind what you saw.

```bf-figure
{
  "kind": "flow",
  "title": "From a stuck screen to the files behind it",
  "steps": [
    { "label": "Paste", "note": "A screenshot of the review stuck on Judging goes into the ask bar.", "hue": "idea" },
    { "label": "Read", "note": "A vision model reads the words that are visible. Nothing else is guessed.", "hue": "idea" },
    { "label": "Match", "note": "Search maps those words through the translation catalogs and the source to files, and one import hop further.", "hue": "make" },
    { "label": "Label", "note": "Every match says how it was found: exact, catalog or import.", "hue": "make", "tag": "you can judge it" },
    { "label": "Diagnose", "note": "Hand the path and its findings to the agent, which works with its own tools.", "hue": "run" }
  ],
  "caption": "The matching is deterministic search, not a model's opinion. The model only reads the pixels, and each match tells you why it is on the list."
}
```

That labelling is the point. An **exact** match is the string itself found in the code. A **catalog** match came through the translation files, the usual way a word on screen is not a word in the source. An **import** match is a neighbour, one hop away. You can tell a certain match from a plausible one before you spend a minute on it.

Then **Diagnose with the agent** passes the path and everything the map already knows about it. The agent does not start from a blank page and a search box.

## See what is wrong, not just what is there

Overlays turn a metric into a visual channel, and any metric can drive any channel.

```bf-figure
{
  "kind": "compare",
  "title": "A graph of dots, and a map you can act on",
  "columns": [
    { "title": "A graph of everything", "hue": "muted", "items": ["Thousands of nodes", "Colour means whatever the legend says this week", "Tells you the shape, not the problem", "You still search the files by hand"] },
    { "title": "The map", "hue": "make", "items": ["A line per entry point, so you read a path", "Anti-patterns, complexity, coverage, usage, churn, what changed and owner, each as colour, size, ring, line width or pulse", "Questions that set the view for you", "A screenshot that narrows it to the code behind a symptom"] }
  ],
  "caption": "Same codebase. The difference is whether the picture answers a question or only proves that the codebase is big."
}
```

Around the map sit the panels you reach for next:

- **Sync** shows what is on your machine against what the server has, and which files were skipped and why, so a gap in the map is never a mystery.
- **Coverage** shows what has no test.
- **Patterns** lists the anti-patterns in the code and where they cluster.
- **API** turns your routes into an OpenAPI skeleton or a Postman export.
- **Fix queue** applies a deterministic fix for unused code, and otherwise writes a prompt for the agent.
- **Simulate** has the agent write and run a test that drives a path with values you choose, so "does this really go there?" gets a real answer.

## Where it sits in the method

[Idea to Real](/blog/idea-to-real-the-operating-methodology) runs from Idea through Make, Run and Measure. This capability is about the acts that decide whether to spend, and the one that spends.

**It makes Read work on code you already have.** [Read](/blog/read-prove-build-the-inner-loop) asks what is actually there, and it is meant to be free. For a running system, "what is actually there" used to mean hours in the files. The map and the question bar make it a few minutes, with no agent spend until you choose it.

**It makes Build cheaper by narrowing it.** Build is the act that costs, and a build aimed at the wrong files is the most expensive kind. A screenshot that lands the agent on the right path, with the findings attached, means the money goes to the change and not to the search for where the change belongs.

**It also helps Run and Measure.** In Run, a symptom on a live screen becomes a path. In Measure, the same overlays show what changed and what has no test, so you see where the system moved, not just that it did.

## What you can do with it today

- **Paste a screenshot of a bug** and see the files behind it, each labelled by how it was found.
- **Ask where a request goes**, from its entry point through the layers to the stores and services at the end.
- **Ask what is wrong, what has no test and what changed**, and get the view that answers it.
- **Switch between eight views** of the same codebase without losing your place.
- **Export your API** as an OpenAPI skeleton or a Postman collection from the routes it already found.
- **Clear out unused code** with a deterministic fix, and hand everything else to the agent as a ready prompt.
- **Simulate a path** with your own values before you trust it.

---

**Related reading:** [Point it at a folder and see what it knows](/blog/point-it-at-a-folder-and-see-what-it-knows) · [Read, Prove, Build: the inner loop](/blog/read-prove-build-the-inner-loop) · [Quality, errors and one-click fixes](/blog/quality-error-observability-one-click-fix)

[Open a canvas](/create), point it at a folder, and paste the screenshot you have been staring at.
