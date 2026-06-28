---
title: "The Planning Spine: One Dated, Cost-Bearing Hierarchy from Portfolio to Task"
date: 2026-06-27
description: Most teams keep strategy in a slide deck, delivery in a board, and cost in a spreadsheet — and reconcile them by hand. Builderforce.ai's Planning Spine unifies portfolio, initiative, epic and task into one dated timeline where every level carries its own rolled-up cost, split CAPEX vs OPEX.
tags: [planning, pmo, finops, capex-opex, portfolio, system-of-record]
author: Sean Hogg
---

# The Planning Spine: One Dated, Cost-Bearing Hierarchy from Portfolio to Task

Strategy lives in a slide deck. Delivery lives in a board. Cost lives in a finance spreadsheet. Three tools, three owners, and a monthly ritual where someone reconciles them by hand and everyone argues about which number is right.

The **Planning Spine** collapses those three layers into one. It is a single dated hierarchy — **Portfolio → Initiative → Epic → Task**, with **Objectives and Key Results** attaching as a goal layer at any level — where every node has a start date, an end date, and its own rolled-up cost. You plan, deliver, and account for the same work in the same place.

> Builderforce.ai's Planning Spine is one dated, cost-bearing hierarchy — portfolio, initiative, epic and task on a single Gantt — where leaf cost rolls up to every ancestor and is split CAPEX vs OPEX, so finance and delivery read from the same source of truth.

## Cost is a property of the work, not a separate ledger

Because every task on Builderforce.ai is already instrumented — LLM spend is priced at write time from the usage log, human effort from each member's cost rate — the Planning Spine doesn't need a parallel finance system. Leaf cost simply **rolls up** to every ancestor: a task's cost flows to its epic, the epic's to its initiative, the initiative's to its portfolio. You get a real number at any altitude without a backfill.

And every dollar is classified. Each node carries a `cost_class` of **CAPEX** or **OPEX**, resolved in priority order: an explicit declaration wins, otherwise it's inherited from the parent, otherwise an agent classifier proposes one from the work's investment category (innovation capitalizes as CAPEX; keep-the-lights-on, support and tech-debt expense as OPEX), with a GAAP-conservative default as the floor. When a child's declared class contradicts its parent, the spine flags it as an **anomaly** for a PM to reconcile — capitalization decisions get sign-off instead of being silently inherited.

## One Gantt, every level

The Planning Spine renders as a single nested, collapsible timeline. A portfolio bar contains its initiatives; an initiative contains its epics; an epic contains its tasks — all dated, all on the same axis, color-coded by cost class with anomaly markers where capitalization needs review. Initiative-level **dependencies** (blocker → blocked, cycle-checked) drive an on-demand **critical path**, so the longest incomplete chain is always visible.

When finance needs the numbers outside the app, the whole spine exports to CSV for any date range — the same figures the dashboard shows, ready for the close.

## Why this matters

An AI workforce changes cost behavior overnight. When agents do the building, spend stops looking like headcount and starts looking like consumption — bursty, per-task, attributable. A board that tracks status but not cost can't answer the question every CFO is about to ask: *what did this initiative actually cost, and how much of it can we capitalize?*

The Planning Spine answers it from live data. Engineering plans on it, the PMO rolls portfolios up on it, and finance closes the books from it — one hierarchy, one set of numbers, no reconciliation step.

[Tour the platform →](/product) · [See every role's operating picture →](/blog/every-role-operating-picture) · [Start building for free →](/register)
