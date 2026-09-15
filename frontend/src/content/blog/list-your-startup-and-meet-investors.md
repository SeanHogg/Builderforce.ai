---
title: List your startup, meet investors, and watch your runway on the same board
date: 2026-09-15
description: A company could be built, run and measured here and still not be found. Now a founder lists the company in the Marketplace, investors express interest straight into the workspace, and Finance opens on the one number every founder acts on — with its source named.
tags: [startups, investors, marketplace, finance, runway, idea-to-real]
author: Sean Hogg
---

# List your startup, meet investors, and watch your runway on the same board

You can take an idea onto a canvas, argue it into objects, build the thing, run it as a company and read whether it worked. Then somebody has to fund it — and until this week the platform had no door an investor could walk through.

The CEO's seat had a raise: the round, the data rooms, the diligence gaps, the fundraising pack. Every one of those assumes the investor is already in the room. Nothing put a company in front of a stranger, and nothing let the stranger say "I'm interested" without a founder having found them first. The company existed. It could not be *found*.

## The company gets a public face

```bf-figure
{
  "kind": "flow",
  "title": "From a company row to an investor's inquiry",
  "steps": [
    { "label": "List", "note": "Investors → Listing. Three steps: the company, its numbers, what it is looking for. Each step saves as you go.", "hue": "run" },
    { "label": "Be found", "note": "Marketplace → Companies. Stage, sector, traction and whether you are raising — filtered the way an investor thinks.", "hue": "reach" },
    { "label": "Hear back", "note": "Express interest lands in Investors → Interest, beside every other inbound, with the CRO's own triage statuses.", "hue": "run", "tag": "in your workspace" }
  ],
  "caption": "One company row, three writers. The listing is a facet of the company you already run — not a profile you maintain beside it."
}
```

The listing is not a new object. It is the company you already have — the one your projects attach to, the one the pack is built for — with a public face switched on. That matters for one reason: the numbers an investor reads are the numbers you declared, once, and the runway they see is computed from those numbers by the same formula your CFO seat uses. There is nothing to keep in sync, because there is one thing.

```bf-figure
{
  "kind": "screen",
  "frame": "Marketplace → Companies",
  "ratio": 1.62,
  "regions": [
    { "label": "Stage chips", "note": "Bootstrapped through IPO-ready, plus Raising now", "x": 4, "y": 6, "w": 92, "h": 9, "hue": "reach" },
    { "label": "Sector · business stage · sort", "x": 4, "y": 17, "w": 92, "h": 7, "hue": "reach" },
    { "label": "A listed startup", "note": "Tagline, stage, sector, total funding, MRR, team, runway health — and Express interest", "x": 4, "y": 27, "w": 29, "h": 48, "hue": "run" },
    { "label": "A listed startup", "x": 35.5, "y": 27, "w": 29, "h": 48, "hue": "run" },
    { "label": "A listed startup", "x": 67, "y": 27, "w": 29, "h": 48, "hue": "run" },
    { "label": "For investors", "note": "Browse companies raising", "x": 4, "y": 79, "w": 44, "h": 16, "hue": "accent" },
    { "label": "For startups", "note": "Create your profile", "x": 52, "y": 79, "w": 44, "h": 16, "hue": "accent" }
  ],
  "caption": "Startup listings are a family of the one storefront, beside talent, agents and assets — not a fifth marketplace."
}
```

## What a stranger sees, and what they never see

A directory that shows everything is a directory nobody lists in. So the card shows what an investor decides on and nothing that hurts a founder to publish:

```bf-figure
{
  "kind": "compare",
  "title": "Two readers, one rule",
  "columns": [
    { "title": "A visitor", "hue": "reach", "items": ["Name, tagline, description", "Funding stage, sector, business stage", "Total raised, monthly revenue, team size", "Whether the company is raising", "Runway HEALTH — critical, watch, healthy, profitable"] },
    { "title": "A signed-in reader", "hue": "run", "items": ["Everything a visitor sees", "Runway in MONTHS", "The investor contact the founder chose to publish", "Never cash on hand. Never burn."] }
  ],
  "caption": "The tier rule lives in one function on the server. The directory and the profile page both go through it, so neither can leak what the other hides."
}
```

Cash and burn are the two numbers a competitor would most like to read. They stay in the workspace. The card carries the runway's health band — enough for an investor to know whether to hurry — and a signed-in reader gets the months. Pressing **Express interest** writes one row in the founder's tenant: the same deal-flow row the CRO's queue triages, with the investor's message, the instrument they have in mind and the timeframe. The founder is notified, reads it in **Investors → Interest**, and marks it *in conversation*, *investing* or *passed*. When it is real, they invite the investor to the company — one NDA, every data room — and the rest of the raise is where it already was.

## Runway, with its provenance named

BurnRateOS showed one runway figure and you could not tell whether it came from a bank feed or a form. Finance now opens on two columns and labels them.

```bf-figure
{
  "kind": "screen",
  "frame": "Finance → Runway",
  "ratio": 1.7,
  "regions": [
    { "label": "OBSERVED", "note": "Cash, net burn, MRR and months — from approved spend, processed payroll and connected books, recomputed daily", "x": 4, "y": 6, "w": 45, "h": 44, "hue": "measure" },
    { "label": "DECLARED", "note": "Cash on hand, monthly spend, team cost, revenue — what you told us, editable here, with the verdict beside it", "x": 51, "y": 6, "w": 45, "h": 44, "hue": "run" },
    { "label": "Month by month", "note": "Revenue · spend · net burn · cash at month end, for the observed months", "x": 4, "y": 54, "w": 92, "h": 40, "hue": "measure" }
  ],
  "caption": "Two provenances, never blended. A runway computed from typed numbers says so beside the figure, not in a footnote."
}
```

The arithmetic is the same everywhere it appears — the free calculator on the Business Intelligence page, the founder's onboarding step, the listing card and the CFO's view — because it is written once and tested once. It divides cash by *net* burn. A company spending $100k and earning $80k is burning $20k, and the version of this formula that divides by gross spend reports a fifth of the real runway. That is the one consequential mistake available here, and it is the reason there is one formula rather than four.

Cashflow sits beside it: inflows, outflows, net and the ending balance, month by month, as a chart and a table, for the months the platform observed and for the projection at your declared burn. You pick which series is on screen, and the chart's caption names it.

## Where it sits in the method

Run and Reach, and the seam between them.

```bf-figure
{
  "kind": "stack",
  "title": "The company, on the arc",
  "bands": [
    { "label": "Idea", "note": "The canvas the product was argued into", "hue": "idea" },
    { "label": "Make", "note": "The projects that attach to the company", "hue": "make" },
    { "label": "Run", "note": "Finance → Runway and Cashflow. The CFO's number, with its source named.", "hue": "run" },
    { "label": "Measure", "note": "Observed facts, recomputed daily, beside what you declared", "hue": "measure" },
    { "label": "Reach", "note": "Marketplace → Companies. The company is found; interest comes back into Run.", "hue": "reach" }
  ],
  "caption": "The listing is a Reach surface that writes into Run. An inquiry is inbound deal flow, not a notification."
}
```

Run needed this because a company that cannot state its runway cannot say how long it has to raise. Reach needed it because a company that cannot be found cannot raise at all. The listing closes the loop the other way too: an investor's inquiry is the first Measure signal a raise produces — how many people looked, how many asked — and it arrives on the same board where the thing they are asking about is being built.

Start from the marketplace door, or from the calculator, or from **Investors → Listing**. Three steps later the company is listed, its runway is on Finance, and the next stranger who finds it can tell you so.
