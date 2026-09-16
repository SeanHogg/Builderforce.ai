---
title: The metrics your vertical actually runs on, installed in one click
date: 2026-08-22
description: Every company has a finance tab. Almost none of them have the six numbers their own vertical is judged by. KPI dashboards ship as marketplace templates now — pick your sector, install, and the tiles your peers track are already on the board.
tags: [finance, dashboards, metrics, benchmarking, product]
author: Sean Hogg
---

# The metrics your vertical actually runs on, installed in one click

Ask a SaaS founder what they watch and you get net revenue retention, magic number, payback period. Ask a biotech founder the same question and none of those words mean anything — they are watching runway against the next readout, and headcount against the burn that gets them there.

Both of them, until now, opened the same finance tab and saw the same three numbers.

That is the quiet failure of a generic dashboard. It is not wrong. It is just not *about you*, and a number that is not about you is one you stop opening. The tab loads, the cash balance is correct, and nobody has learned anything they did not already know.

## Dashboards are templates now

A KPI dashboard is not a feature we wrote eleven times. It is a **marketplace template**, exactly like the ones that install a workflow or a playbook — a small manifest that says which metrics belong together, asks you how big the company is, and materialises a working board.

```bf-figure
{
  "kind": "flow",
  "title": "From sector to a dashboard that means something",
  "steps": [
    { "label": "Declare", "note": "Your company profile already knows its sector. Nothing new to fill in.", "hue": "read" },
    { "label": "Install", "note": "One template per vertical, from the Marketplace. It asks one question — small, mid or large — because a metric's healthy range moves with company size.", "hue": "make" },
    { "label": "Measure", "note": "The tiles resolve against your real finance and equity data. A metric with nothing behind it reads as not measured, never as zero.", "hue": "make", "tag": "on the finance tab" }
  ],
  "caption": "Eleven dashboards, one mechanism. Adding a twelfth vertical is a data change, not a release."
}
```

Ten verticals ship today — AI/ML, SaaS, FinTech, digital health, MedTech, BioTech, climate and energy, hardware and robotics, cybersecurity and marketplaces — plus a founder dashboard for everyone whose sector does not yet have a cohort of its own.

## Null is not zero

The detail that took the longest is the one nobody asks for: what a tile does when it has nothing to show.

A dashboard that renders an unmeasured metric as `0` is actively lying. Zero net revenue retention is a catastrophe; *no NRR data yet* is a Tuesday. The two look identical on most dashboards, and the cost of that is a founder who either panics at a number that isn't real or — far more likely — learns to distrust the whole screen.

So a metric with no data behind it says it is not measured, and says nothing else. No placeholder zero, no dash that could be read as a value, no invented trend line. You can tell at a glance which of your numbers are real, which is the prerequisite for acting on any of them.

```bf-figure
{
  "kind": "compare",
  "title": "What an empty tile is allowed to claim",
  "columns": [
    { "title": "The usual dashboard", "hue": "muted", "items": ["Renders 0", "Draws a flat line from nothing", "Colours it red", "Founder panics, or stops looking"] },
    { "title": "Here", "hue": "make", "items": ["Says the metric is not measured", "Draws nothing", "Leaves the tile calm", "The real numbers stay legible"] }
  ],
  "caption": "The value of a dashboard is decided by how it behaves when it is missing data, not by how it looks when it is full."
}
```

## Where it sits in the method

This is **Measure** — the act after Run. [Read and Prove](/blog/read-prove-build-the-inner-loop) tell you whether a thing is worth building; Build and Run get it live. Measure is where you find out whether it did anything, and it is the act most often skipped, because standing up a dashboard has historically been a small project of its own.

Making the dashboard a template collapses that project into an install. The board you get is not a starting point to configure for a fortnight — it is the set of numbers companies like yours are already judged by, resolved against your own data, on the tab you already open.

## What you can do with it today

- **Install your vertical's dashboard** from the Marketplace, or from the empty state on the finance tab, which already knows your sector and links straight to the right one.
- **Read it beside runway and cashflow** — the dashboard is a third tab on the finance hub, not a separate destination.
- **See which numbers you are not yet measuring**, stated plainly, so that instrumenting one becomes a decision rather than an accident.
- **Size the ranges to your company** — the same metric carries a different healthy band at ten people and at four hundred, and the template asks once.
