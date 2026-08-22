---
title: Grade the proof — how a kill condition turns a launch into a decision
date: 2026-08-22
description: Most teams record what they built and never what they learned. A proof now carries a verdict — met, missed or abandoned — with the number that decided it, which is what turns Idea to Real from a line into a loop.
tags: [methodology, idea-to-real, validation, product-strategy, metrics]
author: Sean Hogg
---

# Grade the proof — how a kill condition turns a launch into a decision

Ask a team what they shipped last quarter and you will get a list. Ask what they learned and you will get a story, told from memory, by whoever is in the room. The list is written down somewhere. The learning almost never is.

That asymmetry is not laziness. It is what happens when a tool records artifacts and nothing records answers. Every project management system in existence can tell you that a thing was delivered. Very few can tell you whether it worked, and almost none can tell you what number you agreed in advance would decide it.

## A proof without a kill condition is a launch with extra steps

[Idea to Real](/blog/idea-to-real-the-operating-methodology) has three acts — Read, Prove, Build — and the middle one is the opinion. Reading an idea is cheap. Building is not. Choosing which proof is worth running is the most consequential decision in the first month of anything, and [eight ways to make it real](/blog/eight-ways-to-make-an-idea-real) exist precisely so that choice is a choice rather than a default.

```bf-figure
{
  "kind": "bars",
  "title": "The eight proofs, by what they cost to run",
  "max": 5,
  "rows": [
    { "label": "Demo video", "value": 1, "note": "an afternoon", "hue": "prove" },
    { "label": "Clickable prototype", "value": 2, "note": "days", "hue": "prove" },
    { "label": "Smoke test", "value": 2, "note": "days · publishes an address", "hue": "prove" },
    { "label": "Wizard of Oz", "value": 2, "note": "days · a human behind the curtain", "hue": "prove" },
    { "label": "Phone line", "value": 3, "note": "a week · a real number people call", "hue": "build" },
    { "label": "Proof of concept", "value": 3, "note": "a week", "hue": "build" },
    { "label": "Pilot", "value": 4, "note": "weeks · real users, real stakes", "hue": "build" },
    { "label": "Live system", "value": 5, "note": "weeks of real engineering", "hue": "build" }
  ],
  "caption": "Every option is always offered — this is advice about what to run FIRST, not a filter. Hiding one would make it a verdict instead of a recommendation."
}
```

Each of those eight carries success criteria you set *before* you build: 25 signups from 500 visitors, a 90% pass rate over 20 trials, four of five pilot users completing the task unaided. That number is the kill condition — the result that would stop the project.

```bf-figure
{
  "kind": "flow",
  "title": "Where the number is set, and where it is graded",
  "steps": [
    { "label": "Prove", "note": "Pick the proof. Write the criteria: the number that would make you stop. Costs nothing, builds nothing.", "hue": "prove", "tag": "sets the condition" },
    { "label": "Build", "note": "Run the proof. A smoke test, a Wizard of Oz trial, a phone line, a pilot — whatever the criteria actually needed.", "hue": "build", "tag": "spends" },
    { "label": "Measure", "note": "Grade it. Met, missed or abandoned, with the number that decided it and the date you called it.", "hue": "measure", "tag": "closes the loop" }
  ],
  "caption": "The condition and the grade live at opposite ends of the loop on purpose. A criterion written after the result is not a criterion, it is a caption."
}
```

Until recently, Builderforce did the first two well and simply dropped the third. A realization recorded what was built — the files, the tickets, the live URL — and nothing else. The consoles that ran the proof knew the answer: the smoke test's demand console counted the signups, the proof-of-concept harness judged every trial. Both computed a verdict, showed it on screen, and threw it away on refresh.

So the platform could say *you ran a smoke test*. It could never say *it failed and you built the thing anyway*.

## What a verdict is

A proof now records three things, and the shape of them matters more than the fact that they exist.

- **The verdict** — `met`, `missed` or `abandoned`. Three values, not two. A proof nobody finished is a different fact from a proof that failed, and collapsing them flatters the record: teams abandon far more experiments than they fail, and only one of those two is evidence about the idea.
- **The metric that decided it** — read off the console that measured it, never retyped. A number a person types in after the fact is a number that agrees with whatever they now believe.
- **The date it was decided** — kept separate from when the record was last touched, so rebuilding the proof next month cannot quietly move when you made the call.

Recording it is one button, and it only appears once the console reaches a state that can decide: the count crosses the threshold, or every trial has been judged. A "record verdict" button available at any time is an invitation to grade a proof that has not finished.

## Why this is the number we hold ourselves to

Every platform has a headline metric. Most of them measure activity: projects created, agents run, tokens spent. Those numbers go up when the product is used, whether or not the user got anything out of it.

Ours is the share of ideas that reach a **graded proof** — a build whose kill condition was actually measured, not merely a deliverable that was produced.

```bf-figure
{
  "kind": "compare",
  "title": "Two ways to report the same quarter",
  "columns": [
    { "title": "What most tools count", "hue": "muted", "items": ["Projects created", "Things deployed", "Tickets closed", "Hours of agent time", "All of which rise when nothing is learned"] },
    { "title": "What the method counts", "hue": "measure", "items": ["Proofs run against stated criteria", "Verdicts recorded with their number", "Ideas killed early, on evidence", "Ideas continued, on evidence", "Which can fall when the product is used badly"] }
  ],
  "caption": "A metric that cannot go down when things go badly is not a metric, it is a scoreboard."
}
```

It is a deliberately uncomfortable number. It falls when people build without proving, which is exactly when we want to see it fall.

## The loop, in practice

Here is what this changes about a Monday.

You paste a brief. It comes back as a specification — what the thing has to do, which capabilities it names, what limits the brief itself set. Eight proofs are ranked against it, cheapest first, and the recommendation says *why* this one answers the question the brief is really asking. You pick one, write the number that would stop you, and build it. It publishes at an address you can send to somebody.

Two weeks later the console says 9 signups from 512 visitors against a threshold of 25. You press record. The verdict is `missed`, the metric is stored beside it, and the date is today.

And then the useful part: that answer goes back to Idea. Not as a feeling that "the landing page thing didn't really work", but as a row you can put on a board next to the next version of the idea, and next to the four other things you tried that quarter.

A proof with no condition that could fail is a launch with extra steps. A proof with a condition nobody grades is a launch with extra paperwork. The third act is what makes the first two worth doing.

---

**Related reading:** [Idea to Real — the operating methodology](/blog/idea-to-real-the-operating-methodology) · [Eight ways to make an idea real](/blog/eight-ways-to-make-an-idea-real) · [Read, Prove, Build — the inner loop](/blog/read-prove-build-the-inner-loop)

Start where the method starts: [open a canvas](/create) and paste the idea you have been arguing about.
