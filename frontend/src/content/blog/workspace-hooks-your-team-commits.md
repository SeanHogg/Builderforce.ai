---
title: Tell the agent what every run must do, and commit it with the code
date: 2026-10-12
description: Workspace hooks let a repository give the BuilderForce agent standing directives, such as updating the docs before it finishes, never pushing until the tests pass, or formatting after every edit. They live in .builderforce/ so the whole team gets them through git.
tags: [vscode, agents, hooks, governance, developer-experience]
author: Sean Hogg
---

# Tell the agent what every run must do, and commit it with the code

Every team has a short list of things a change isn't finished without. The README mentions the new flag. DONE.md records what shipped. The linter is green. Nobody pushes to main with a failing test.

You could tell the agent each time, but you'd forget. Your teammate wouldn't know to say it at all. And an instruction typed into one chat ends with that chat, so the next session starts over.

That list belongs to the repository, not to whoever happens to be typing. So now it lives there.

## Workspace hooks

Add a file to your repository, `.builderforce/hooks.json`:

```json
{
  "hooks": [
    { "on": "stop", "prompt": "Update README.md and DONE.md with the work completed in this session." },
    { "on": "stop", "command": "npm run lint" },
    { "on": "preTool", "tool": "git_push", "command": "npm test" },
    { "on": "postTool", "tool": "write_file|edit_file", "command": "npx prettier --check ." }
  ]
}
```

Every agent run in that workspace now follows it, whether it starts in the BuilderForce panel or in VS Code's built-in chat.

```bf-figure
{
  "kind": "flow",
  "title": "Where each hook fires in a run",
  "steps": [
    { "label": "preTool", "note": "Before a matching tool call. A failing command refuses the call, and the agent sees why.", "hue": "make" },
    { "label": "postTool", "note": "After a successful call. A failing check's output goes back to the agent with the result.", "hue": "make" },
    { "label": "stop", "note": "The run is about to end. A prompt is handed over once. A failing check holds the run until it passes.", "hue": "run", "tag": "before the ship" },
    { "label": "runEnd", "note": "After the run has finished. A command for notifications, reports and cleanup.", "hue": "measure" }
  ],
  "caption": "Stop hooks run before the agent commits and pushes, so whatever they ask for, such as docs, a changelog line or a lint fix, ships in the same commit."
}
```

A **prompt** is an instruction, in plain words, that the agent carries out with its own tools. A **command** is a check that runs in the workspace root, and its output decides what happens next. By default, stop hooks fire only on runs that changed code, so a question about the codebase doesn't send the agent off to rewrite your README. Set `"when": "always"` if you want one on every run.

Standing guidance that isn't tied to a moment goes in `.builderforce/rules.md`, for example "use pnpm", "every migration gets a rollback" or "write tests in Vitest". It is read into every run's instructions, below your organisation's governance gates and above everything else.

```bf-figure
{
  "kind": "screen",
  "frame": "A repository with team directives",
  "ratio": 1.62,
  "regions": [
    { "label": ".builderforce/hooks.json", "note": "Checked as you type against its schema", "x": 4, "y": 8, "w": 44, "h": 40, "hue": "make" },
    { "label": ".builderforce/rules.md", "note": "Standing instructions for every task", "x": 4, "y": 52, "w": 44, "h": 36, "hue": "idea" },
    { "label": "Agent chat", "note": "Before you finish, this workspace asks you to: update README.md and DONE.md…", "x": 52, "y": 8, "w": 44, "h": 80, "hue": "run" }
  ],
  "caption": "Both files are plain text in your repository: reviewed in pull requests, versioned with the code, and identical for everyone who clones it."
}
```

## Shared, and still safe

The files live in `.builderforce/` so they're committed. That also means a hooks file arrives with every clone, and a command in it runs on your machine. So commands don't run until you approve them, once per machine. VS Code shows you the exact list. If someone changes a command or adds one, you're asked again. Editing a prompt or the rules needs no approval, because those are text the agent reads, like any other file in the repository. In a workspace VS Code doesn't trust, nothing runs.

## Where it sits in the method

Hooks belong to **Build**, the third act and the expensive one. [Read and Prove](/blog/read-prove-build-the-inner-loop) cost nothing because no code has changed yet. Once code changes, a team's definition of done is what keeps one run from leaving a mess for the next person. In a local editor session the agent is the only reviewer the change will get before it ships, so the team's standards have to be part of the run itself, not a reminder that depends on someone remembering it.

```bf-figure
{
  "kind": "compare",
  "title": "Finishing a change",
  "columns": [
    { "title": "Without hooks", "hue": "muted", "items": ["The agent ships the code", "Someone notices the README is stale", "Someone else notices lint is red", "A follow-up commit fixes both", "The next teammate's run repeats it"] },
    { "title": "With workspace hooks", "hue": "make", "items": ["The agent changes the code", "It updates the docs it was asked to", "Lint must pass before it may finish", "One commit ships all of it", "The same for everyone on the team"] }
  ],
  "caption": "A team's definition of done goes from a habit to part of the run."
}
```

## What you can do with it today

- **Keep the docs current without asking**: a stop prompt makes "update README and DONE" part of every change.
- **Make a check a requirement**: a stop command holds the run until your linter or type-check passes, within a bounded number of attempts.
- **Gate risky actions**: a preTool command can refuse `git_push` until `npm test` passes.
- **Correct as it goes**: a failing postTool check sends the formatter's complaint straight back to the agent.
- **Share it all through git**: commit `.builderforce/` and every teammate's agent follows the same directives.

Run **BuilderForce: Edit Workspace Hooks** in VS Code to create a starter file.

---

**Related reading:** [Approval gates and human oversight](/blog/approval-gates-and-human-oversight) · [BuilderForce vs Claude Code](/blog/builderforce-vs-claude-code) · [Multi-agent orchestration](/blog/multi-agent-orchestration)
