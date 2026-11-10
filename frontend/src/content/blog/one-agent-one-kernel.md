---
title: One agent, one kernel — every Builderforce surface now runs the same engine
date: 2026-11-08
description: Your chat in VS Code, the web app, Rovr and the on-prem channels used to be four runtimes that could disagree. They are now one execution core — one loop, one tool policy, the same rules, guards and verification, wherever you work.
tags: [agents, architecture, vscode, web, product]
author: Sean Hogg
---

# One agent, one kernel — every Builderforce surface now runs the same engine

Start a chat with an agent in VS Code, then pick it up in the browser mid-thread, and the agent that answers you there has the same tools, follows the same rules and guards, and has its work checked by the same verification. A fix you get in one place is a fix in every place.

That only works if the thing answering you is the same thing everywhere. For a long time it wasn't: the editor, the web app, Rovr and the on-prem channels each had their own run loop, their own tool wiring, and — on a bad day — four different answers to the same question.

Now **the surface changes, but the agent doesn't.** One execution core runs every chat, on every host.

## One loop, not four

There is now a single agent loop. The old per-surface run loops are gone — deleted, not deprecated — so there is no second engine hiding behind a flag waiting to drift. The one loop is the only path a turn can take, whether the turn starts in the editor's chat rail, the web canvas, Rovr in the browser, or a channel like Slack.

```bf-figure
{
  "kind": "flow",
  "title": "One loop behind every surface",
  "steps": [
    { "label": "Your chat", "note": "VS Code, web, Rovr, or a channel — the surface is a view, not an engine.", "hue": "make" },
    { "label": "The one kernel", "note": "A single run loop and tool policy executes every turn.", "hue": "run" },
    { "label": "Same checks", "note": "Same tools, same guards, same verification — whichever surface you used.", "hue": "measure" }
  ],
  "caption": "The surface renders the conversation; the kernel has it."
}
```

## Why it matters

- **A conversation is portable.** Start on the desktop, continue in the browser — the agent's state, memory and tool access come with you because they were never tied to a surface.
- **A fix is a fix.** Harden the tool policy once and every host inherits it. There is no "works in the editor but not on the web" class of bug left.
- **One thing to verify.** A single conformance oracle replays the reference scenario against the one engine, so "is the agent correct" has one answer, not four.

## Where it sits in the method

This is the **Make** stage made trustworthy: the agent that builds is the same agent everywhere you meet it. Reliability you can carry across surfaces is what lets the rest of the arc — Run, Measure — stand on it.

## What you can do with it today

Open the same chat in two surfaces and watch them agree. Move a conversation from the editor to the browser mid-thread. The kernel is the constant; the surface is wherever you are.
