---
title: "Creating Skills"
---

# Creating Custom Skills 🛠

Skills are the primary way to teach BuilderForce agents a new procedure. BuilderForce follows the open **[Agent Skills](https://agentskills.io) standard**, so a skill you write here also works in Claude Code and any other agent that reads the standard, and theirs work here.

## What is a Skill?

A skill is a **folder** containing a `SKILL.md` file and, optionally, the files its instructions refer to:

```
hello-world/
├── SKILL.md          # required: frontmatter + instructions
├── scripts/          # optional: code the agent can run
├── references/       # optional: extra docs, loaded only when needed
└── assets/           # optional: templates, data
```

An agent first sees only each skill's `name` and `description`. It loads the `SKILL.md` instructions when a task matches, and a bundled file only when those instructions point at it. This is the standard's *progressive disclosure*: a workspace can hold many skills for the cost of one line each.

## Step-by-Step: Your First Skill

### 1. Create the folder

On a self-hosted agent, a skill folder can live in any of these places (highest precedence first):

- `<workspace>/skills/`
- `<workspace>/.claude/skills/` or `<workspace>/.agents/skills/`
- `~/.claude/skills/` or `~/.agents/skills/`
- `~/.builderforce/skills/` (managed; assigned skills are synced here)

```bash
mkdir -p ~/.builderforce/workspace/skills/hello-world
```

### 2. Write `SKILL.md`

```markdown
---
name: hello-world
description: Greets the user. Use when the user asks for a greeting or says hello.
license: MIT
---

# Hello World Skill

When the user asks for a greeting, reply "Hello from your custom skill!".
```

The frontmatter follows the spec:

| Field | Required | Rule |
|---|---|---|
| `name` | yes | 1–64 characters; lowercase letters, digits and hyphens; no leading, trailing or double hyphen; **must equal the folder name** |
| `description` | yes | 1–1024 characters. Say what it does **and when to use it**, because this is the text the agent matches tasks against |
| `license` | no | A license name or a bundled license file |
| `compatibility` | no | Up to 500 characters: required product, system packages, network access |
| `metadata` | no | A map of string keys to string values (author, version, …) |
| `allowed-tools` | no | Space-delimited tools the skill pre-approves (experimental in the spec) |

`hello_world` is **not** a valid name (underscore), and a folder called `hello-world` holding `name: helloworld` fails the folder rule. The runtime still loads a skill that breaks a naming rule, under its declared name, but logs a diagnostic. The platform import and the marketplace refuse it, because other agent tools would.

### 3. Add scripts or references (optional)

Refer to bundled files by relative path from the skill root, e.g. "run `scripts/greet.sh`" or "see [the reference](references/REFERENCE.md)". Keep `SKILL.md` under about 500 lines and move detail into `references/`.

### 4. Refresh

Ask your agent to "refresh skills" or restart the gateway. The skills watcher also picks up changes to any of the folders above.

## Bringing a skill to the platform

The same folder works on every BuilderForce surface:

- **Import it**: on **Skills → Workspace skills**, choose *Import skill folder* and pick the folder, a `.zip` of it, or a lone `SKILL.md`. Importing signs it off. Every agent in the workspace can load it from its next run: cloud runs, the Brain on the web, in VS Code and in Rovr, the creation canvas and the Studio.
- **Write it in the browser**: choose *+ New skill*. What you write is saved as a standard `SKILL.md`.
- **Take it elsewhere**: every skill has *Download folder*, which gives you `<name>.zip` ready for `.claude/skills` or `.agents/skills`.
- **Publish it**: approved skills can be published to the marketplace with their whole folder. Installers download exactly what you run.

## Best Practices

- **Write the description for matching**: name the situation ("Use when a change needs a new database column"), not the steps.
- **Be concise**: tell the model *what* to do, not how to be an AI.
- **Safety first**: if your skill runs `bash`, make sure untrusted input cannot reach the command line.
- **Test locally**: `builderforce agent --message "use my new skill"`.

## Shared Skills

Browse and contribute skills on the [marketplace](https://builderforce.ai/marketplace) or [AgentHub](https://agenthub.com).
