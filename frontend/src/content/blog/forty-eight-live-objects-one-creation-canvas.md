---
title: "48 Live Objects, One Extensible Creation Canvas"
date: 2026-08-02
description: Inside Builderforce Creation Canvas's registry-driven architecture: 48 object kinds, ten palette groups, six semantic connection types, capability gates, safe AI context, and one contract shared by web and VS Code.
tags: [creation-canvas, architecture, integrations, mcp, ai-agents]
author: Sean Hogg
---

# 48 Live Objects, One Extensible Creation Canvas

A visual workspace becomes brittle when every card is a bespoke component and every integration invents a new behavior. Creation Canvas uses a registry-driven contract instead: **48 object kinds**, each with a known group, renderer, inspector, actions, mutable fields, connections, safe Brain context, and preview adapter.

![Product view of the Creation Object palette showing ten groups, representative live object cards on the canvas, capability badges, and the six semantic connection kinds](/blog/creation-object-registry-workspace.svg)

## Ten groups cover the work without flattening it

The palette organizes objects into Build, Data, Knowledge, Insights, Work, People, Agents, Models, Collaborate, and Integrations.

Build includes Workflow, Website, Chat, Dataset, WYSIWYG Prototype, Code, Browser preview, repository and editor artifacts, local services, and Video. Data includes Table, Spreadsheet, Chart, and KPI. Knowledge includes Documents, Slides, files, URLs, and knowledge items. Insights includes Dashboards, Reports, Evaluations, comparisons, Roadmaps, and Notes.

Work, People, Agents, Models, and Collaborate hold the planning, workforce, model, and multiplayer artifacts around delivery. Integrations currently exposes MCP tools as native objects rather than invisible chat configuration.

## Every object declares what Brain may do

The registry supplies default data, native actions, and an allowlist of mutable fields. A Website can edit, preview, and publish. A Dataset can import, profile, and visualize. A Project can expand and compare. An Agent can inspect, configure, and assign. Evermind can teach, train, evaluate, and publish. An MCP object can authenticate and execute.

Brain reads the same declarations that power the inspector. It cannot invent an unsupported field or action and have the canvas silently accept it.

![Each of the 48 object kinds passes through one registry contract for default data, rendering, inspection, native actions, mutable fields, safe AI context, preview, capability policy, and six allowed semantic relationships: data, control, reference, presentation, delivery, and membership](/blog/creation-object-registry-contract.svg)

## Six edges turn layout into a graph

Creation Canvas defines six semantic connection kinds:

- **data** — one object supplies values to another;
- **control** — one object drives or configures another;
- **reference** — one artifact cites or depends on another;
- **presentation** — one artifact presents another;
- **delivery** — an approved artifact moves toward execution;
- **membership** — a person, agent, or item belongs to a group or ritual.

Spatial proximity remains visual only. Meaning lives in the explicit edge.

## Capability gates preserve tenant policy

Some kinds—Evermind, MCP, Agent, LLM, Voice, and Video—declare platform capabilities. The palette filters them against the available capability set. A template can refer only to registered kinds, but installing it never bypasses tenant access or authentication.

## One transport-neutral contract spans surfaces

The object kinds, connection kinds, and revisioned command types live in a shared contract used by the web canvas and the VS Code surface. Both can therefore speak about the same object identity and graph operation without serializing one UI inside the other.

The command vocabulary covers graph replacement; object add, update, move, and delete; connection add and delete; and viewport changes. Server revisions provide the ordering and conflict boundary around those commands.

## Extensibility stays inspectable

The registry is more than a palette list. It is the place where an object declares what it is allowed to expose, accept, preview, and do. That makes new object kinds composable with Brain, collaboration, templates, and both client surfaces from the start.

The canvas can grow without becoming an untyped pile of cards.

[Explore the Creation Object palette →](/create/new)
