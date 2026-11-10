---
title: The agent run "worked". Now you can see what went wrong in it
date: 2026-11-09
description: An editor agent spends three million prompt tokens, makes thirteen changes and gets stopped, and the report says Inconclusive. The Agent runs drawer in the VS Code Visualizer reads the recorded run and names every problem in it, with the turn, the tool and the file as evidence.
tags: [agents, vscode, observability, knowledge, product]
author: Sean Hogg
---

# The agent run "worked". Now you can see what went wrong in it

You ask the editor agent for a few more visualizations. Thirteen and a half minutes later it has made thirteen changes, the token meter has climbed past three million, and something in the file it touched last no longer compiles. You stop it.

Then you try to work out what happened, and you can't. The run did not crash, so there is no error to read. The model answered every turn, so nothing timed out. The diagnostics report looked at the whole thing and returned one word: **Inconclusive**.

That run is real. Afterwards we replayed its recorded trace by hand, and every problem was in there: 21 turns of reading before the first change, 13 turns that each made exactly one edit while re-sending about a hundred thousand tokens of conversation, not one typecheck or test, and an edit that closed an object one brace too early. All of it had been recorded, and nothing had pointed at it.

## The Agent runs drawer

The Visualizer in VS Code now has an **Agent runs** drawer. It lists your recent editor-agent runs for the project you are looking at. Pick one and it reads the recorded run and tells you what went wrong in it.

```bf-figure
{
  "kind": "screen",
  "frame": "Visualizer · Agent runs",
  "ratio": 1.62,
  "regions": [
    { "label": "Recent runs", "note": "Each with its models, turn count and findings by severity", "x": 3, "y": 6, "w": 24, "h": 88, "hue": "idea" },
    { "label": "Turn strip", "note": "One bar per turn: read, write, forced or failed. Height is prompt tokens", "x": 30, "y": 6, "w": 67, "h": 22, "hue": "run" },
    { "label": "Findings", "note": "What went wrong, worst first, each with its turn, tool and file", "x": 30, "y": 32, "w": 42, "h": 62, "hue": "measure" },
    { "label": "Files touched", "note": "Written or checked, one click from the knowledge map", "x": 75, "y": 32, "w": 22, "h": 62, "hue": "make" }
  ],
  "caption": "The run that used to say Inconclusive: a long flat stretch of read turns, then a row of thin single-write turns, each one tall with prompt tokens, and no check anywhere in the strip."
}
```

It doesn't summarise with a model. Each finding comes from a fixed check over the recorded turns, so the same run gives the same findings every time, and every one shows you where it came from.

- **Analysis that never ended:** many read-only turns before the first change, and whether the plan budget had to force the hand-off.
- **Readiness it didn't act on:** the agent said it was ready, then kept reading.
- **One write per turn:** a run of turns that each made a single change, with the prompt tokens those turns cost between them.
- **Prompt bloat:** how much prompt the run sent for each token it wrote back, and what each change cost.
- **Written, never checked:** files changed with no typecheck, test, lint or diagnostics call after them.
- **Broken bracket balance:** an edit whose new text opened or closed more braces, brackets or parentheses than the text it replaced.
- **Churn:** the same file rewritten again and again.
- **Filed, then done inline:** tickets created during the run, never handed to anyone, and then built by the session itself.
- **Slow and oversized turns:** turns over a minute, and tool calls carrying kilobytes of repeated arguments.
- **Stopped unverified:** the run ended on your Stop with unchecked changes still outstanding.

On the run above, the drawer names 13 findings. Nothing comes back Inconclusive.

```bf-figure
{
  "kind": "compare",
  "title": "The same run, read two ways",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["13 m 38 s, 3.06 M prompt tokens", "Stopped by hand", "Report: Inconclusive", "Open the trace and count turns yourself"] },
    { "title": "In the Agent runs drawer", "hue": "measure", "items": ["21 read turns before the first write; the plan budget forced the hand-off", "13 single-write turns and the prompt they re-sent", "Every written file, none checked", "labels.ts: one brace closed early, at the turn and edit that did it", "Stopped with unverified changes", "13 findings in all, each with its evidence"] }
  ],
  "caption": "Nothing new was recorded. Every finding was already in the trace; the drawer is what reads it."
}
```

## The agent catches it on the turn, too

A drawer that explains a bad run afterwards is useful. It's better if the run doesn't go bad. So the editor agent now gets two signals back on every edit:

```bf-figure
{
  "kind": "flow",
  "title": "What comes back from an edit now",
  "steps": [
    { "label": "Edit", "note": "The agent changes a file.", "hue": "make" },
    { "label": "Diagnostics", "note": "The language server's errors for that file come back on the edit's own result, alongside any other note on that result.", "hue": "run" },
    { "label": "Balance", "note": "If the change opened or closed more brackets than it replaced, the result says so, even when no checker is set up.", "hue": "run" },
    { "label": "Next turn", "note": "The agent fixes the file it just broke instead of building on top of it.", "hue": "measure", "tag": "same run" }
  ],
  "caption": "The brace that broke labels.ts would now be reported on the edit that broke it, not found by a person at the end of the run."
}
```

## What you can do with it today

- **Open any recent editor-agent run** and see, in seconds, where its time and tokens went.
- **Point at the turn, the tool and the file** behind each problem instead of describing it from memory.
- **See which files a run changed and never checked**, and jump from any of them to the knowledge map.
- **Let the agent catch its own broken edits**: language-server errors and a bracket warning come back on the edit itself.

## Where it sits in the method

Idea to Real runs Idea, Make, Run and Measure, and the inner loop is [Read, Prove, Build](/blog/read-prove-build-the-inner-loop): understand what is there, prove the claim cheaply, then spend on building. We ask that of the work, and the agent doing the work should meet the same standard.

An agent run is a build, and until now it had no Measure. You could see that it finished or that you stopped it, but not whether it read for too long, wrote without checking or broke something along the way. The Agent runs drawer is the Measure for the agent, and the checks it runs are proofs over the recorded run. A finding says what happened, at which turn, in which file. The edit-time diagnostics and the bracket warning move part of that proof inside the run, onto the step that would otherwise have failed quietly.

```bf-figure
{
  "kind": "compare",
  "title": "Measure, applied to the agent",
  "columns": [
    { "title": "Read", "hue": "idea", "items": ["How many turns went to reading", "Whether the readiness it claimed held"] },
    { "title": "Prove", "hue": "measure", "items": ["Every written file has a check after it, or a finding", "Every edit keeps its brackets balanced, or says so on the spot"] },
    { "title": "Build", "hue": "make", "items": ["What each change cost in prompt tokens", "Whether filed tickets were handed off or done inline"] }
  ],
  "caption": "The same three questions we ask before building anything, asked of the run that did the building."
}
```

---

**Related reading:** [Read, Prove, Build: the inner loop](/blog/read-prove-build-the-inner-loop) · [One agent, one kernel](/blog/one-agent-one-kernel) · [Pack the knowledge your review proved](/blog/portable-knowledge-packs)

Open the Visualizer in VS Code, open **Agent runs**, and pick the last run that didn't go the way you expected.
