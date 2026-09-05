---
title: Ship from the editor — commit, branch, pull request
date: 2026-09-05
description: The agent in your editor can now finish the job it started. git_commit, git_push and open_pull_request give it a ticket branch and a review, not a shell. Asked to push straight to main, it offers a pull request instead — and pushing the base branch is a separate, declared act your approval gate prompts for.
tags: [vs-code, git, agents, code-review, product]
author: Sean Hogg
---

# Ship from the editor — commit, branch, pull request

A week ago, [seeing what the agent changed](/blog/see-what-the-agent-changed-before-you-commit) closed one half of a gap. The other half stayed open on purpose, and that post said so: no commit verb, no push verb, because what a local agent may do to your remote is a governance decision and shipping the verbs before the decision would hand you an agent that can push to a protected branch on its own initiative.

The decision has been made. Here is what it turned into.

## What it looked like before

Worth being specific, because the failure was not "a feature was missing". It was worse than that: the agent had been *told* it could ship, and it could not.

The editor persona ended with a sentence reading roughly *use `run_command` for git — to commit, push, and open a PR when the user wants to ship.* Advice with no tool behind it. So when someone asked an agent to commit a one-line CSS fix and push it, this happened:

```bf-figure
{
  "kind": "flow",
  "title": "One request, and every step of it going wrong",
  "steps": [
    { "label": "\"commit the change and push to main\"", "note": "The edit is already made and correct", "hue": "idea" },
    { "label": "git_status fails", "note": "The open folder holds several checkouts, so there is no repo at its root", "hue": "bad", "tag": "1" },
    { "label": "git_sync_latest cannot be scoped", "note": "It took no `repo` argument at all — unlike git_status, which does", "hue": "bad", "tag": "2" },
    { "label": "Hunts the tool catalog", "note": "There is no commit verb to find; `run_command` had been trimmed from the turn", "hue": "bad", "tag": "3" },
    { "label": "git add -A && git commit && git push", "note": "Every file in a shared working tree, unreviewed, onto main", "hue": "bad", "tag": "4" }
  ],
  "caption": "Four independent defects, one request. The last one is the dangerous one, and it is the one the first three made inevitable."
}
```

Step four is the part to sit with. The working tree had three modified files. The agent had touched one. `git add -A` does not know the difference, and neither does an agent that was never asked to say.

## The shape of the answer

Three tools, and the safe path is the reachable one.

```bf-figure
{
  "kind": "flow",
  "title": "The default route",
  "steps": [
    { "label": "git_commit", "note": "Names the exact paths it changed and the ticket branch to put them on — the branch is created for you", "hue": "make" },
    { "label": "git_push", "note": "Pushes that branch, setting its upstream on the first go", "hue": "run" },
    { "label": "open_pull_request", "note": "Opens the PR against the base branch and can request reviewers by name", "hue": "prove" },
    { "label": "A human reads the diff", "note": "Which was the point", "hue": "measure" }
  ],
  "caption": "Nothing here is new as a workflow. What is new is that it is the path of least resistance for the agent rather than a thing you hoped it would choose."
}
```

**`git_commit` requires you to list the paths.** Not as a formality. Your working tree is shared with you — the human sitting in front of it, mid-thought, with two other files open and half-edited. `git add -A` sweeps those into the agent's commit and into the agent's pull request, and now your unrelated work is in someone else's review. An agent that cannot state which files it changed has no business committing, so the tool will not let it decline to say.

**Committing on the base branch is refused.** Pass `branch` and it switches to that ticket branch, creating it if it does not exist. Leave it out while you are on `main` and you get an error that names the remedy rather than a git fatal.

**`open_pull_request`** pushes the branch first if it has no upstream, then opens the PR through your own `gh` login — no token is plumbed through the agent, because the machine already has one. If `gh` is not installed it says the branch is committed and pushed and hands you the branch name, which is the difference between a tool that failed and work that was lost.

## Pushing main is a declared act

You can still do it. It is just no longer something that can happen by accident, or by an agent's initiative.

```bf-figure
{
  "kind": "compare",
  "title": "\"Push this to main\"",
  "columns": [
    { "title": "Before", "hue": "bad", "items": ["No tool — falls through to a raw shell", "`git add -A` stages whatever is there", "Straight onto the base branch", "The approval prompt reads: run: git add -A && git com…", "Nothing offered a pull request, because nothing could"] },
    { "title": "Now", "hue": "good", "items": ["The agent offers a pull request first, and says why", "Only the paths it names are staged", "Refused unless `allowBaseBranch` is set", "The prompt reads: push to the BASE BRANCH (main) — skips pull-request review", "You approve that specific act, or you do not"] }
  ],
  "caption": "The middle row is the governance decision. The fourth row is what makes it a real one — an approval you cannot read is not an approval."
}
```

Every one of these tools is mutating, so they ride the same approval gate as `write_file` and `delete_file`. That gate was already there; what it lacked was anything worth reading. `git_push` in a confirmation dialog tells you nothing about the one thing you need to weigh. *Push to the BASE BRANCH (main) — skips pull-request review* tells you all of it.

They are also gated on a new `git.write` capability rather than on `shell`. That sounds like bookkeeping and is not: the cloud surfaces have shells too, and they already publish by a completely different mechanism — a write there **is** a commit, and the run opens its pull request when it finishes. Handing them a second, unimplemented route to the same act would surface tools their runtime has no handler for, which fails mid-run. One capability, one surface, one way to publish per lane.

## The quiet fix underneath

The reason the agent went looking for `run_command` in the first place is worth naming, because it is a class of bug rather than an incident.

The catalog is around 440 tools. Roughly 64 are advertised per turn, chosen by lexical relevance to what you asked. `run_command` shares no word stem with "commit the change and push to main" — so on the exact turn that needed it, it was trimmed away. The agent read its own instructions, went looking for the tool they named, and could not find it.

All nine git tools are now pinned unconditionally, alongside the file tools. Relevance is a reasonable way to choose among domains. It is not a reasonable way to decide whether the agent can touch the workspace it is sitting in.

## Where it sits in the method

This is the **Build** step of [Read, Prove, Build](/blog/read-prove-build-the-inner-loop) finally reaching its own end, and the **Make → Run** handoff on the [Idea → Make → Run → Measure](/blog/idea-make-run-measure-menu-as-methodology) arc.

The previous release made the handoff *visible*: code existed on disk, nothing had been committed, and now you could see it and read every diff. But visible is not the same as passable. You could inspect the work and then had to leave the tool to move it — which means the arc had a seam in it exactly where a methodology is supposed to be seamless, and every local change quietly became a manual step somebody had to remember.

What closes it is not "the agent can now push". It is that the route out of Make lands in **Prove** by default — a pull request, a diff, a reviewer — instead of landing in Run with the review skipped. Committing to a ticket branch and opening a PR is slower than pushing to `main` by exactly one step, and that step is the one where a human looks at the change. Making the reviewed path the default is the whole argument.

Pushing the base branch stays available because sometimes it is genuinely right, and a methodology that pretends otherwise gets routed around. It just costs you a sentence saying so, and a prompt that tells you what you are approving.

## What you can do with it today

- **Ask for a change and then ask to ship it**, and get a ticket branch and a pull request URL back — not a shell command you have to audit.
- **Trust that only your change is in it**, because the agent had to name the files.
- **Say "push to main" and be offered a review instead** — and still get your push if you confirm you meant it.
- **Request reviewers by name** on the pull request the agent opens.
- **Work in a folder that holds several checkouts**, which every git tool now handles: pass `repo` and each one scopes into the right one. `git_sync_latest`, `git_undo` and `git_redo` could not do that before and would fail at the workspace root with nothing that named the reason.

---

**Related reading:** [See what the agent changed — before you commit it](/blog/see-what-the-agent-changed-before-you-commit) · [Approval gates and human oversight](/blog/approval-gates-and-human-oversight) · [VS Code as the command centre for your agentic workforce](/blog/vs-code-command-center-for-your-agentic-workforce)

Install the [BuilderForce extension for VS Code](https://marketplace.visualstudio.com/items?itemName=BuilderForce.builderforce-ai), ask an agent to fix something, then ask it to ship it.
