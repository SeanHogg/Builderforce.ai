---
title: Watch your codebase review run — and keep your map when the server is gone
date: 2026-11-07
description: Reviewing a folder used to be a spinner you could not see into, and the knowledge map disappeared without the server. Now the map lives on your machine, and every review is a run you can open, watch, retry and look back on.
tags: [knowledge-map, vscode, offline, observability, product]
author: Sean Hogg
---

# Watch your codebase review run — and keep your map when the server is gone

You click Review on a folder. A spinner appears. Somewhere, files are being read, summarised and judged, and you have no way to tell whether it is on file 12 of 40 or stuck on file 3. If it fails, you learn that at the end, and the only remedy is to start over.

And the map itself had a second weakness. It was drawn from the server's copy, so the moment you signed out, hit a rate limit or lost the connection, the map you had just built went blank.

That is the gap: **a review was a spinner you could not see into, and the map vanished without the server.**

## The map is yours, and it works offline

The knowledge map is now drawn from the copy on your own machine, whether or not the workspace is linked. The server is a replica, kept in step by a background queue that survives a sign-out, a rate limit or a crash and simply picks up where it left off. A folder the server has but this machine does not is still drawn, read-only, so you can see it is there without pretending you hold it.

```bf-figure
{
  "kind": "flow",
  "title": "Where the map comes from now",
  "steps": [
    { "label": "Your machine", "note": "The map is read from the local copy, linked or not. Sign out, go offline, hit a limit: it still opens.", "hue": "make" },
    { "label": "Background queue", "note": "Changes wait in a queue that survives a crash and retries by itself.", "hue": "run" },
    { "label": "The server replica", "note": "Catches up when it can. A folder only the server has is drawn read-only.", "hue": "measure", "tag": "a copy, not the source" }
  ],
  "caption": "The direction of truth changed: the local copy is read first, and the server follows."
}
```

## Every review is a run you can open

Review and Re-review now open a Run panel, titled Run details. It answers the questions the spinner never could.

```bf-figure
{
  "kind": "screen",
  "frame": "Run details for a folder review",
  "ratio": 1.62,
  "regions": [
    { "label": "Phase timeline", "note": "Plan, extract, judge, finish: where the run is right now", "x": 4, "y": 6, "w": 92, "h": 14, "hue": "run" },
    { "label": "Worker lanes", "note": "Which files each thread is working on at this moment", "x": 4, "y": 24, "w": 44, "h": 40, "hue": "make" },
    { "label": "Steps", "note": "The ordered list, done and still to come", "x": 52, "y": 24, "w": 44, "h": 40, "hue": "idea" },
    { "label": "Failures · Retry", "note": "What went wrong, with a Retry beside it", "x": 4, "y": 68, "w": 44, "h": 26, "hue": "measure" },
    { "label": "Run history", "note": "The last 20 runs for this folder; a crash shows as interrupted", "x": 52, "y": 68, "w": 44, "h": 26, "hue": "accent" }
  ],
  "caption": "One panel for the whole run: where it is, who is doing what, what failed and what happened the last twenty times."
}
```

**Retry is not a shortcut around the rules.** It marks the failed files as owed and sends them through the normal plan, estimate and confirm. You see what the retry will cost before it spends anything, exactly as you did the first time.

**History tells the truth about crashes.** Each folder keeps its last 20 runs. A run that was cut short by a crash is labelled interrupted rather than silently missing, so you know it did not finish and can pick it up.

## Faster, without hammering your provider

Reading the files now spreads across several worker threads on your machine, up to eight, and never more than your cores minus one, so the editor stays responsive. Judging runs four files at a time. All of those calls share one limiter: at most six model calls in flight, and the limit halves whenever a provider says slow down. Parallelism therefore never multiplies the load on the provider; it fills the room the limit allows.

The results are identical to a serial run. The same files come out judged the same way, only sooner.

## Where it sits in the method

This is **Run**, with a foot in **Measure**. A review is the codebase doing its work, and a run you can watch is a run you can trust and tune. The history and the failures it keeps are the first measurements of how well that work is going, and they feed the next idea about what to fix or re-review.

```bf-figure
{
  "kind": "compare",
  "title": "A review, before and after",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["A spinner with nothing behind it", "Failure known only at the end", "Start over to recover", "Map blank when the server is unreachable"] },
    { "title": "Now", "hue": "run", "items": ["A phase timeline and worker lanes", "Failures listed, each with Retry", "Retry goes through plan, estimate, confirm", "Map opens from your machine, linked or not"] }
  ],
  "caption": "The same review, with the inside of it visible and the map no longer hostage to a connection."
}
```

## What you can do with it today

- **Open the map with no connection**, signed in or not, linked or not.
- **Watch a review** and see which files each worker is on.
- **Retry only what failed**, after seeing the estimate.
- **Look back** over the last 20 runs of any folder.

---

**Related reading:** [Run the app your board just built](/blog/run-your-app-on-the-canvas) · [Your private Evermind on your machine](/blog/your-private-evermind-on-your-machine)
