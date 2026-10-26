---
title: One chat, a whole team working
date: 2026-10-11
description: The agent in your chat can now hand slices of the work to sub-agents that run side by side, in the editor or in the cloud. You see each one by name, can redirect or stop any of them, and the agent you are talking to stays free to answer you.
tags: [agents, product, vscode]
author: Sean Hogg
---

# One chat, a whole team working

Give an agent a spec with eight workstreams and watch what happens: it does them one at a time. The migration, then the API routes, then the scheduler, then the UI, then the tests. Each step waits for the one before, even when they have nothing to do with each other. An afternoon of work takes the afternoon.

People don't work like that. A lead splits the work, hands each piece to someone who owns it, keeps an eye on all of them, and pulls it together at the end. Until now, an agent could only *pretend* to do that. It could start a helper, but then it sat and waited for the helper to finish. The helper had a step limit. You couldn't see or speak to it. And on some cloud runtimes it did not exist at all.

That is the gap: **one chat could only ever do one thing at a time, and the work that could have run in parallel waited in line.**

## Hand off, keep going

Now the agent in your chat can hand slices of the work to **sub-agents**, and they start immediately and work side by side. The agent that started them doesn't stop. It keeps planning, keeps coding the part it kept for itself, or starts more sub-agents.

```bf-figure
{
  "kind": "flow",
  "title": "From one request to parallel work",
  "steps": [
    { "label": "Split", "note": "The agent reads the spec and splits it into slices. Each slice gets its own files, so no two sub-agents edit the same thing.", "hue": "idea" },
    { "label": "Hand off", "note": "Each slice starts as a sub-agent with its own name, or as a teammate from your workspace. They all start at once.", "hue": "make", "tag": "parallel" },
    { "label": "Work", "note": "Sub-agents work side by side with no step limit. Their messages appear in the chat under their own names.", "hue": "make" },
    { "label": "Pull together", "note": "Each sub-agent reports back when it is done. The lead builds and tests the combined change, fixes what the slices broke between them, and commits.", "hue": "run" }
  ],
  "caption": "A sub-agent is the same agent run as any other, with one difference: it knows who it works for and reports back to them."
}
```

A sub-agent can be anonymous ("port the auth middleware") or one of your workspace's own agents ("Ada, take the schema"). If a coding slice has nobody suited to it, the chat staffs a Developer for it, assigns the ticket and runs the slice as that Developer. The board shows who owns what.

## You can see everyone, and talk to anyone

A team you can't see is not a team you can manage. Every working sub-agent appears in the chat's **Agents** list beside the agents you invited, with its handle and who started it. A live strip under the conversation shows what each one is doing right now.

```bf-figure
{
  "kind": "screen",
  "frame": "BuilderForce — chat",
  "ratio": 1.5,
  "regions": [
    { "label": "Agents (4)", "note": "Invited agents and live sub-agents together: “Verify frontend · a3 — sub-agent of BuilderForce”", "x": 4, "y": 6, "w": 92, "h": 16, "hue": "accent" },
    { "label": "Their messages, under their names", "note": "“QA TESTER — sub-agent of Verify frontend · a4”", "x": 4, "y": 26, "w": 92, "h": 36, "hue": "make" },
    { "label": "Sub-agents", "note": "What each is doing now · Redirect · Stop · Stop all", "x": 4, "y": 66, "w": 92, "h": 28, "hue": "run" }
  ],
  "caption": "A sub-agent can start its own sub-agents for part of its slice, up to three levels deep. The chat shows who works for whom."
}
```

To redirect one, just talk to it. `@Ada only do the API half` reaches that sub-agent's next step. Mentioning a ticket it is working on (`#2826 the draft cards need an empty state`) reaches it too. **Stop** stops one, and **Stop all** stops every sub-agent at once.

And the agent you are talking to stays yours. If it is waiting for its sub-agents and you send it a message, it stops waiting and answers you. The sub-agents keep working, and their reports still reach it.

## The same team in the editor and the cloud

Most tools that do this do it in one place. Here it is one way of working wherever the work runs.

```bf-figure
{
  "kind": "compare",
  "title": "Where a sub-agent can run",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["The lead stopped until the helper finished", "Helpers hit an 8-step limit", "Helpers had no name in the chat", "Some cloud runtimes could not start one"] },
    { "title": "Now", "hue": "make", "items": ["The lead keeps working while sub-agents work", "No step limit — a sub-agent ends when its slice is done", "Every sub-agent is named, listed and reachable", "Same behaviour in VS Code and on every cloud runtime"] }
  ],
  "caption": "In the cloud, each sub-agent is its own run with its own record, and its tokens count toward the run that started it."
}
```

When something goes wrong, you can see where. **Copy diagnostics** now includes every sub-agent the chat started, finished ones included. It lists who started each one, the models it used, the steps that failed, the files it changed and what it reported.

## Where it sits in the method

Builderforce work moves along one arc — **Idea → Make → Run → Measure** — and each act runs the same inner loop: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

Sub-agents are a **Make** feature, and they change the **Build** step most. Build is where the expensive work happens, and it is where a single line of work hurts most: every slice waits for the last. Splitting it means the cost of Build is the longest slice, not the sum of them.

They also keep **Prove** honest. Every sub-agent ends with the same short report: what it changed, what it checked, and the open issues it left. The lead owns each open issue until it is fixed. The checking itself goes to a verify sub-agent on a cheaper model, which runs the type-check and tests that cover the change and reports every failure word for word. The lead fixes what it finds, and only a passing check is committed. Parallel work, one verdict.

## What you can do with it today

- **Hand a multi-part spec to one chat** and have its workstreams run side by side.
- **Delegate to your own agents by name**, or let the chat staff a Developer for a slice nobody fits.
- **See and steer every sub-agent**: redirect it with `@name` or a `#ticket`, stop one, or stop them all.
- **Run the same way in the cloud**, where each sub-agent is its own run on its own record.

Update the BuilderForce extension in VS Code to 2026.10.22 or later to get all of this.

---

**Related reading:** [Read, Prove, Build — the inner loop](/blog/read-prove-build-the-inner-loop) · [Teach it once, and it does it again](/blog/teach-it-once-and-it-does-it-again)
