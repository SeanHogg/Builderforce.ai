---
title: Bring your skills with you — one skill folder, every agent
date: 2026-10-23
description: The procedures your team wrote for Claude Code, Codex or a repo's .agents folder now load in BuilderForce unchanged — scripts and references included — and every skill you write here leaves as the same standard folder. One skill, on the web, in VS Code, in Rovr, on the canvas and in every cloud run.
tags: [skills, agents, agent-skills, portability, marketplace, product]
author: Sean Hogg
---

# Bring your skills with you — one skill folder, every agent

Somebody on your team has already written down how you ship a schema change. It is in `.claude/skills/ship-a-schema-change/SKILL.md`, with a script beside it that runs the guards, and Claude Code follows it every time.

Until today, that knowledge stopped at the edge of the tool it was written for. To get it into BuilderForce you pasted the instructions into a text box, lost the script, and hoped nobody edited one copy without the other. The procedure that worked became two procedures that drifted.

Skills are now a **standard**, and BuilderForce speaks it. A skill is a folder: a `SKILL.md` that says what it is and when to use it, plus the scripts and references it points at. Claude Code, Codex and a growing list of agent tools read exactly that shape — the open [Agent Skills](https://agentskills.io) format — and so does every BuilderForce agent, on every surface.

## Bring the folder, keep the folder

```bf-figure
{
  "kind": "flow",
  "title": "A skill's round trip",
  "steps": [
    { "label": "Import", "note": "Pick the folder, a .zip of it, or a lone SKILL.md. It is checked against the standard before anything is sent — name, description, every path — and the verdict you see is the one the server reaches.", "hue": "idea" },
    { "label": "Use", "note": "Every agent in the workspace sees one line for it: its name and when to use it. When a task matches, the agent loads the instructions; when the instructions call for a script, it loads that too.", "hue": "make", "tag": "everywhere" },
    { "label": "Take it out", "note": "Download folder gives you <name>.zip — the same SKILL.md and files, ready for .claude/skills or .agents/skills. Or publish it, and installers get exactly what you run.", "hue": "run" }
  ],
  "caption": "Nothing is retyped and nothing is lost on the way in or out. The folder you import is the folder you export."
}
```

Importing is signing it off. The person who brings a skill in is the person vouching for it, so it is in force for every agent from their next run — the same state a reviewer's approval produces, with the same record of who did it. A skill an *agent* proposes still waits as a draft until a person approves it; [that loop is unchanged](/blog/the-run-that-teaches-the-next-one), and the drafts it produces are now standard folders too.

You can also write one in the browser. **New skill** asks for a title, the name agents load it by, when to use it, and the steps. What it saves is a standard `SKILL.md`, so a skill born here downloads and runs anywhere else.

## One skill, every place your agents work

The question that mattered was not "can we parse SKILL.md" — it was "does the skill reach the agent that needs it, wherever that agent is running?" A skill that works in cloud runs and silently does nothing in the editor is a skill nobody can trust.

```bf-figure
{
  "kind": "screen",
  "frame": "Where a workspace's skills now reach",
  "ratio": 1.7,
  "regions": [
    { "label": "Cloud & container runs", "note": "The catalog in the prompt; the skill loaded when the ticket matches", "x": 4, "y": 8, "w": 44, "h": 26, "hue": "make" },
    { "label": "Brain — web, VS Code, Rovr", "note": "Same catalog, same loader, mid-conversation", "x": 52, "y": 8, "w": 44, "h": 26, "hue": "idea" },
    { "label": "Creation canvas & Studio", "note": "The board's assistant follows your procedure while it builds", "x": 4, "y": 40, "w": 44, "h": 26, "hue": "make" },
    { "label": "Self-hosted agents", "note": "Assigned skills land on disk as real folders; .claude/skills and .agents/skills load as-is", "x": 52, "y": 40, "w": 44, "h": 26, "hue": "run" },
    { "label": "Any MCP client", "note": "Claude, Cursor and others connected to your workspace get the same tool", "x": 4, "y": 72, "w": 92, "h": 20, "hue": "accent" }
  ],
  "caption": "One loader behind all of them. Add a skill once and every surface sees it on its next turn; no surface keeps a copy of its own."
}
```

On a self-hosted agent, a skill assigned in the portal used to arrive as a *name* — "you have been assigned ship-a-schema-change; if a SKILL.md for it happens to be on this machine, follow it". Now the folder itself is written to disk, scripts and all, and shows up in the agent's skill list like one you made locally. A skill you wrote yourself under the same name always wins; the sync never overwrites a folder it did not write.

## Fifty skills for the price of fifty lines

The standard's best idea is that an agent should not carry every procedure it might need. It sees a catalog — one line per skill — and loads a skill's instructions only when the task in front of it matches. A bundled reference loads only when the instructions point at it.

```bf-figure
{
  "kind": "compare",
  "title": "What a run carries before it starts",
  "columns": [
    { "title": "Every skill pasted in", "hue": "muted", "items": ["Every approved procedure, in full, in every prompt", "Long ones cut off mid-step", "Scripts nowhere — only the prose about them", "More skills, more cost, on every turn"] },
    { "title": "The standard's catalog", "hue": "make", "items": ["One line per skill: its name and when to use it", "The full instructions when — and only when — the task matches", "Bundled scripts and references on demand", "A library that grows without growing every prompt"] }
  ],
  "caption": "Skills assigned directly to a run, a project or an agent are still given in full — that is a stronger contract than a catalog entry, and it stays one."
}
```

## Where it sits in the method

Skills live in the **Build** act of [Read · Prove · Build](/blog/read-prove-build-the-inner-loop) — the one that spends. Read and Prove are cheap on purpose, so that deciding to build is a real decision. Once you are building, the most expensive thing an agent can do is rediscover how your team does something it has done a hundred times: which guard to run, which migration track a column needs, how a release goes out.

A skill is that knowledge, written once. Making it a standard folder is what lets it travel with the work instead of living in one tool — so the procedure your engineer refined in their editor is the one the cloud run follows on the next ticket, and the one the board's assistant follows while it builds. Build stays the expensive act; it stops being the act where the same lesson is paid for twice.

## What you can do with it today

- **Import** a skill folder from Claude Code, a repo's `.agents/skills`, or a colleague's .zip — scripts and references included.
- **Write** a skill in the browser and get a standard `SKILL.md`.
- **Download** any workspace skill, or any published marketplace skill, as a ready-to-use folder.
- **Publish** a skill to the marketplace from its folder, so the listing and what installers receive can never disagree.
- **Use** every skill from cloud runs, the Brain on the web, in VS Code and in Rovr, the creation canvas and the Studio — and from self-hosted agents, where assigned skills now arrive on disk.

---

**Related reading:** [The run that teaches the next one](/blog/the-run-that-teaches-the-next-one) · [Teach it once, and it does it again](/blog/teach-it-once-and-it-does-it-again) · [Skills, Assignments, and the Marketplace](/blog/skills-assignment-and-the-marketplace)

[Open your workspace skills](/skills) and import the folder your team already trusts.
