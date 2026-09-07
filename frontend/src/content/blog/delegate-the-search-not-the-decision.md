---
title: Delegate the search, not the decision
date: 2026-09-07
description: An agent that spends twenty turns finding one file has no room left to think about it. Sub-agents send that search to a second agent with its own context and bring back one paragraph — on every surface an agent runs on, and now they can make the change too.
tags: [agents, sub-agents, context, cloud-agents, vscode, product]
author: Sean Hogg
---

# Delegate the search, not the decision

Ask an agent to change how sessions expire and watch what it actually does. It lists a directory. It reads a file that turns out to be the wrong one. It searches for `expiry`, gets forty hits, reads four of them, searches again for `ttl`, finds the real thing on the sixth try. Then — twenty turns in, with the answer finally in hand — it starts on the change you asked for.

Every one of those dead ends is still in its context. The wrong file is in there in full. So is the forty-hit search. By the time the agent reaches the part that needs judgement, the part that needed judgement is competing for room with a directory listing it read by mistake.

That is not a thinking problem. It is a filing problem.

## What a sub-agent is

A sub-agent is a second agent that runs the search **in its own context** and reports back one answer.

```bf-figure
{
  "kind": "flow",
  "title": "One delegation, start to finish",
  "steps": [
    { "label": "Brief", "note": "The parent writes a complete instruction — the child sees none of the parent's conversation, so the brief has to stand alone.", "hue": "idea" },
    { "label": "Search", "note": "The child reads, greps and reasons on its own transcript, with a small hard budget. Its dead ends are its own.", "hue": "make" },
    { "label": "Answer", "note": "One paragraph comes back: exact paths, exact names, and an explicit 'not found' where that is the honest result.", "hue": "prove" }
  ],
  "caption": "The parent pays for a paragraph instead of twenty turns. What it spent those turns on never enters its context at all."
}
```

The isolation is the whole point. A child that shared the parent's conversation would just be a more expensive way to take another turn.

```bf-figure
{
  "kind": "compare",
  "title": "The same task, twenty turns apart",
  "columns": [
    { "title": "Searching in-line", "hue": "muted", "items": ["List the directory", "Read the wrong file, in full", "Search — forty hits", "Read four of them", "Search again", "Find it on the sixth try", "Start thinking, with all of that still in the window"] },
    { "title": "Delegating the search", "hue": "make", "items": ["Ask: where does session expiry live?", "Read one paragraph", "Start thinking"] }
  ],
  "caption": "Same work done. The difference is which agent is carrying it afterwards."
}
```

## Read-only by default — and writable when you say so

A delegation defaults to read-only, because an unspecified one is nearly always an investigation. The child gets to read, search and reason, and a read-only child cannot cost you anything but time.

It is a default, not a ceiling. An agent that has found the fourteen files needing the same mechanical change can ask for a child that makes it — and then every write that child attempts asks **you** first, by name, on the same prompt your agent's own writes use. Auto covers a sub-agent's writes exactly as it covers the parent's. A governance gate that blocks a tool blocks it for the child too, and one that demands approval still demands it even with Auto on, because a preference cannot waive a compiled policy. Decline, and the refusal comes back to the child as something to work around rather than a dead end.

That is what changed most recently. Until this shipped, a sub-agent in your editor could only read — the approval prompt is raised by the chat that owns the run, and a nested agent had no way to reach it, so the honest thing was to run children read-only and say so. The prompt is now reachable from inside a delegation, so the child asks the question instead of being denied the chance to.

A child still cannot spawn a child. That is not a depth counter someone has to remember to decrement — the delegation capability is simply absent from what a child is handed, so there is nothing to recurse with.

```bf-figure
{
  "kind": "compare",
  "title": "What a delegation is allowed to touch",
  "columns": [
    { "title": "The child can", "hue": "prove", "items": ["Read and list files", "Search the tree", "Recall project memory", "Search the web", "Write — with your approval, per file", "Answer, once, in prose"] },
    { "title": "The child cannot", "hue": "bad", "items": ["Write anything you did not approve", "Get past a governance gate", "Pause the run for a human", "Propose a skill", "Spawn another sub-agent"] }
  ],
  "caption": "The accountable actor is still the parent. It keeps every decision and you keep every approval — it just stops paying for the search."
}
```

## Where it sits in the method

[Read comes before Prove, and Prove before Build](/blog/read-prove-build-the-inner-loop) — and Read is the stage this changes.

Reading is the cheap act in the method, right up until the codebase is large. Then it stops being cheap: the agent's window fills with what it read on the way to what it needed, and by the time it reaches Build it is reasoning around the wreckage of its own search. Teams feel this as an agent that was sharp on a small repo and vague on a real one. It is not less capable there. It is more full.

Delegation makes Read cost what it is worth again. The search happens somewhere the parent does not have to carry, and the parent arrives at Prove with room to think — which is the only stage where thinking was ever the point.

## What you can do with it today

- **Ask an agent to find something without spending its context on the finding.** "Where is the auth middleware", "is this pattern used anywhere else", "what does this six-hundred-line file actually export" — one brief, one paragraph.
- **Get it wherever the agent runs.** The editor, a cloud run, a long-lived container and a GitHub Actions job all delegate the same way — the same tool, the same brief, the same budget — so a habit learned in one holds in every other. The two long-lived surfaces are where it pays most: they have the shell and the checkout, which is exactly where an inline search costs the most to carry.
- **Send a mechanical edit, not just a question.** "Rename this symbol everywhere it appears" is a delegation now, not a report you then act on yourself. You approve each file as it happens.
- **See what it cost.** Every delegation lands on the run timeline with its label, its turns and whether it ran out of them — a child that was cut off says so rather than passing off its last word as a conclusion.
