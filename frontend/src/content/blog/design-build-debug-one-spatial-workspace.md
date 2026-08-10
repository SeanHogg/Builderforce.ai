---
title: "Design, Build, and Debug in One Spatial Workspace"
date: 2026-08-02
description: Connect Website and WYSIWYG prototypes to code, repository context, editor selections, diagnostics, terminal output, local services, and browser previews in one Creation Session.
tags: [creation-canvas, vscode, prototyping, developer-tools, debugging]
author: Sean Hogg
---

# Design, Build, and Debug in One Spatial Workspace

The most expensive part of design-to-code is often not implementation. It is reconstructing context: which concept was approved, which component implements it, which diagnostic matters, and whether the local preview reflects the current branch.

Creation Canvas can hold that chain as connected artifacts instead of a trail of links across tools.

![Product view of a design-to-debug Session with Website and mobile WYSIWYG artifacts connected to Repository, Editor selection, Diagnostics, Terminal output, Local service, and Browser preview objects](/blog/design-build-debug-workspace.svg)

## Design artifacts stay editable

A Website object represents a multi-page site concept with headline, body, call to action, accent, viewport, and pages. A WYSIWYG Prototype provides an interactive concept for more focused product work. Mockup and Mockup Set objects support individually reviewable feature concepts and delivery.

These objects can be revised directly or authored by Brain through their declared mutable fields. Preview remains a native object action rather than a screenshot pasted into conversation.

## Development context arrives from VS Code

The native BuilderForce VS Code surface can add a Repository, current Editor selection, Diagnostics, Terminal output, Local service, Code workspace, and Browser preview to the same server-backed Session.

Each object carries context appropriate to its type: repository URL and branch; selected code, language, path, and range; diagnostic items and severity; terminal content and exit code; or a local service URL and port. Terminal artifacts are explicitly marked for secret review, and sensitive context keys are excluded from Brain’s safe object adapter.

![Website, WYSIWYG Prototype, and Mockup form the design layer; Repository, Selection, and Code form implementation context; Diagnostics and Terminal provide failure evidence; Local service feeds Browser preview; approved output can become a governed Project Task](/blog/design-to-debug-object-graph.svg)

## Connect the failure to the thing it affects

Typed relationships make a debugging canvas useful. A Selection can **reference** a Prototype. Diagnostics can **reference** the Selection. A Local service can **control** a Browser preview. The preview can **present** the current Website. An approved Mockup can connect by **delivery** to a Task.

Brain can then answer a scoped question such as “Does this implementation satisfy the selected mobile concept, and what is blocking the preview?” using the relevant objects rather than the entire repository or a flattened transcript.

## Review before changing the workspace

If Brain proposes a code artifact, updates an acceptance criterion, rearranges the frame, or adds a relationship, those changes appear as a proposal set. Native operational actions keep their own permissions. A local anonymous canvas can sketch the complete implementation picture, but durable delivery and assignment wait for an account-backed workspace.

## One handoff, still one session

Product and design can contribute through the browser. Engineering can contribute through the editor. Neither surface is reduced to an embedded view of the other. The shared object graph becomes the handoff contract:

**approved intent → implementation context → diagnostic evidence → running service → browser result → governed delivery**

When the artifact, the code, and the failure live together, “what were we trying to build?” stops being a recurring debugging task.

[Start a design-to-code session →](/create/new)
