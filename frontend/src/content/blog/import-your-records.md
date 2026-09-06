---
title: Import a quarter of records at once — and see the board lenses move
date: 2026-09-06
description: The People, R&D, Quality and AI lenses on the Insights board always read from real tables, and for the datasets with no connector the only way in was one row at a time. Import now takes a file, maps its columns onto the server's own registry, checks every row before writing, and posts in batches you can watch land.
tags: [product-updates, insights, import, board-deck, measure]
author: Sean Hogg
---

# Import a quarter of records at once — and see the board lenses move

The board deck has always been honest. The People slide is drawn from headcount events, the Investment slide from quarterly R&D figures, the Quality slide from incidents and support tickets, the AI slide from tool adoption. None of it is typed into a template; every number is a query over a table.

Which raises the obvious question for the datasets no connector fills: **how do the rows get into the table?**

For a while the honest answer was: one at a time, through a tracker form. A finance lead with three quarters of spend in a spreadsheet had a hundred form submissions ahead of them. Most did not do it, the lenses stayed empty, and an empty lens looks a great deal like a feature that does not work.

There was, technically, a second way. An import endpoint existed, hung off the Insights API, spoken only by the Brain's tools. And there was an `/import` page — a guided wizard and a bulk uploader — which nothing linked to, which knew one generic "record" with a name and a priority, and which ended every submission by sleeping for six hundred milliseconds and showing you a reference number it had just made up. A scaffold wearing the clothes of a feature.

## What import is now

There is one import surface, and the page is a real front on it.

```bf-figure
{
  "kind": "flow",
  "title": "A file becomes rows the lenses can read",
  "steps": [
    { "label": "Pick a kind", "note": "Headcount events, open positions, R&D financials, incidents, uptime, AI adoption — the server's own registry, listed from the server.", "hue": "measure" },
    { "label": "Map", "note": "Your headers are matched onto the kind's columns by name; anything the guess got wrong is one dropdown away. Required columns are starred.", "hue": "measure" },
    { "label": "Check", "note": "Every cell is checked against its column type in your language, and the server runs the same file as a dry run and says which rows it would write.", "hue": "measure" },
    { "label": "Post", "note": "The valid rows go up in batches of five hundred. The bar moves when the server acknowledges a batch, not on a timer.", "hue": "measure", "tag": "real progress" }
  ],
  "caption": "The columns are not restated on the page. They are read from the api's registry, so a column added to a dataset reaches the mapper, the template and the wizard with no second registration."
}
```

Three things about that are worth saying plainly, because each one replaces something that used to be faked.

**The columns come from the server.** The page asks `/api/import/kinds` and gets back every importable dataset with its columns, their types, whether each is required, and a realistic example value. The CSV template you download is generated from that list; the placeholder in each wizard field is that column's example. There is no copy of the schema on the client to drift.

**The check is two checks.** Before anything is written, the client validates every mapped cell — a number that is not a number, a date that is not a date, a required column left empty — and tells you the row and the column, in your language. Then the same rows go to the server with `dryRun: true`, and the server answers with what it *would* write and which rows it would skip. The first check tells you which cell; the second is the authority on what will land.

**The progress is real.** Rows are posted in batches, and the counter reads *posted of total* as the server acknowledges each one. If a batch fails partway, the page says so, keeps what was already written, and shows the aggregate rather than pretending nothing happened.

```bf-figure
{
  "kind": "screen",
  "frame": "Bulk import, at the check step",
  "ratio": 1.5,
  "regions": [
    { "label": "Kind", "note": "One dataset, chosen from the registry", "x": 4, "y": 6, "w": 92, "h": 10, "hue": "measure" },
    { "label": "Rows in file · valid · with errors · server will write", "note": "Four counts, two sources", "x": 4, "y": 20, "w": 92, "h": 16, "hue": "accent" },
    { "label": "Row 12 · effectiveOn · must be a date", "note": "The client check, per cell, translated", "x": 4, "y": 40, "w": 60, "h": 34, "hue": "bad" },
    { "label": "Rows the server would skip", "note": "The dry run's own lines", "x": 68, "y": 40, "w": 28, "h": 34, "hue": "muted" },
    { "label": "Back · Cancel · Import 188 rows", "x": 4, "y": 80, "w": 92, "h": 12, "hue": "accent" }
  ],
  "caption": "The Import button counts the rows that passed the client check, and the server's dry run is shown beside it so you know what the count will become."
}
```

## The guided path still exists

Not every record is a file. A single incident, one open position, this month's AI tool figures — the wizard takes them one at a time, with each field checked as you leave it and a review step before the post. What changed is the end: it submits the one record through the same endpoint the bulk path uses and shows you the server's answer — written, or skipped and why. The invented reference number is gone, because a receipt you made up is not a receipt.

## Where it sits in the method

Import is a **Measure** capability. The arc is Idea → Make → Run → Measure, and Measure is the act that hands a graded answer back to Idea — it is where the loop closes. A lens that reads from an empty table cannot grade anything; it can only look like it is about to. The People, R&D, Quality and AI lenses were built to be honest about what the workspace is actually doing, and the one thing standing between them and honesty was the cost of getting a quarter of facts into them.

```bf-figure
{
  "kind": "compare",
  "title": "The cost of a true lens",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["Open the tracker", "Type one row", "Submit", "Repeat a hundred times", "Or leave the lens empty", "Or ask the Brain to call an endpoint the page did not know about"] },
    { "title": "Now", "hue": "measure", "items": ["Download the kind's template", "Fill it, or export from wherever the numbers already live", "Map, check, post", "Watch the lens redraw"] }
  ],
  "caption": "Import lives as a tab of Insights because that is where the imported rows show up. The page had no door at all before this; now the door is next to the room."
}
```

## What you can do with it today

- **Load a quarter of R&D financials, revenue and FTE allocation** from three small files, and read the Investment lens against plan.
- **Backfill headcount events and open positions** so the People slide's waterfall and attrition are drawn from your history, not from the day you signed up.
- **Bring in incidents, support tickets and uptime samples** from an export of whatever tool holds them, and let the Quality lens grade the quarter.
- **Record AI tool adoption and program spend** month by month, and see the AI lens compute hours saved per dollar.
- **Ask the Brain to do it** — its `board_data.import` tool speaks the same contract, dry run included.

Every one of those ends the same way: a lens that used to be empty, drawing a real number.

---

**Related reading:** [Grade the proof and close the loop](/blog/grade-the-proof-and-close-the-loop) · [Every role's operating picture](/blog/every-role-operating-picture)

[Open Import](/import) and download a template for the dataset you have been meaning to fill.
