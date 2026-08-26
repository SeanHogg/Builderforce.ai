---
title: From offer to payroll without retyping anything — and the HR system you already run
date: 2026-08-19
description: Two funnels used to stop next to each other: hiring ended at an accepted offer, and people started with an employee record somebody typed. Here is the handover, and the read-only connectors that stop headcount being guesswork.
tags: [hiring, hr, hrms, onboarding, integrations]
author: Sean Hogg
---

# From offer to payroll without retyping anything

Two vocabularies, each correct, sitting next to each other with nothing in between.

Hiring owned the funnel: posting, screening, interview, offer. People owned the employment relationship: employee, lifecycle, onboarding, reviews. Both headers described the transition between them in as many words — *"an offer becoming an employee"*. Neither performed it. The product shipped two funnels that stopped a foot apart, and the gap was filled by a person copying fields from one screen to another.

## The handover, and its three refusals

```bf-figure
{
  "kind": "flow",
  "title": "Offer → employee, in one step",
  "steps": [
    { "label": "Signed offer", "note": "The trigger. Not an accepted verbal, not an offer at draft — a signed one.", "hue": "growth" },
    { "label": "Carry the facts across", "note": "Title, location and basis from the posting; skills and evidence from the candidate; start date from the offer. Nothing invented.", "hue": "run" },
    { "label": "Employee + lifecycle", "note": "The employment record and the onboarding plan, created together and joined back to the offer they came from.", "hue": "measure" }
  ],
  "caption": "The handover belongs to NEITHER vocabulary. Putting it in the recruiter's would let hiring author HR records; putting it in HR's would let HR read the recruiter's fields. It is declared once, between them."
}
```

It refuses in three cases, and each refusal is the useful kind:

- **The offer is not signed.** An employment record that begins from an unsigned offer is a record of something that did not happen.
- **There is no person attached.** An employee with no candidate behind them is where a duplicate person record is born.
- **There is no start date.** A lifecycle with no anchor date has no due dates at all, so every onboarding task in it is silently undated.

It throws rather than creating a half-populated pair, because half a hire is worse than none — you find it three weeks later when payroll asks who this is.

Alongside it, every scored résumé is now attached to a real candidate. Scoring a document that belongs to nobody produces a number you cannot act on, and a pile of them produces a shortlist nobody can assemble.

## Read the HR system you already run

The catalog could publish a requisition outward and read a pay run back, and had no way at all to read your **own** people. So employees, role assignments, capacity and every headcount figure the delivery views show were typed in by hand — and "who actually works here" lived in a system this product could not reach.

```bf-figure
{
  "kind": "stack",
  "title": "Seven ways to answer \"who works here\"",
  "bands": [
    { "label": "Workday", "note": "Workers, org, assignments.", "hue": "run" },
    { "label": "BambooHR · HiBob · Personio", "note": "The mid-market three, each with its own idea of an employment record.", "hue": "run" },
    { "label": "SAP SuccessFactors", "note": "For the estates where the HR system predates the product it is describing.", "hue": "run" },
    { "label": "Greenhouse", "note": "The ATS side — candidates and pipelines, read alongside the people they become.", "hue": "growth" },
    { "label": "SCIM 2.0 directory", "note": "The generic reader, for everything not on this list.", "hue": "muted" }
  ],
  "caption": "Every action in the category is a READ, and a test fails the build if that ever stops being true."
}
```

That last line is the design decision, not an implementation detail. An HR system is the system of record for people's employment. A tool that can write to it is a tool that can quietly get somebody's salary, title or termination date wrong, and the blast radius of that is a person's life rather than a dashboard. Read-only is enforced, tested, and stated where anyone integrating can see it.

## What it changes about a headcount number

```bf-figure
{
  "kind": "compare",
  "title": "Where a capacity figure comes from",
  "columns": [
    { "title": "Typed", "hue": "bad", "items": ["Right on the day it was entered", "Wrong after the first leaver", "Nobody knows when it was last checked", "So nobody trusts the plan built on it"] },
    { "title": "Read", "hue": "good", "items": ["Comes from the system that owns the fact", "Moves when the org moves", "Carries where it came from", "A plan built on it can be argued with"] }
  ],
  "caption": "The same rule as ageing on an invoice, or a percentage on a cap table: a number that can be typed is a number that will eventually disagree with reality."
}
```

Both halves of this belong to the same stage of the arc: Market is *sell, buy, hire, be found*, and Run is what happens once the person is actually on the payroll. The handover is the seam between them, and it is now something the product performs rather than something it describes.

---

**Related reading:** [The founder back office](/blog/the-founder-back-office-money-ownership-and-paperwork) · [How to build an org chart that stays accurate](/blog/how-to-build-an-org-chart-that-stays-accurate) · [Structured scorecards and blind review](/blog/structured-scorecards-and-blind-review-to-reduce-hiring-bias)

See the [integrations catalogue](/integrations), or [open a canvas](/create) and put the funnel next to the work it is staffing.
