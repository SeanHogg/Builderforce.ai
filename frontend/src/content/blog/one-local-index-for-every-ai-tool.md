---
title: One local index for every AI tool on your machine
date: 2026-09-26
description: Synapse indexes your repositories on your own computer — every definition, a map ranked by what the code depends on, search by meaning — and hands that context to the VS Code agent, Claude Code and Cursor alike. Memories that name code you have since deleted are flagged instead of obeyed. Nothing is uploaded.
tags: [vs-code, agents, evermind, privacy, product]
author: Sean Hogg
---

# One local index for every AI tool on your machine

Watch an agent start a task in a large repository and count the calls before its first edit.

It greps for a word from your request. The word is not in the code — you described the behaviour, the code names it something else. It lists a directory. It reads a 2,000-line file to find one function, then the wrong neighbour of it, then reads the first file again because the window it needed has scrolled out of context. Ten, twenty, thirty calls of orientation, every one of them paid for, before anything changes.

Then you switch to a different tool and it does the whole thing again, because nothing it learned was kept anywhere another tool could read.

That is the gap: **every AI tool you use starts from nothing, and each one starts from nothing separately.**

## Synapse

Synapse is a small app that sits in your system tray and keeps one index per repository — on your machine, current to your last save.

```bf-figure
{
  "kind": "flow",
  "title": "What the index holds, and who reads it",
  "steps": [
    { "label": "Definitions", "note": "Every function, class and type, cut at its real boundaries — the unit an agent actually wants to read.", "hue": "idea" },
    { "label": "A map", "note": "Files ranked by how much the rest of the code depends on them, each with its most-used signatures.", "hue": "idea" },
    { "label": "Search by meaning", "note": "Identifier-aware keywords (\"membership\" finds resolveMembership) plus local embeddings, fused into one ranking.", "hue": "make" },
    { "label": "Every tool", "note": "The VS Code agent, Claude Code, Cursor and any MCP client read the same index.", "hue": "run", "tag": "one index" }
  ],
  "caption": "The file watcher re-indexes what you save, so the index describes the code as it is now — not as it was at the last rescan."
}
```

Three things change the moment it is running.

**The agent starts oriented.** Every turn's grounding carries the repository map, so the agent knows which modules matter before it opens one. And it gets `semantic_search`: ask "how do refunds reach the ledger?" and the answer is the function that does it — its path, its line range, its body — in one call.

**Every tool shares it.** The same index answers the Builderforce agent in VS Code and, through one MCP entry, Claude Code and Cursor. What you set up once serves all of them.

**Stale memory gets caught.** This is the part we did not expect to matter as much as it does.

## Memory that knows when it is wrong

Evermind remembers what earlier runs learned about your project: conventions, root causes, where things live. That memory is what stops the tenth run from re-deriving what the first one worked out.

It also goes wrong in the worst possible way. A memory that says "entitlements go through `resolveMembership()`" was right the day it was written. Three weeks later that function is gone — renamed, merged, deleted — and the memory is still confident, still specific, and now wrong. An agent that trusts it goes looking for code that does not exist, or worse, recreates it.

```bf-figure
{
  "kind": "compare",
  "title": "The same recalled memory, before and after",
  "columns": [
    { "title": "Without the index", "hue": "muted", "items": ["\"Use resolveMembership() for entitlements\"", "Agent searches for it", "Finds nothing, or an old copy", "Writes a new one beside the real code"] },
    { "title": "With Synapse", "hue": "make", "items": ["\"Use resolveMembership() for entitlements\"", "POSSIBLY STALE: resolveMembership no longer exists", "Agent checks the current code first", "Updates the memory instead of obeying it"] }
  ],
  "caption": "Every recalled memory and project fact is checked against the live index. Only names that are unambiguously code — paths and identifiers — are checked, so ordinary prose is never flagged."
}
```

With the desktop app running, every memory the agent recalls is checked against the index before the agent sees it. A path or symbol that no longer exists is attached to the memory as a warning. The agent verifies instead of obeying, and a memory that has gone out of date gets corrected rather than quietly steering work for another month.

## It stays on your machine

Indexing, chunking and embeddings all run locally. The embedding model downloads once, the index lives in your user profile — never inside the repository — and the app does not upload code anywhere. The loopback service it runs is guarded by a per-start key that only your user account can read, and it refuses requests from web pages outright.

```bf-figure
{
  "kind": "screen",
  "frame": "Synapse",
  "ratio": 1.4,
  "regions": [
    { "label": "Indexed workspaces", "note": "Scan and embedding progress per repository; rescan or remove", "x": 4, "y": 8, "w": 92, "h": 44, "hue": "idea" },
    { "label": "Connect your tools", "note": "VS Code is automatic; one command for Claude Code; one JSON block for Cursor", "x": 4, "y": 56, "w": 92, "h": 30, "hue": "run" },
    { "label": "Stays local", "x": 4, "y": 89, "w": 40, "h": 7, "hue": "accent" }
  ],
  "caption": "Open a folder in VS Code with the Builderforce extension and it registers itself; nothing to configure."
}
```

That matters beyond comfort. Plenty of teams cannot send source code to a hosted index at all — regulated work, client code under NDA, anything air-gapped. A local index is the difference between those teams getting codebase-aware agents and going without.

## Where it sits in the method

Every piece of work on Builderforce runs the same inner loop: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Read and Prove are free on purpose — they are how you decide whether the expensive act, Build, is worth doing.

Synapse is a **Read** feature, and Read is where agents were weakest. An agent that cannot read the codebase well does not skip reading; it reads badly, at Build prices — every orientation call billed like a build step, every re-read burning context the actual change needed. Making Read cheap and accurate is what makes the rest of the loop honest: Prove works from the real code, and Build starts from the right file.

The stale-memory check closes a quieter gap in the same act. Reading includes reading what you already know, and a memory is only knowledge while it is still true.

## What you can do with it today

- **Start an agent on an unfamiliar area** and let it find the function by describing what it does, instead of guessing the name.
- **Use Claude Code and Cursor on the same index** as the Builderforce agent — add it once from the app's Connect panel.
- **Trust recalled memory more** because the memory that has gone stale says so.
- **Work on code that cannot leave the building** and still give the agent full knowledge of it.

[Download Synapse](https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true) for Windows, macOS or Linux, then open a folder in VS Code with the Builderforce extension.

---

**Related reading:** [Read, Prove, Build — the inner loop](/blog/read-prove-build-the-inner-loop) · [The VS Code command center for your agentic workforce](/blog/vs-code-command-center-for-your-agentic-workforce) · [Ship from the editor](/blog/ship-from-the-editor-commit-branch-pull-request)
