---
title: Escape Your Diagramming Tool — Visio, Lucidchart, Miro and Excalidraw, In
date: 2026-08-15
description: Practical migration routes out of the commercial diagramming tools, what each export format actually preserves, and how to turn a picture back into editable shapes.
tags: [diagrams, visio, lucidchart, miro, excalidraw, migration, creation-canvas]
author: Sean Hogg
---

# Escape Your Diagramming Tool

Diagramming tools are unusually good at hostage-taking. The work is valuable, the file is proprietary, and the export options are chosen so that the only lossless one is the one you cannot open anywhere else. Teams end up paying for a seat nobody uses, for the sole purpose of occasionally reopening a picture drawn four years ago.

This is a practical guide to getting that work out — what each route actually preserves, which one to take, and what to do when the only thing you have is a PNG.

[Open a Creation Canvas →](/create/new)

## The hierarchy of exports

Not all exports are equal, and the difference is whether **structure** survives or only **appearance** does.

```bf-figure
{
  "kind": "stack",
  "title": "What you get back, best to worst",
  "bands": [
    { "label": "Native format", "note": ".vsdx, .excalidraw, .drawio — shapes, labels, connections and which shape each arrow joins. Everything survives.", "hue": "good", "tag": "lossless" },
    { "label": "SVG", "note": "Shapes, labels and lines, but connections become geometry: the file no longer says which two boxes an arrow joins. Recoverable.", "hue": "prove", "tag": "structural" },
    { "label": "PDF", "note": "Vector, but shapes are drawn as paths with no identity. A rectangle is four line segments.", "hue": "measure", "tag": "marginal" },
    { "label": "PNG / JPG", "note": "Pixels. Nothing to recover. It can be embedded, annotated and redrawn beside — but not edited.", "hue": "bad", "tag": "terminal" }
  ],
  "caption": "Always take the highest one your tool offers. The gap between SVG and PNG is the gap between a diagram and a photograph of one."
}
```

## Visio → the canvas

**Take:** the `.vsdx` itself. Drop it on a board.

Visio is the most common inbound format and the one people most often assume is a dead end. It is not — a `.vsdx` is an OPC ZIP, the same container shape as a `.docx`, with the shapes in `visio/pages/page1.xml`.

What comes across: every shape's position and size, its text, the master it was drawn from (which is how a *Decision* master becomes a diamond and a *Terminator* becomes an ellipse), and its connectors — including which shapes each connector joins, taken from the `<Connects>` block that is the only place the file states it.

Two conversions happen on the way in, and they are the two things every naive Visio reader gets wrong: coordinates are in **inches from the bottom-left of the page**, and a shape is positioned by its **centre**, not its corner. Miss either and the drawing arrives upside down and half a shape out of place.

**Going back:** convert to Draw.io. Visio imports `.drawio` files, so that is the round trip. Writing `.vsdx` directly is not offered, and that is deliberate — a valid Visio package needs correct content types, three relationship parts, a document part and a masters part, and Visio does not degrade gracefully on a subtly wrong file. It refuses to open it at all.

**Multi-page drawings:** the first page is read. A canvas object is one diagram, and stacking five pages on top of each other would be worse than reading the one the file opens on.

## Lucidchart → the canvas

**Take:** `File → Export → Visio (.vsdx)` if your plan has it. Otherwise `SVG`.

Lucidchart's `.vsdx` export is good and takes the Visio route above. If you are on a plan without it — or the account has already lapsed, which is usually why you are reading this — export SVG and drop that.

An SVG dropped on the board stays an **Image**, on purpose: an SVG of a logo is a picture, and turning it into "a diagram with one mysterious rectangle" would be the opposite mistake. Select it and choose **Convert to a diagram**, and the shapes come back:

- `<rect>` becomes a box, rounded if it has an `rx`
- `<circle>` and `<ellipse>` become ellipses
- `<polygon>` is read by its corners — three points is a triangle, four sitting at the box mid-edges is a decision diamond, six is a hexagon
- `<line>`, `<polyline>` and straight `<path>` runs become connectors
- `<text>` whose anchor falls inside a shape becomes that shape's label; text belonging to nothing becomes a standalone label rather than being thrown away

The one thing an SVG cannot tell you is which two shapes an arrow joins — it only has coordinates. That is recovered geometrically: an arrow whose ends land inside two boxes *is* a relationship between them. Without that step, every connector would vanish the moment you converted the result to Mermaid.

## Miro → the canvas

**Take:** the board's PDF or image export for reference, and rebuild the parts that matter.

This is the honest answer. Miro's export is a picture, and there is no structure inside a picture to recover. What the canvas gives you is a better rebuild loop rather than a magic import:

1. Drop the export on the board — it lands as an Image.
2. Put a Diagram object beside it and ask Brain to redraw it in Mermaid, using the image as reference.
3. Correct the result in text, which takes minutes rather than the hours of re-dragging boxes.

The image stays on the board next to the diagram, so the source is visible while you check the copy.

## Excalidraw → the canvas

**Take:** the `.excalidraw` file.

The most complete import of the lot, because Excalidraw's format is honest JSON with real geometry and real bindings — `startBinding` and `endBinding` say exactly which elements an arrow connects. Rectangles, diamonds and ellipses map straight onto shapes, bound text becomes labels, deleted elements are left out.

One trap worth naming: Excalidraw also exports as `.excalidraw.json` and sometimes a bare `.json`. That extension used to send the scene to the data importer, and a workshop sketch became a spreadsheet with one row whose cells were JSON fragments. It is now recognised by its `type: "excalidraw"` declaration rather than by its file name, so it arrives as the drawing it is whatever it is called.

**Going back:** Excalidraw is a full conversion target. Exports are deterministic — the same diagram produces byte-identical output every time, rather than a new file on every export, so it diffs.

## draw.io / diagrams.net → the canvas

**Take:** the `.drawio` file, or `.xml`.

Native both ways. Compressed files are handled — draw.io writes either plain mxGraph XML or a deflate-compressed, URI-encoded payload, and both arrive correctly. Files written *out* are always uncompressed, on purpose: a plain file diffs in a pull request, an agent can edit it as text, and it can be re-read without a decompression step.

## Confluence / Sphinx / internal wikis → the canvas

**Take:** the `.puml` source, which is usually sitting in the page macro or the repo already.

PlantUML's component vocabulary — `rectangle`, `card`, `usecase`, `database`, `node`, `hexagon`, `file` — reads directly, along with the `[Component]` and `(Use case)` shorthands. Sequence and activity syntax are deliberately not converted; they are not graphs of boxes, and flattening them would produce something that renders and misleads.

## Generated graphs → the canvas

**Take:** the `.dot` or `.gv` your tooling already emits.

Dependency graphs, call graphs and build DAGs mostly come out of their tools as DOT. Labels, shapes, fills and edge attributes all read across, including the default-attribute statement (`node [shape=box]`), which matters because Graphviz's own default is an ellipse — a file that overrides it means it.

## Process tools → the canvas

**Take:** the `.bpmn` file.

BPMN from Camunda, Flowable, Zeebe or bpmn.io reads with its real coordinates when the file carries diagram interchange. When it does not — which is routine for code-generated BPMN — the process is laid out from its sequence flows instead of being refused. A process with no drawing is still a process, and that is exactly the case where seeing it matters most.

## When the destination cannot carry everything

Conversions between geometry and text notations are not always total, and the canvas says so rather than letting you find out later.

```bf-figure
{
  "kind": "compare",
  "title": "Two things that can be lost, and what happens",
  "columns": [
    {
      "title": "Told at the moment of conversion",
      "hue": "good",
      "items": [
        "Connections a text notation cannot express, counted in the result notice",
        "Layout, when converting geometry → text (the layout engine re-places everything)",
        "Exact styling beyond fill, stroke and dash"
      ]
    },
    {
      "title": "Never silently dropped",
      "hue": "prove",
      "items": [
        "An arrow whose endpoints were only geometry — recovered before writing",
        "Text that belongs to no shape — kept as a standalone label",
        "A shape with no exact equivalent — mapped to the nearest, never discarded"
      ]
    }
  ],
  "caption": "A text notation can only say \"A connects to B\". An arrow that joins nothing is reported as dropped, with a count, rather than quietly disappearing."
}
```

The three read-only formats — Visio, ArchiMate and SVG — are never offered as a *destination*, so the conversion menu cannot fail after you click it. It shows exactly the notations that will work for the object you have selected, which for a photograph is only Draw.io, where it is embedded rather than pretending to be shapes.

## A migration you can do this afternoon

```bf-figure
{
  "kind": "flow",
  "title": "Getting a team's diagrams off a licence",
  "steps": [
    { "label": "Export natively", "note": "Take .vsdx / .excalidraw / .drawio wherever the tool offers it; SVG where it does not", "hue": "read" },
    { "label": "Drop them on a board", "note": "Each becomes an editable diagram object, with its shapes and connections intact", "hue": "prove" },
    { "label": "Convert what will be maintained", "note": "Anything that changes with the code becomes Mermaid — text, in the repo, reviewable in a pull request", "hue": "build" },
    { "label": "Leave the rest as draw.io", "note": "Diagrams that are sent rather than maintained keep their exact layout, in a format everyone can open", "hue": "reach" },
    { "label": "Cancel the seat", "note": "Nothing left on the board needs the original tool to open it", "hue": "expand" }
  ]
}
```

The split in steps three and four is the one that matters. Diagrams that describe a moving system should be text, because a picture of an architecture goes stale the day after it is drawn and nobody notices. Diagrams that will be handed to somebody should be draw.io, because layout is the message and universal openability is the point.

Related reading: [Every diagram format the canvas reads and writes](/blog/every-diagram-format-the-canvas-reads) for the full notation reference, and [Which diagram should you draw?](/blog/which-diagram-should-you-draw) for choosing the type before the tool.

[Open a canvas and drop a file in →](/create/new)
