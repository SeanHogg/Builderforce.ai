---
title: Insights tells you what to fix — and proves it worked
date: 2026-10-13
description: Recordings and heatmaps showed you the problem and left the next step to you. Insights now names the change, renders it on your page, hands it to an AI as a prompt or applies it, and grades it on the next release.
tags: [methodology, idea-to-real, validation, product-strategy, metrics]
author: Sean Hogg
---

# Insights tells you what to fix — and proves it worked

Watching a visit tells you what went wrong. It does not tell you what to change, how much the change is worth, or whether the change you shipped did anything at all.

That is where most site data stops. A heatmap with a red smear on the heading. A funnel that drops at step two. Forty recordings of people giving up on the same form. All of it true, and none of it a decision. Somebody still has to turn it into a change, guess whether it matters, write the brief, get it built, and then — usually never — check whether the number moved.

Insights now does that work with you. Its home is no longer a dashboard. It is a short list of fixes.

## The fixes, ranked

Every fix starts from something visitors actually did on your site: a share of visitors rage-clicking one element, an error that shows up in most of the visits that drop at a step, a heading people click as if it were a link, the main button sitting below where most people stop scrolling, phones converting far below desktop, a release that did worse than the one before it. Those findings come from rules over your own recordings, not from a model's opinion. AI only puts a cited finding into words and drafts the change; a sentence it cannot tie to the evidence is dropped.

Each fix carries an impact range worked out from your own visitors — the people who hit the problem against the people who did not. When there are too few visits to say, it says that instead of inventing a number. The list is ranked by impact against effort, so the cheap, likely change sits above the expensive, speculative one.

```bf-figure
{
  "kind": "screen",
  "frame": "BuilderForce — Insights · Fixes",
  "ratio": 1.5,
  "regions": [
    { "label": "Fixes, ranked", "note": "Impact against effort, highest first", "x": 4, "y": 6, "w": 32, "h": 88, "hue": "measure" },
    { "label": "Before", "note": "The page as it is, numbered where visitors struggle", "x": 39, "y": 6, "w": 28, "h": 56, "hue": "muted" },
    { "label": "After", "note": "The same page with the change rendered", "x": 69, "y": 6, "w": 27, "h": 56, "hue": "make" },
    { "label": "Impact range", "note": "From your own visitors, or 'too few visits to say'", "x": 39, "y": 66, "w": 28, "h": 28, "hue": "accent" },
    { "label": "Fix it · Test it · Follow up · Ticket", "note": "One action, then a verdict on the next release", "x": 69, "y": 66, "w": 27, "h": 28, "hue": "run" }
  ],
  "caption": "Recordings, heatmaps and funnels are still there. They are the evidence behind a fix, reached from it, not the place you start."
}
```

## The page, as it is and as it would be

Alongside what visitors did, Insights reviews your key pages on every release: entry pages, funnel steps, proof pages and your most visited routes. Each is captured at desktop and phone width and checked for search basics, content, performance and accessibility — a missing description, more than one main heading, a vague call to action, no reason to trust you above the fold, a slow hero image, text that is hard to read, tap targets that are too small. Your search data is used when you have connected it, and never made up when you have not. The capture never fills in a form or signs in.

A finding that comes from looking at the screenshot is shown only when it points at a real element on the page and a measured fact about it, and it is labelled as observed.

Then the change is drawn. Not described — rendered, on your page, before and after.

```bf-figure
{
  "kind": "compare",
  "title": "The same page, before and after the change",
  "columns": [
    { "title": "As it is", "hue": "muted", "items": ["① The heading reads like a link, and people click it", "② The main button sits below where most visitors stop scrolling", "③ No reason to trust you before the fold", "④ Grey text on a light background"] },
    { "title": "As it would be", "hue": "make", "items": ["① The heading is plain text with one clear promise", "② The button moves up, into view", "③ A line of proof sits beside the button", "④ Contrast that passes"] }
  ],
  "caption": "The numbers on the left match callouts on the captured page. The right is that page with the change applied, not a mock-up of it. Search changes show as the result people would see."
}
```

## From a finding to a verdict

A fix you can see is still a fix nobody has made. So each one comes with a way to make it — and none of them reach production on their own.

- **Fix it.** On a site you host with us, a coding agent makes the change and you get a preview release. A person publishes it.
- **Test it.** Run the change as an A/B test: visitors are split, each sees one version consistently, and the test stops on a rule you set up front, not on a good-looking afternoon.
- **Follow up.** When the problem cost you known visitors — someone who hesitated on pricing or left checkout — enrol them in a follow-up sequence, through your own sales rules.
- **Ticket.** Put it on the board with the evidence attached.
- **Hand it to an AI.** Apply it in the canvas composer, or copy an improvement prompt written for a coding agent or for whatever site builder you use.

```bf-figure
{
  "kind": "flow",
  "title": "One fix, end to end",
  "steps": [
    { "label": "Finding", "note": "Something visitors did, or a measured fact about the page. Cited, not guessed.", "hue": "measure" },
    { "label": "Prescription", "note": "The change, the reason, an impact range from your own visitors, and the change drawn on the page.", "hue": "idea" },
    { "label": "Apply", "note": "Fix it, Test it, Follow up or Ticket — or apply it in the composer, hand it to a coding agent, or copy the prompt.", "hue": "make", "tag": "a person decides" },
    { "label": "Next release", "note": "Detected on its own. The page is captured and scored again.", "hue": "run" },
    { "label": "Verdict", "note": "Worked, no effect, or worse. Worse on a published fix offers a revert.", "hue": "measure", "tag": "measured" }
  ],
  "caption": "The ledger shows each release with the fixes it shipped and what they did. A fix without a verdict is still open."
}
```

The verdict is the part most tools leave out. A fix or a ticket is judged by how visitors behaved on the route before and after the release that carried it. A test is judged by its variants. A follow-up is judged by the people enrolled against the people who matched and were not. The answer is one of three words — worked, no effect, worse — and "worse" on a change you published comes with a way back.

## Where it sits in the method

The method has an arc — **Idea → Make → Run → Measure → Reach** — and an inner loop of three acts: **Read, Prove, Build**. [See why visitors leave](/blog/see-why-visitors-leave) put recordings on Measure, as the grade on a proof. Fixes are the other half: the bridge from Measure back to Make.

- **Fix it is Make.** It is a Build, scoped to one cited finding, with a preview a person publishes.
- **Test it is a proof.** A kill condition, a sample, a stopping rule — the same shape as any proof on the [cheapest-first list](/blog/eight-ways-to-make-an-idea-real), run on the page you already have.
- **The verdict is Measure, again.** The next release is graded on what visitors did, not on whether the change shipped.
- **A miss is the next Read.** When a proof misses, the reason it cites becomes a finding of its own, and you read the idea again with that reason in hand.

```bf-figure
{
  "kind": "flow",
  "title": "Measure back to Make, and around again",
  "steps": [
    { "label": "Measure", "note": "Recordings, heatmaps and the page review produce cited findings.", "hue": "measure" },
    { "label": "Make", "note": "Fix it: one change, a preview release, a person publishes.", "hue": "make", "tag": "Build" },
    { "label": "Prove", "note": "Test it: an A/B test with a stopping rule set before it starts.", "hue": "prove", "tag": "a proof" },
    { "label": "Measure", "note": "The next release is detected and graded: worked, no effect, worse.", "hue": "measure", "tag": "verdict" },
    { "label": "Read", "note": "A missed proof's cited reason becomes the next thing you read the idea against.", "hue": "read" }
  ],
  "caption": "Idea → Make → Run → Measure is the arc. Fixes are how Measure stops being a report and starts being the next change."
}
```

[Read, Prove, Build](/blog/read-prove-build-the-inner-loop) is the inner loop. [Grade the proof](/blog/grade-the-proof-and-close-the-loop) is where the number gets written down. This is what you do with the number once it is written.

Install Insights, drop the snippet on your site or switch recording on for a hosted app, and the first fixes arrive once there are visits to read them from.

---

**Related reading:** [See why visitors leave](/blog/see-why-visitors-leave) · [Grade the proof](/blog/grade-the-proof-and-close-the-loop) · [Read, Prove, Build](/blog/read-prove-build-the-inner-loop) · [Idea, Make, Run, Measure](/blog/idea-make-run-measure-menu-as-methodology)

[Open a canvas](/create) and fix the first thing your visitors told you.
