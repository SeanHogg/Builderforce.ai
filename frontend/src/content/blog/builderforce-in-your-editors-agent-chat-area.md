---
title: BuilderForce now sits in VS Code's agent chat area, next to your code
date: 2026-10-22
description: The BuilderForce chat now has its own tab in VS Code's agent chat area, beside Chat, Claude Code and Codex. Your code stays in the editor, the conversation that changes it stays beside it, and every way of opening a chat lands in that one place.
tags: [vscode, editor, agents, chat, product]
author: Sean Hogg
---

# BuilderForce now sits in VS Code's agent chat area, next to your code

VS Code has a place for coding agents now. The secondary sidebar on the right holds Chat, Claude Code and Codex, each in its own tab. You type there, and the code it changes stays open in the editor beside it.

BuilderForce wasn't in that row. Its chat opened as an **editor tab**, which meant it took the space your code needed. To watch an agent change a file you had to split the editor by hand, or keep switching between the conversation and the code.

Now BuilderForce has its own tab in that row.

```bf-figure
{
  "kind": "screen",
  "frame": "VS Code with BuilderForce in the agent chat area",
  "ratio": 1.78,
  "regions": [
    { "label": "Sidebar", "note": "Sessions, Work, Inbox, Health", "x": 2, "y": 6, "w": 18, "h": 88, "hue": "muted" },
    { "label": "Your code", "note": "The file the agent is changing, at full width", "x": 22, "y": 6, "w": 46, "h": 88, "hue": "make" },
    { "label": "Chat · Claude Code · Codex · BuilderForce", "x": 70, "y": 6, "w": 28, "h": 8, "hue": "accent" },
    { "label": "BuilderForce", "note": "The same conversation, runs and approvals as everywhere else", "x": 70, "y": 16, "w": 28, "h": 78, "hue": "idea" }
  ],
  "caption": "The editor keeps the code. The agent chat area keeps the conversation. Nothing has to be traded for anything."
}
```

## One chat, in one place

This isn't a second chat. The tab runs the same conversation you'd see on the web, with the same transcript, the same tool approvals, the same model choice and the same project scope. A run keeps going while the tab is hidden, because the agent runs in the extension, not in the tab.

Every way into a chat now lands in that tab: the **Open Chat** command, a session clicked in the Sessions list, *Work on this task* from the board, and a prompt sent from Project 360. So "open my chat" always gives the same answer.

```bf-figure
{
  "kind": "flow",
  "title": "Every way in, one place to land",
  "steps": [
    { "label": "Ask", "note": "Open Chat, a session in the sidebar, a task, a Project 360 prompt", "hue": "idea" },
    { "label": "Land", "note": "The BuilderForce tab in the agent chat area comes forward on that conversation", "hue": "make", "tag": "beside your code" },
    { "label": "Watch", "note": "Edits land in the editor next to it; approvals and the Changes pill stay in view", "hue": "run" }
  ],
  "caption": "Boards still open in the editor, because a canvas needs the width. If you prefer one editor tab per conversation, the per-session tab setting still gives you that."
}
```

On VS Code releases older than 1.106, which have no agent chat area, the same tab appears in the BuilderForce sidebar instead.

## Where it sits in the method

Building is the third act, after [Read and Prove](/blog/read-prove-build-the-inner-loop), and it's where the short loop from *ask for a change* to *see the change* matters most. Every hop out of that loop costs attention: a tab switch, a split you set up by hand, a conversation covering the file it's editing.

```bf-figure
{
  "kind": "compare",
  "title": "Watching an agent change your code",
  "columns": [
    { "title": "Chat as an editor tab", "hue": "muted", "items": ["The chat takes the editor's space", "Split the editor by hand, or keep switching", "The file being changed is a click away", "Each entry point could open its own tab"] },
    { "title": "Chat in the agent chat area", "hue": "make", "items": ["Code at full width in the editor", "The conversation always alongside", "Approvals and changes in view while you read the diff", "Every entry point lands on the same tab"] }
  ],
  "caption": "Same chat, same runs. What changed is where it sits."
}
```

Make, Run and Measure happen on the platform. When the work is code on your own machine, the Make step happens in your editor, and now the agent doing it sits beside your code in the editor's agent chat area.

## Try it

Update the BuilderForce extension, reload VS Code, and open the agent chat area. BuilderForce has its own tab next to Chat, Claude Code and Codex. Or run **BuilderForce: Open Chat**, and it opens there.

---

**Related reading:** [Read, Prove, Build: the inner loop](/blog/read-prove-build-the-inner-loop) · [No account, no GPU, no network](/blog/no-account-no-gpu-you-choose-where-it-runs)
