---
title: Eight ways to make an idea real — and how to pick one
date: 2026-08-14
description: A demo video, a clickable prototype, a smoke test, a Wizard of Oz, a proof of concept, a pilot, a phone line, or the whole system running. Each answers a different question and costs a different amount. Here is the map.
tags: [methodology, validation, proof-of-concept, product-strategy]
author: Sean Hogg
---

# Eight ways to make an idea real — and how to pick one

"Make it real" is not one thing. It is at least eight, they differ enormously in fidelity and in cost, and choosing between them badly is the most expensive mistake available in the first month of a project.

Most tooling offers exactly one answer: build the system. That is the most expensive proof there is, and for most of the questions a business actually has it is the wrong one. "Can you show me?" does not need a running system. "Does anyone want this?" is answered by a landing page and a number — and answering it with a built system is how six weeks get spent on something nobody asked for.

So here are the eight, what each one answers, and where each sits on the two axes that matter.

## The map

```bf-figure
{
  "kind": "matrix",
  "title": "Fidelity against effort",
  "xLabel": "Effort  ·  1 = an afternoon,  5 = weeks",
  "yLabel": "Fidelity  ·  1 = a sketch,  5 = the thing itself",
  "max": 5,
  "points": [
    { "label": "Demo video", "x": 1, "y": 1, "hue": "read", "dx": 10, "dy": -12 },
    { "label": "Clickable prototype", "x": 2, "y": 2, "hue": "read", "dx": -12, "dy": 20 },
    { "label": "Smoke test", "x": 2, "y": 2, "hue": "prove", "dx": 12, "dy": -12 },
    { "label": "Wizard of Oz", "x": 2, "y": 3, "hue": "prove", "dx": 12, "dy": -10 },
    { "label": "Proof of concept", "x": 3, "y": 3, "hue": "prove", "dx": 12, "dy": 18 },
    { "label": "Phone line", "x": 3, "y": 4, "hue": "build", "dx": 12, "dy": -12 },
    { "label": "Pilot", "x": 4, "y": 4, "hue": "build", "dx": 12, "dy": 20 },
    { "label": "Live system", "x": 5, "y": 5, "hue": "make", "dx": -12, "dy": -14 }
  ],
  "caption": "The clickable prototype and the smoke test genuinely sit on the same coordinates — same fidelity, same effort — and their labels lean apart so both stay readable. They cost the same and answer completely different questions, which is exactly the point: cost does not tell you which proof to run, only which ones you can afford to be wrong about."
}
```

Read the bottom-left as a rule of thumb, not a ranking. Nothing down there is a lesser proof; it is a cheaper answer to a narrower question. A demo video is never *wrong* to make.

## The eight, and the question each one is really for

**Demo video** — *"Can you show me what this is?"* A timed reel and a narration script, so a recordable ninety-second demo exists today. Fidelity 1, effort 1. This is the answer when the person asking is a stakeholder, an investor or a colleague who needs to picture the thing. Building a system to answer it is a category error.

**Clickable prototype** — *"Can someone actually complete this without help?"* An instrumented click-through of the flow, no backend and no data. Fidelity 2, effort 2. A prototype that needs a deploy is not a prototype; the whole value is that it runs on any laptop, in front of a real person, this afternoon.

**Smoke test** — *"Does anyone actually want this?"* A fake-door landing page, a waitlist and a demand console judged against a threshold set in advance. Fidelity 2, effort 2. The threshold is the entire test. Without it you have a landing page and a feeling.

**Wizard of Oz** — *"Is the outcome worth paying for, before we can automate it?"* A real front end with a human behind it, on an SLA clock, using the same routes the built system will use. Fidelity 3, effort 2. Absurdly under-used, because it feels like cheating. It is not cheating; it is separating "is this valuable" from "can we automate it", which are two questions that fail for different reasons.

**Proof of concept** — *"Does the hard part actually work, reliably enough?"* The riskiest step isolated behind a trial harness, with a pass rate judged against a bar set in advance. Fidelity 3, effort 3. Note the shape: a *pass rate*, not a demo. One successful run proves nothing about a step that has to work eight times in ten.

**Pilot** — *"Does it hold up with real people, at a size we can survive being wrong at?"* A bounded run with a named cohort, a weekly feedback loop and written exit criteria. Fidelity 4, effort 4. The exit criteria are what stops a pilot from quietly becoming production.

**Phone line** — *"Can customers reach this by phone, and can it reach them?"* An inbound number that answers and understands, plus an endpoint that places outbound calls. Fidelity 4, effort 3. Cheaper than the pilot beside it and far higher fidelity than its cost suggests, because a phone number that answers is unambiguously real to the person calling it.

**Live system** — *"Is it actually running, and can we operate it?"* The whole system at a real address, with an ops console and an on-call runbook. Fidelity 5, effort 5. Note the second half of that question. A system nobody can operate is not finished; it is a liability with good uptime so far.

## What ranking actually does

```bf-figure
{
  "kind": "bars",
  "title": "Effort, ordered — the standing recommendation before any brief is read",
  "max": 5,
  "rows": [
    { "label": "Demo video", "value": 1, "note": "an afternoon", "hue": "read" },
    { "label": "Clickable prototype", "value": 2, "note": "a day or two", "hue": "read" },
    { "label": "Smoke test", "value": 2, "note": "a day or two", "hue": "prove" },
    { "label": "Wizard of Oz", "value": 2, "note": "a day or two", "hue": "prove" },
    { "label": "Proof of concept", "value": 3, "note": "a few days", "hue": "prove" },
    { "label": "Phone line", "value": 3, "note": "a few days", "hue": "build" },
    { "label": "Pilot", "value": 4, "note": "weeks", "hue": "build" },
    { "label": "Live system", "value": 5, "note": "weeks of real engineering", "hue": "make" }
  ],
  "caption": "Cost carries forty per cent of the ranking score on its own, before any capability match. Without that term, a brief naming five capabilities would always rank whichever proof lists the most of them — which is always the biggest one."
}
```

When you paste a brief, the ranking is capability fit **plus** a standing preference for cheap over expensive. A brief that says "voice" genuinely does point at the phone line, and the fit term will say so. But a brief that names five things points at five proofs, and without the cost term the recommendation collapses into "build everything", every time, dressed up as analysis.

Two more rules the ranking follows, both of which exist because the alternative is worse:

- **Every target always comes back, with reasons.** A score with no reasons is not advice, it is a verdict — and a founder should be able to argue with advice.
- **A target with no capability list is universal, not irrelevant.** Scoring "matches nothing" as zero would bury the demo video, which is the correct first answer for most briefs.

## Choosing well

The practical question is not "which proof is best". It is **which question am I willing to spend money answering, and what result would make me stop?**

```bf-figure
{
  "kind": "flow",
  "title": "A decision you can make in about a minute",
  "steps": [
    { "label": "Name the doubt", "note": "Not the feature — the doubt. \"Nobody wants it\", \"the model is not accurate enough\", \"people cannot get through the flow\", \"it will not survive real load\".", "hue": "read" },
    { "label": "Pick the proof that attacks it", "note": "Demand → smoke test. Comprehension → clickable prototype. Technical risk → proof of concept. Value before automation → Wizard of Oz.", "hue": "prove" },
    { "label": "Write the number down first", "note": "The threshold, the pass rate, the completion rate, the exit criteria. Before it is built, not after the result is in.", "hue": "prove", "tag": "non-negotiable" },
    { "label": "Run it, and honour the number", "note": "A threshold you renegotiate after seeing the result was never a threshold.", "hue": "build" }
  ]
}
```

That last step is where most validation actually fails. The proof runs, the number comes in low, and the number moves. Writing it down beforehand does not make anyone honest — but it does make the dishonesty visible, which turns out to be most of the work.

## Where the fidelity number is not the whole story

One caution about the map. Fidelity measures how close the proof is to the real thing, not how *convincing* it is. A ninety-second demo video at fidelity 1 will move an investor further than a proof of concept at fidelity 3, because the investor's question was "can you show me" and the PoC answered a question nobody asked them.

Match the proof to the asker, not to the axis.

---

*[Read an idea and see all eight ranked against it](/realize) — reading builds nothing, so the ranking costs you nothing to look at. Or read the method they sit inside: [Idea to Real](/blog/idea-to-real-the-operating-methodology).*
