---
title: See why visitors leave — not just that they left
date: 2026-10-11
description: Analytics told you they bounced. Session replay shows the page they saw, the click that went nowhere, and the recording of the people who did not convert — which is what grades a proof, not a dashboard.
tags: [methodology, idea-to-real, validation, product-strategy, metrics]
author: Sean Hogg
---

# See why visitors leave — not just that they left

A dashboard can tell you that people left. It cannot tell you why. Bounce rate, time-on-page, a funnel that drops between step two and step three — those are counts. They are silent on the heading that looked like a link, the button that did not fire, the form that ate the first attempt, the moment someone rage-clicked and closed the tab.

That silence is expensive. Teams argue from memory about a visit nobody watched. They ship a fix for the wrong thing. They grade a proof on a number that never asked whether the sample was actually reached, or whether the people who did not convert saw a broken page.

Session replay closes that gap. You watch the visit the way the visitor saw it.

## The visit, on the page they saw

Insights now has a Visitors reading that plays the session: the page, the cursor, the click that went nowhere. One visit is tagged with the release they were on. Rage clicks, dead clicks, errors and the conversion (or the miss) sit on the timeline so you can seek them, not scrub for them.

```bf-figure
{
  "kind": "screen",
  "frame": "BuilderForce — Visitors",
  "ratio": 1.5,
  "regions": [
    { "label": "Recordings", "note": "One visit, tagged with the release it ran on", "x": 4, "y": 6, "w": 36, "h": 88, "hue": "measure" },
    { "label": "The page they saw", "note": "Replay plays the Room, the form, the click that went nowhere", "x": 42, "y": 6, "w": 54, "h": 58, "hue": "accent" },
    { "label": "Moments", "note": "Rage click · dead click · error · conversion", "x": 42, "y": 68, "w": 54, "h": 26, "hue": "run" }
  ],
  "caption": "The recording is the visit. Counts sit beside it so you can find the moment, then watch it."
}
```

Inputs stay masked. API keys stay blocked. A signed-in visit on builderforce.ai and the anonymous one that preceded it are the same recording.

## From a recording to the next change

Watching is not the point. The point is what you do with the moment.

```bf-figure
{
  "kind": "flow",
  "title": "From a live site to the next ticket",
  "steps": [
    { "label": "Run", "note": "The hosted app or the snippet on your own origin records the visit.", "hue": "run" },
    { "label": "Record", "note": "Chunks land within seconds. Frustration, errors and conversions are marked as they happen.", "hue": "measure" },
    { "label": "Watch", "note": "Open the recording. Seek the rage click. See the page they actually saw.", "hue": "measure", "tag": "the visit" },
    { "label": "Ticket", "note": "A moment becomes a task, with the recording attached, so the fix is for that click.", "hue": "idea" },
    { "label": "Make", "note": "The next release carries the change. Heatmaps and recordings on that release tell you whether it worked.", "hue": "make" }
  ],
  "caption": "The loop is the product. A recording that does not become a ticket is a video you watched once."
}
```

## One release against the next

A heatmap without a release is an average of every page you ever shipped. That is how a broken heading from last week hides inside a healthy-looking click map.

```bf-figure
{
  "kind": "compare",
  "title": "The same page, two releases",
  "columns": [
    { "title": "This release", "hue": "muted", "items": ["Rage on the heading that looks like a link", "Dead clicks on a button that never fired", "Scroll that never reached the form"] },
    { "title": "The next release", "hue": "measure", "items": ["The heading is a heading", "The button submits", "The form is in view — and people use it"] }
  ],
  "caption": "Compare heatmaps by release, not by URL. The URL did not change. The page did."
}
```

## Where it sits in the method

**Measure** is where a proof's kill condition is graded. Replay is what grades it: a sample that was actually reached, a success event visitors actually triggered, and recordings of the visitors who did not convert.

That evidence goes back to **Idea** — read again with what you learned — and on to **Make**: a ticket from the moment, whose effect you measure on the next release.

[Read, Prove, Build](/blog/read-prove-build-the-inner-loop) is the inner loop. [Grade the proof](/blog/grade-the-proof-and-close-the-loop) is where the number gets written down. Replay is how that number stops being a dashboard and starts being a visit you can watch.

```bf-figure
{
  "kind": "flow",
  "title": "The loop, graded by the visit",
  "steps": [
    { "label": "Prove", "note": "A kill condition, a sample size, a success event. Cheap on purpose.", "hue": "idea" },
    { "label": "Build", "note": "The smallest thing that can be reached.", "hue": "make" },
    { "label": "Run", "note": "A live origin, a release token, a snippet or a hosted app.", "hue": "run" },
    { "label": "Measure", "note": "Replay grades the proof: sample reached, event fired, recordings of who did not convert.", "hue": "measure", "tag": "graded by replay" },
    { "label": "Idea", "note": "Read again with what the visits showed. The next Make starts from a moment, not a guess.", "hue": "idea" }
  ],
  "caption": "Idea → Make → Run → Measure is the arc. Replay is the grade on Measure, not a separate product next to it."
}
```

Install Insights, drop a snippet on your site, or turn recording on for a hosted app. The first visit lands within seconds. The method itself is [the menu](/blog/idea-make-run-measure-menu-as-methodology).

---

**Related reading:** [Grade the proof](/blog/grade-the-proof-and-close-the-loop) · [Read, Prove, Build](/blog/read-prove-build-the-inner-loop) · [Idea, Make, Run, Measure](/blog/idea-make-run-measure-menu-as-methodology)

[Open a canvas](/create) and watch the next visit.
