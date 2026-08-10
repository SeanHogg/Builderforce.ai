---
title: Creation Canvas Guide: Build, Analyze, Collaborate, and Work in 3D
date: 2026-08-09
description: A practical guide to Creation Canvas functionality, including objects, Brain scope and review, file and data workflows, 2D and 3D navigation, collaboration, and export.
tags: [creation-canvas, how-to, brain, 3d, collaboration, data]
author: Sean Hogg
---

# Creation Canvas Guide: Build, Analyze, Collaborate, and Work in 3D

Creation Canvas is a spatial workspace for turning a request into connected, editable outputs. Instead of hiding the work inside one long chat, it represents the result as objects: documents, datasets, diagrams, plans, agents, workflows, websites, models, and more.

This guide explains the core functionality and a simple way to use it on a real project.

[Start with a blank canvas →](/create/new)

## 1. Begin with an outcome

You can open a blank canvas, start from a template, or describe the outcome you want. A useful prompt includes the goal, audience, source material, and the deliverables you expect.

For example:

> Analyze the attached customer feedback, identify the five strongest themes, create a prioritized roadmap, and prepare an executive presentation with the supporting evidence.

That request can become several connected objects rather than one response: a Dataset, analysis table, Chart, Roadmap, and Slides deck. Each remains independently inspectable and editable.

You can also drag supported files directly onto the board. The canvas chooses an appropriate object type so a spreadsheet becomes data, a document remains readable, and a diagram remains visual.

## 2. Organize work with objects and relationships

Every card on the board is a typed object with its own fields, actions, renderer, and export behavior. Move objects freely, resize supported cards, connect related work, and use frames to create meaningful areas such as Research, Decision, Build, and Delivery.

Connections are more than decorative arrows. They make dependencies visible and give Brain structured context. Connect a Dataset to the Chart derived from it, a Brief to the Website it produced, or an Evaluation to the model it governs.

Use the canvas command rail to zoom, fit the board, arrange objects, open the Files collection, toggle the mini map, enter full screen, or switch to the 3D view. Placement locks prevent accidental movement when a layout is settled, while hidden objects can reduce visual noise without deleting work.

## 3. Give Brain the right scope

Brain can work with the whole canvas, the current selection, or a frame. Choose scope before prompting when the distinction matters:

- **Canvas** is useful for summaries, dependency checks, and cross-project synthesis.
- **Selection** is best for focused editing or comparing a few objects.
- **Frame** gives Brain a named working area without exposing unrelated objects.

Brain can read objects, add and update supported fields, arrange the board, create typed connections, and invoke actions declared by an object. Consequential changes enter a proposal set first. Review the concrete additions, edits, connections, layout changes, and actions, then apply only what you want.

This makes the conversation operational without making it opaque. Brain can participate in the work, while the canvas shows what it intends to change.

## 4. Analyze complete datasets

Select a Dataset to inspect its columns, sample rows, and profile. For deeper work, ask Brain to query the dataset. It can filter rows, derive new classifications, group records, compute aggregates, sort results, and limit the output.

A productive sequence is:

1. Profile the dataset to verify types, missing values, distinct counts, and ranges.
2. Ask a specific question with a measurable grouping or threshold.
3. Materialize the result as a Table, Chart, Dashboard, or KPI.
4. Connect that result back to the source Dataset.
5. Add a Document or Slides object to explain the finding in context.

Because analysis runs across the imported rows, the resulting object is evidence you can inspect rather than a figure copied from a conversational summary. If the data contains locations, the Dataset inspector can also plot them on a map.

## 5. Work with documents, decks, diagrams, and sheets

Knowledge objects are live working surfaces on the canvas:

- Edit document or diagram source from the inspector and see the artifact on the card.
- Review a presentation as individual slide thumbnails.
- Click cells or headers in Table and Spreadsheet objects to edit them in place.
- Use the Files panel to search everything the session has created or delivered.
- Export from the object, inspector, Files panel, or a reviewed Brain action through the same artifact pipeline.

This is useful when a project crosses formats. Research can become a document, its evidence a table, its narrative a deck, and its process a diagram without scattering the work across unrelated tools.

## 6. Read and edit the board in 3D

The 3D command lifts the graph into a rotatable spatial view. Dependency depth or object groups can define the base planes, helping you see structure that is difficult to trace across a crowded flat board.

The view is interactive:

- Drag to orbit the space; use Shift-drag or the middle mouse button to pan.
- Pinch on touch devices to pan and zoom.
- Drag an object across its plane to update the same position used in 2D.
- Shift-drag an object through depth to lift it away from its base plane.
- Move a selection together, focus the current selection, or drop floating objects back to their layers.
- Toggle layer guides when you want a cleaner view.

A lifted object retains a tether to its plane, and locked placements remain locked. Switching between 2D and 3D does not create a second layout: both views operate on the same canvas state.

## 7. Collaborate without stopping the work

Use Share to invite collaborators to the current canvas. Guest rooms support a small live group without requiring everyone to create an account first. Participants see the shared board and roster, while the latest board snapshot lets someone joining later enter the current state.

For a guided review, use the live session controls to present, follow another participant, or share a screen. Navigation does not have to end the session: supported destinations open beside the board, and the live room continues while you consult other parts of Builderforce.

On a touch device, the canvas supports direct navigation and object interaction. The same canvas implementation is also available in VS Code, keeping the visual workspace close to the code when the project moves into implementation.

## 8. Finish with a deliverable and an audit trail

Before exporting, use the accessible outline or Files panel to check that the expected objects exist. Review connections, unresolved evaluations, and any Brain proposals that have not been applied. Canvas diagnostics can summarize visible state, recent actions, timings, failures, scope changes, and mutations when you need to understand how the session unfolded.

Then export each artifact in its native form or use its declared delivery action. The canvas remains the system of work: the output can leave, but the sources, relationships, decisions, and history remain available for the next iteration.

## A useful first project

If you want to explore most of the functionality in one session, attach a small CSV and ask Brain to profile it, create a chart, summarize the finding in a document, and build a five-slide presentation. Review the proposed changes, arrange the objects into a frame, inspect the graph in 3D, then share the canvas and export the deck.

That path covers the central Creation Canvas loop: bring in evidence, turn it into connected artifacts, review agent work, collaborate around the result, and deliver it in a form another person can use.

[Build your first canvas →](/create/new)
