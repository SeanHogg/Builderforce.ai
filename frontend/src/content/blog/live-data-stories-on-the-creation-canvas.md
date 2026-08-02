---
title: "From Raw Rows to a Live Data Story on One Canvas"
date: 2026-08-02
description: Import tabular evidence, profile it, create charts and KPIs, assemble dashboards and reports, and preserve the source relationships behind an executive data story in Builderforce Creation Canvas.
tags: [creation-canvas, data, dashboards, analytics, presentations]
author: Sean Hogg
---

# From Raw Rows to a Live Data Story on One Canvas

Analysis often fractures at the moment it becomes useful. The data lives in a spreadsheet, the chart in a notebook, the decision in a document, and the executive version in slides. Every copy weakens the link back to the evidence.

Creation Canvas treats the complete data story as a connected set of live objects.

![Product view of a live Data Story canvas with a source Dataset table connected to a Chart and KPI, assembled into a Dashboard and Report, and presented through Slides with visible data, reference, and presentation edges](/blog/live-data-stories-workspace.svg)

## Begin with evidence, not a screenshot

A Dataset object can import CSV or TSV content into bounded structured fields. The canvas records columns, row count, and a safe sample for inspection and Brain context rather than pushing an unlimited table into every reasoning request.

Profile the Dataset to understand shape and coverage. Visualize it to create a Chart connected to the source. For manual analysis, Table and Spreadsheet objects hold structured rows, columns, and formulas. These are different artifacts with different purposes, not one generic “data card.”

## Build the decision layer

Chart objects hold chart type, labels, values, and sources. KPI objects carry value, target, unit, trend, and source references. A Dashboard can assemble KPI and chart material into an operating view; refresh and drill actions remain native to the object.

Reports and Evaluations add interpretation. A Report can combine Markdown, chart data, and citations. An Evaluation records a verdict, gaps, recommendations, and sources. Brain can work across the selected evidence and analytical objects without confusing their visual position with a data dependency.

![Dataset, Table, and Spreadsheet objects form the evidence layer; Chart and KPI objects form the visual layer; Dashboard, Report, and Evaluation form the decision layer; Slides present the narrative while typed data, reference, and presentation connections preserve provenance](/blog/data-story-object-pipeline.svg)

## Relationships carry meaning

A line on the canvas is not merely decoration. Use a **data** connection when one object supplies values, a **reference** connection when a conclusion cites evidence, and a **presentation** connection when a Dashboard or Report supports Slides.

That semantic graph lets Brain distinguish “this chart uses the dataset” from “this slide mentions the report.” It also makes the visual story reviewable by someone who did not build it.

## Start from a complete pack

The shipped **Data story** template places a Source Dataset, Key trend Chart, Decision Dashboard, and Executive data story Slides object on the canvas with useful starter relationships. It is a scaffold, not a sealed workflow. Add a Spreadsheet for calculations, KPIs for targets, an Evaluation for gaps, or Project context for delivery performance.

## Keep executive output connected

When the narrative changes, the evidence should remain inspectable. A Slides object on the canvas can retain sources instead of becoming the terminal copy in a disconnected deck. Reviewers can move from a claim to the Report, Dashboard, Chart, and ultimately the Dataset that supports it.

This is the difference between decorating a conclusion with charts and building a trustworthy data story:

**rows → profile → visual evidence → decision view → written interpretation → presentation**

Every stage remains an object. Every important dependency can remain a typed edge.

[Build a data story →](/create/new)
