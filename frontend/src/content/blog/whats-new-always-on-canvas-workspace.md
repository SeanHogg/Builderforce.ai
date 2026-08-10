---
title: What’s New: An Always-On Canvas, Native Files, and Connected Tools
date: 2026-08-09
description: Builderforce’s latest release keeps the Creation Canvas at the center of the product, opens tools and reference pages beside your work, and adds richer files, integrations, sharing, and local-first creation.
tags: [product-updates, creation-canvas, integrations, collaboration, local-first]
author: Sean Hogg
---

# What’s New: An Always-On Canvas, Native Files, and Connected Tools

The latest Builderforce release changes a basic assumption about AI work: the canvas is no longer a page you leave whenever you need another part of the product. It is the persistent workspace underneath the product.

That architectural change comes with practical improvements you can use immediately—local-first creation without an account, reference pages that open beside the board, native document and data experiences, broader integrations, and a Creation Canvas that travels between the web and VS Code.

[Open a new Creation Canvas →](/create/new)

## Your board stays with you

Opening a tool, integration guide, diagnostic, or other reference destination now opens a panel over the active canvas. The board remains mounted behind it, preserving object positions, selections, an in-progress Brain response, and live-session state. Close the panel and you return to the same working context.

This turns navigation into consultation. You can read how an integration works, run an assessment, or check a reference without trading away the work that led you there. On larger screens the panel is resizable; on narrow screens it becomes the focused surface while the canvas remains the session anchor.

## Start locally, then decide when to sign up

A signed-out visitor can create a real local board, add objects, work with Brain, and return to saved local drafts. “New canvas” creates locally when there is no workspace, so the primary action does what it says instead of redirecting to an account form.

Sharing follows the same principle. A local board can open a guest room and produce an invite link without first requiring an account. People joining the room see the seeded board rather than an empty workspace, and late joiners receive the current snapshot. Creating an account is the way to keep and manage the work durably—not the price of trying it or showing it to someone.

## Files behave like files

Documents, slide decks, diagrams, tables, and spreadsheets now render according to what they are:

- Documents show headings, lists, tables, code, and quotations on a readable page.
- Presentations appear as ordered 16:9 slides rather than a paragraph of source text.
- Draw.io and Mermaid diagrams render as diagrams on the board.
- Tables and spreadsheets support direct cell and header editing.
- A Files panel gathers authored objects and delivered exports in one searchable place.

The same object can be opened, edited, inspected, and exported without maintaining a second copy. Documents can leave as documents, decks as presentations, diagrams in their diagram formats, and sheets in spreadsheet-friendly formats.

File import is more direct too. Drop a supported file onto the canvas and it appears as an appropriate object. HTML documents become readable documents while retaining their source for lossless export, and connected Drive files can be brought into the same workspace.

## Data can become an answer, not just an attachment

Brain can query the complete imported dataset rather than reasoning from a handful of preview rows. It can filter, derive classifications, group, aggregate, sort, and materialize the result as a Table, Chart, Dashboard, or KPI object.

That matters for ordinary questions such as “group shipments by success and failure,” “plot these locations,” or “show the top five categories by revenue.” The result is computed from the actual rows and placed back on the canvas as a reusable artifact. Dataset profiling exposes column types, coverage, distinct values, and ranges so you can inspect the evidence behind the visual.

## Connected capabilities are easier to find

The public integration catalog now reflects the product’s connector, board-sync, data, Drive, and mailbox capabilities through one combined catalog. If a service participates in more than one surface, it appears once with those capabilities attached.

On the canvas, tools are capabilities rather than detached mini-apps. Brain can discover a diagnostic and add it as an object through explicit canvas tools. Connectors can participate in workflows, while mailbox, Drive, repository, build, and board connections remain visible in the context where the work happens.

[Explore integrations →](/integrations)

## One canvas in the browser and VS Code

The VS Code canvas and web canvas now use the same implementation. Object behavior, Brain controls, layout, and the core interaction model do not fork when you move between surfaces. A Builder object can act as the in-browser project workspace, while the extension brings the same spatial view closer to the repository.

The result is less context reconstruction. Start from a prompt in the browser, continue beside the code, share the board with a collaborator, and return to a reference panel without rebuilding the state of the project in each place.

## A release organized around continuity

These features look different on the surface—panels, guest sharing, file rendering, dataset queries, integrations—but they solve the same problem. AI work loses value when every destination breaks the chain of context.

Builderforce now treats the canvas, its objects, its Brain conversation, and its live room as one continuous session. Everything else can support that session without replacing it.

[Try the always-on Creation Canvas →](/create/new)
