---
title: Point it at a folder and see what it knows
date: 2026-10-28
description: Agents now write more files than anyone reads. Point BuilderForce at any folder, code or docs, and see its shape as a 3D knowledge graph: broken layers, duplicated code, contradicting claims and broken links, each with a one-click fix. Questions about the folder are then answered from memory, often without a model call.
tags: [knowledge-graph, code-quality, documentation, memory, agents, product]
author: Sean Hogg
---

# Point it at a folder and see what it knows

A year ago you read the code before you merged it. Today an agent writes forty files in an afternoon, and nobody reads all forty. The same is happening to documents: specs, contracts, research notes and policies that an agent drafted, revised and drafted again.

You can't read it all, and you don't need to. What you need is to judge the **shape**. Is it layered the way you meant? Is the same thing written twice? Does one document say the opposite of another? Do the links still go somewhere?

Until now, nothing showed you that. Now you point BuilderForce at a folder and it shows you.

## Ask it to look

From VS Code, from Rovr or on the web canvas, type `/review ./contracts`, or just ask: "review the billing folder". In VS Code you can also right-click a folder and choose **Review with BuilderForce**.

Before anything runs you see what the review will do: how many files it will read, how many are unchanged since last time, and roughly how many model calls and how much money the judgement pass will cost. You say yes, and the graph builds while you watch.

```bf-figure
{
  "kind": "flow",
  "title": "From a folder to a graph you can act on",
  "steps": [
    { "label": "Point", "note": "Any folder: code, docs or both. Type /review, ask in plain words, or right-click it in VS Code.", "hue": "read" },
    { "label": "Confirm", "note": "See the file count, what is unchanged and the approximate cost before anything is spent.", "hue": "accent", "tag": "you decide" },
    { "label": "See", "note": "A 3D graph of the folder opens, with every problem it found already marked.", "hue": "build" },
    { "label": "Fix", "note": "Every finding has Fix with agent. One click hands the request to your composer.", "hue": "good" }
  ],
  "caption": "A second review only re-reads the files that changed, so keeping the picture current costs close to nothing."
}
```

## What you see

The folder opens as a 3D graph you can orbit, zoom and fly through with a mouse or a finger. Code sits on planes, one per layer. Documents sit by folder and section. The bigger a node, the more the rest of the folder depends on it. Every arrow points from the thing that uses to the thing being used, and the arrows that break your rules are lit up.

```bf-figure
{
  "kind": "screen",
  "frame": "A reviewed folder, in VS Code",
  "ratio": 1.62,
  "regions": [
    { "label": "The folder in 3D", "note": "Layers as planes, areas as clusters, size as importance", "x": 4, "y": 8, "w": 62, "h": 66, "hue": "build" },
    { "label": "Findings", "note": "Broken layers, duplicates, contradictions, broken links", "x": 69, "y": 8, "w": 27, "h": 44, "hue": "bad" },
    { "label": "Fix with agent", "note": "On every finding", "x": 69, "y": 56, "w": 27, "h": 18, "hue": "good" },
    { "label": "Lenses", "note": "Structure, layers, duplication, claims, links, compare", "x": 4, "y": 80, "w": 62, "h": 14, "hue": "accent" },
    { "label": "Ask", "note": "Answered from memory", "x": 69, "y": 80, "w": 27, "h": 14, "hue": "read" }
  ],
  "caption": "One view on every host. VS Code, Rovr and the web canvas draw the same graph of the same folder."
}
```

Switch lenses to ask a different question of the same folder:

- **Layers.** Which files reach past the layer they belong to, and which ones form a loop.
- **Duplication.** Code copied from one place to another, and sections or whole documents that say nearly the same thing.
- **Claims.** Where one document contradicts another, and where they agree.
- **Links.** Every reference between documents, with the broken ones flagged.
- **Unused.** Files, exports and dependencies nothing uses any more.
- **Compare.** This review against the last one, so you can see what got better and what got worse.

Pick any file and **trace** it. In code you get a layer sequence: which layer called which, and where a call skipped a layer or climbed back up. In documents you see how one reaches another through links and citations. Either trace copies out as a diagram you can paste into a pull request.

## Fix it from where you found it

Every finding has **Fix with agent**. It does not open a new chat or a separate tool. It puts a ready-made request in the composer you already use: "Consolidate clone group #3", "Move the database import behind a port", "Reconcile section 4.2 of a.md with section 2 of b.md", "Repair 3 broken links". You read it, change it if you want, and send it. If you know something about a file that the graph should remember, **Add fact** pins it to that file for every person and every agent on the project.

## Ask, and often no model is needed

Once a folder is reviewed, it is in memory. Questions about it are answered from that memory instead of from a fresh read of every file.

```bf-figure
{
  "kind": "compare",
  "title": "Asking about a folder",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["Ask the agent a question", "It opens and reads file after file", "You pay for every file it reads", "Ask again tomorrow and it reads them all again"] },
    { "title": "Now", "hue": "read", "items": ["Ask the agent a question", "The answer comes from the graph in memory", "Often settled with no model call at all", "Ask again tomorrow and it is just as fast"] }
  ],
  "caption": "/dup, /graph, /review and questions like \"where is billing handled\" are recognised before any model is called. When the graph is sure, it answers; when it is not, the model starts with the facts instead of hunting for them."
}
```

Type `/dup` and the duplicates are listed. Type `/graph` and the view opens on the files you named. Ask "what does the lease say about termination" or "where is billing handled" and the answer comes back with the places it came from and what sits next to them. When the graph alone can answer, no model is called and nothing is spent. When it can't, the model starts from the facts the graph found instead of spending turns looking for them.

## Where it sits in the method

The graph serves two stages on the [Idea to Real](/blog/idea-to-real-the-operating-methodology) arc, one for each kind of folder.

**For documents, it is Idea → Read.** [Read](/blog/read-prove-build-the-inner-loop) asks one question: *what did you actually say?* When "what you said" is thirty specs and a folder of contracts, the honest answer includes the places they disagree. Reading every file was the only way to find those. Now the contradictions, the near-copies and the dead links are on screen before anyone decides what to build, and Read stays the cheap act it is meant to be.

**For code, it is Make → Build.** Build is the act that spends: agents, run budget, deploys. Its question is *is it real?*, and once agents write the lines, the answer depends on the shape: does it keep its layers, is it built once, does anything still use this. Line-by-line review stops scaling when you no longer write the lines. Judging the shape does, and a broken layer caught on the day it appears is far cheaper than the same one found after three more features have leaned on it.

## What you can do with it today

- **Review any folder**, code or docs, from VS Code, Rovr or the web canvas, and see what it will cost before it starts.
- **See where your layers break** and which files form a loop, on a graph you can fly through.
- **Find duplicated code and near-duplicate documents** before they drift apart.
- **Catch documents that contradict each other** and links that no longer go anywhere.
- **Trace any file** through the layers or documents it reaches, and copy the trace as a diagram.
- **Fix any finding with an agent** in one click, from the composer you already use.
- **Ask about the folder** and get answers from memory, often without paying for a model call.
- **Watch the debt go down** by comparing this review with the last one.

---

**Related reading:** [Read, Prove, Build: the inner loop](/blog/read-prove-build-the-inner-loop) · [Memory-first inference: skip the LLM](/blog/memory-first-inference-skip-the-llm) · [One local index for every AI tool](/blog/one-local-index-for-every-ai-tool)

[Open a canvas](/create) and type `/review` followed by the folder you have stopped reading.
