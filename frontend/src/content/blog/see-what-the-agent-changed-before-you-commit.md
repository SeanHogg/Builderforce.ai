---
title: See what the agent changed — before you commit it
date: 2026-09-05
description: An agent in your editor can edit your working tree, and the conversation used to be the only record that it had. The VS Code extension now carries a Changes section with a count badge and a pending-changes bar in the chat itself, so unreviewed edits announce themselves and every one is a click from its real diff.
tags: [vs-code, code-review, agents, git, product]
author: Sean Hogg
---

# See what the agent changed — before you commit it

You ask for a fix. The agent works, narrates, finishes, and says: *the file change has been made locally — you'll need to commit and push manually.*

Then what?

The change is real. It is on your disk right now. And until this release nothing in BuilderForce said so. The chat showed a finished turn. The ticket rail above it showed a task in progress. Every section of the sidebar — Sessions, Chats, Project & Tasks, Inbox — carried on as if nothing had touched the filesystem. The only trace of the edit was a sentence in a transcript you had to trust, and the only route to the code was noticing VS Code's own Source Control view on your own and correlating it back to the conversation from memory.

That is a strange thing for a tool whose entire premise is that agents do work you can inspect.

## What is there now

Two surfaces, reading one answer.

```bf-figure
{
  "kind": "screen",
  "frame": "The editor after an agent turn that touched code",
  "ratio": 1.62,
  "regions": [
    { "label": "Changes", "note": "A new sidebar section. Count badge, one row per file, click opens the diff.", "x": 3, "y": 22, "w": 32, "h": 30, "hue": "make" },
    { "label": "Sessions · Project · Inbox", "note": "Unchanged", "x": 3, "y": 54, "w": 32, "h": 34, "hue": "muted" },
    { "label": "Activity bar", "note": "The section's badge rolls up here — visible with the panel closed", "x": 0, "y": 8, "w": 3, "h": 84, "hue": "accent" },
    { "label": "Pending changes bar", "note": "3 uncommitted changes · Review", "x": 38, "y": 14, "w": 58, "h": 9, "hue": "make" },
    { "label": "Ticket rail", "note": "The tickets this chat is working", "x": 38, "y": 25, "w": 58, "h": 12, "hue": "idea" },
    { "label": "The conversation", "x": 38, "y": 39, "w": 58, "h": 49, "hue": "idea" }
  ],
  "caption": "The bar sits above the ticket rail because that is where you are already looking when a turn ends. The sidebar section is for when you are not."
}
```

**A Changes section in the BuilderForce sidebar.** One row per changed file, with what happened to it and which repository it is in. Click a row and the editor's own diff viewer opens on it — not a rendering of a diff, the real one, with all its navigation and its ability to edit the right-hand side. The section carries a numeric badge, and VS Code rolls view badges up onto the activity-bar icon, so pending work is visible even with the panel collapsed.

**A pending-changes bar in the chat**, directly above the ticket rail. It states the count, expands to the file list, and opens the same diffs through the same command. When the tree is clean it renders nothing at all — not an empty state, not a spacer. A signal that is always on screen is not a signal.

Both are fed by the same read, which matters more than it sounds.

## Counting is the hard part

"How many files are pending?" looks like a question with an obvious answer, and it has at least four wrong ones.

```bf-figure
{
  "kind": "compare",
  "title": "What a naive count gets wrong",
  "columns": [
    { "title": "The obvious implementation", "hue": "bad", "items": ["Staged + unstaged, added together", "A file you staged and then edited counts twice", "A rename reports the file you no longer have", "An unmerged conflict looks like a staged edit", "Untracked files are invisible or are everything"] },
    { "title": "What the number has to mean", "hue": "make", "items": ["One row per FILE, whatever git holds against it", "Staged-then-edited is one pending change, marked staged", "A rename is its destination — the file that exists", "A conflict says conflict, because the remedy differs", "Untracked is listed, and never called staged"] }
  ],
  "caption": "Each of these is one test in the suite. They exist because a count you cannot reconcile against the Source Control view sitting next to it is worse than no count."
}
```

The mapping lives in one host-free module with eighteen tests over exactly those cases — including `AD`, where you staged an addition and then deleted the file, and the pending edit is the deletion rather than the add. Everything above it reads that one module: the sidebar, the chat bar, and the repository facts the agent itself is told at the start of a turn. That last one had been quietly wrong in the old code — it added the staged and unstaged lists together — so the model could be told "2 uncommitted files" while a UI showed three. Now there is one number.

## Keeping it honest between events

An agent's file tools write straight to disk. They do not go through the editor's document API, so nothing in VS Code fires when they land. A surface that waits politely for a notification will sit there telling you nothing is pending while three files have just changed underneath it.

```bf-figure
{
  "kind": "flow",
  "title": "Everything that can move the working tree, and what tells us",
  "steps": [
    { "label": "You edit and save", "note": "The editor's own save event", "hue": "idea" },
    { "label": "You stage, commit, or switch branch", "note": "The Git extension's repository state event", "hue": "run" },
    { "label": "An agent writes a file", "note": "Nothing fires — so the mutating tool IS the signal, raised the moment it succeeds", "hue": "make", "tag": "the gap" },
    { "label": "One shared subscription", "note": "However many chat panels and sidebars are watching, one listener and one cached read behind all of them", "hue": "measure" }
  ],
  "caption": "The third step is the one that made this feature necessary and the one a notification-driven design misses."
}
```

## Where it sits in the method

This is **Prove**, and it is worth being precise about why.

[Read, Prove, Build](/blog/read-prove-build-the-inner-loop) is the inner loop, and Prove is the cheap act that decides whether Build was right. An agent that edits your code has made a claim: *this change does the thing you asked for*. A transcript saying so is not evidence. The diff is the evidence — and if the diff is three clicks away in a different tool, in practice most people accept the claim instead of checking it, which is precisely how an agentic workflow stops being reviewable and turns into a thing you either trust wholesale or abandon.

Making the proof one click from the claim is not a convenience. It is what keeps the loop closed.

It also sits at a specific seam on the [Idea → Make → Run → Measure](/blog/idea-make-run-measure-menu-as-methodology) arc: the handoff out of **Make**. Code exists; nothing has been committed, run, or measured yet. That handoff was the one place the local editor surface had no representation at all — the board tracks a ticket, the cloud lane commits every write and opens a pull request when the run ends, and locally the work simply became invisible the moment it stopped being conversation and started being files. It is visible now.

## What you can do with it today

- **Know, without asking, that a turn changed code** — the count is on the chat and on the activity-bar icon, and it appears the moment the tool succeeds rather than whenever something happens to refresh.
- **Read every change as a real diff**, in the editor's own viewer, one click from the conversation that produced it.
- **See what is already staged**, so "commit" holds no surprises.
- **Hand it to the Brain when you are satisfied** — the Changes section's title action opens a chat seeded to review the diff, commit on a branch, push, and open a pull request, confirming the branch name and title with you first.

One thing this deliberately does **not** do: give the agent a commit or push verb of its own. What a local agent may do to your working tree and your remote is a governance decision — branch or `main`, whether a push needs an approval gate, whether "open a PR and request review" ought to replace "push" as the default finish — and shipping the verbs before the decision would be shipping an agent that can push to a protected branch on its own initiative. The review path came first on purpose.

---

**Related reading:** [VS Code as the command centre for your agentic workforce](/blog/vs-code-command-center-for-your-agentic-workforce) · [Read, Prove, Build — the inner loop](/blog/read-prove-build-the-inner-loop) · [Approval gates and human oversight](/blog/approval-gates-and-human-oversight)

Install the [BuilderForce extension for VS Code](https://marketplace.visualstudio.com/items?itemName=BuilderForce.builderforce-ai), ask an agent for a change, and watch the count appear.
