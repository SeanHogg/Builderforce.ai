---
summary: "Skills: managed vs workspace, gating rules, and config/env wiring"
read_when:
  - Adding or modifying skills
  - Changing skill gating or load rules
title: "Skills"
---

# Skills (BuilderForce Agents)

BuilderForce Agents implements the open **[Agent Skills](https://agentskills.io) standard**. Each skill is a folder containing a `SKILL.md` (YAML frontmatter plus instructions) and, optionally, `scripts/`, `references/` and `assets/`. BuilderForce Agents loads **bundled skills** plus local and assigned ones, and filters them at load time based on environment, config, and binary presence. Every surface checks frontmatter with the same validator, `@builderforce/agent-skills`: the runtime, the platform import, and the marketplace.

## Locations and precedence

Skills are loaded from these places, lowest precedence first:

1. **Extra folders**: `skills.load.extraDirs` in `~/.builderforce/builderforce.json`, plus plugin skill dirs
2. **Bundled skills**: shipped with the install (npm package or Builderforce.app)
3. **Managed/local skills**: `~/.builderforce/skills`. Skills **assigned in the portal** are synced here as real folders (see below)
4. **Personal standard folders**: `~/.claude/skills`, then `~/.agents/skills`
5. **Project standard folders**: `<workspace>/.claude/skills`, then `<workspace>/.agents/skills`
6. **Workspace skills**: `<workspace>/skills` (highest)

When a skill name exists in more than one place, the higher one wins. `.claude/skills` is read so that skills written for Claude Code load unchanged.

### Assigned skills are synced as folders

When a skill is assigned to a host or agent in the portal, `artifacts.sync` fetches it from the platform's skill library (`GET /llm/v1/skills/<name>/package`, authenticated with `BUILDERFORCE_API_KEY`). It then writes `~/.builderforce/skills/<name>/`, including its scripts and references, so the skill appears in `<available_skills>` like any local one. A folder the sync did not write is never overwritten: a same-named skill you made yourself always wins, and the sync reports it as skipped.

## Per-agent vs shared skills

In **multi-agent** setups, each agent has its own workspace. That means:

- **Per-agent skills** live in `<workspace>/skills` for that agent only.
- **Shared skills** live in `~/.builderforce/skills` (managed/local) and are visible
  to **all agents** on the same machine.
- **Shared folders** can also be added via `skills.load.extraDirs` (lowest
  precedence) if you want a common skills pack used by multiple agents.

If the same skill name exists in more than one place, the usual precedence
applies: workspace wins, then managed/local, then bundled.

## Plugins + skills

Plugins can ship their own skills by listing `skills` directories in
`builderforce.plugin.json` (paths relative to the plugin root). Plugin skills load
when the plugin is enabled and participate in the normal skill precedence rules.
You can gate them via `metadata.builderforce.requires.config` on the plugin’s config
entry. See [Plugins](/tools/plugin) for discovery/config and [Tools](/tools) for the
tool surface those skills teach.

## AgentHub (install + sync)

AgentHub is the public skills registry for BuilderForce Agents. Browse at
[https://agenthub.com](https://agenthub.com). Use it to discover, install, update, and back up skills.
Full guide: [AgentHub](/tools/agenthub).

Common flows:

- Install a skill into your workspace:
  - `agenthub install <skill-slug>`
- Update all installed skills:
  - `agenthub update --all`
- Sync (scan + publish updates):
  - `agenthub sync --all`

By default, `agenthub` installs into `./skills` under your current working
directory (or falls back to the configured BuilderForce Agents workspace). BuilderForce Agents picks
that up as `<workspace>/skills` on the next session.

## Security notes

- Treat third-party skills as **untrusted code**. Read them before enabling.
- Prefer sandboxed runs for untrusted inputs and risky tools. See [Sandboxing](/gateway/sandboxing).
- `skills.entries.*.env` and `skills.entries.*.apiKey` inject secrets into the **host** process
  for that agent turn (not the sandbox). Keep secrets out of prompts and logs.
- For a broader threat model and checklists, see [Security](/gateway/security).

## Format (Agent Skills standard)

`SKILL.md` must include at least:

```markdown
---
name: nano-banana-pro
description: Generate or edit images via Gemini 3 Pro Image. Use when the user asks for an image.
---
```

Spec rules (checked on load; a violation is logged as a diagnostic, and the platform import refuses it):

- `name`: 1–64 chars, lowercase letters, digits and hyphens, no leading/trailing/double hyphen, **equal to the folder name**.
- `description`: 1–1024 chars. A skill with no description is skipped (and reported), because an agent could never match it.
- Optional spec keys: `license`, `compatibility` (≤ 500 chars), `metadata` (string → string map), `allowed-tools` (space-delimited; experimental in the spec, recorded and round-tripped).

Notes:

- Frontmatter is full YAML. Multi-line `metadata` blocks (including the JSON-style block below) are supported.
- Use `{baseDir}` in instructions to reference the skill folder path, or relative paths from the skill root.
- BuilderForce-specific optional keys (preserved on import/export):
  - `homepage` — URL surfaced as “Website” in the macOS Skills UI (also supported via `metadata.builderforce.homepage`).
  - `user-invocable` — `true|false` (default: `true`). When `true`, the skill is exposed as a user slash command.
  - `disable-model-invocation` — `true|false` (default: `false`). When `true`, the skill is excluded from the model prompt (still available via user invocation).
  - `command-dispatch` — `tool` (optional). When set to `tool`, the slash command bypasses the model and dispatches directly to a tool.
  - `command-tool` — tool name to invoke when `command-dispatch: tool` is set.
  - `command-arg-mode` — `raw` (default). For tool dispatch, forwards the raw args string to the tool (no core parsing).

    The tool is invoked with params:
    `{ command: "<raw args>", commandName: "<slash command>", skillName: "<skill name>" }`.

## Skills on the platform (cloud, Brain, canvas, Studio)

A workspace's skills are its approved skills, plus skills assigned tenant-wide. Approved skills include ones written in the browser, imported as a folder, or proposed by an agent and approved by a person. Platform surfaces reach them through one tool, `builtin_skills_read`, in the gateway catalog (`GET /llm/v1/mcp/tools`, `POST /mcp`):

- The tool's description carries the workspace's catalog: each skill's name and description.
- `{ name }` returns the instructions plus the list of bundled files.
- `{ name, path }` returns one bundled file.

That one tool serves the Brain on the web, in VS Code and in Rovr, the creation canvas and the Studio, external MCP clients, and cloud and container runs. Cloud runs also get the catalog as an `<available_skills>` block. Skills assigned to a run, project or agent are still injected in full as mandatory capabilities.

## Gating (load-time filters)

BuilderForce Agents **filters skills at load time** using `metadata` (single-line JSON):

```markdown
---
name: nano-banana-pro
description: Generate or edit images via Gemini 3 Pro Image
metadata:
  {
    "builderforce":
      {
        "requires": { "bins": ["uv"], "env": ["GEMINI_API_KEY"], "config": ["browser.enabled"] },
        "primaryEnv": "GEMINI_API_KEY",
      },
  }
---
```

Fields under `metadata.builderforce`:

- `always: true` — always include the skill (skip other gates).
- `emoji` — optional emoji used by the macOS Skills UI.
- `homepage` — optional URL shown as “Website” in the macOS Skills UI.
- `os` — optional list of platforms (`darwin`, `linux`, `win32`). If set, the skill is only eligible on those OSes.
- `requires.bins` — list; each must exist on `PATH`.
- `requires.anyBins` — list; at least one must exist on `PATH`.
- `requires.env` — list; env var must exist **or** be provided in config.
- `requires.config` — list of `builderforce.json` paths that must be truthy.
- `primaryEnv` — env var name associated with `skills.entries.<name>.apiKey`.
- `install` — optional array of installer specs used by the macOS Skills UI (brew/node/go/uv/download).

Note on sandboxing:

- `requires.bins` is checked on the **host** at skill load time.
- If an agent is sandboxed, the binary must also exist **inside the container**.
  Install it via `agents.defaults.sandbox.docker.setupCommand` (or a custom image).
  `setupCommand` runs once after the container is created.
  Package installs also require network egress, a writable root FS, and a root user in the sandbox.
  Example: the `summarize` skill (`skills/summarize/SKILL.md`) needs the `summarize` CLI
  in the sandbox container to run there.

Installer example:

```markdown
---
name: gemini
description: Use Gemini CLI for coding assistance and Google search lookups.
metadata:
  {
    "builderforce":
      {
        "emoji": "♊️",
        "requires": { "bins": ["gemini"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "gemini-cli",
              "bins": ["gemini"],
              "label": "Install Gemini CLI (brew)",
            },
          ],
      },
  }
---
```

Notes:

- If multiple installers are listed, the gateway picks a **single** preferred option (brew when available, otherwise node).
- If all installers are `download`, BuilderForce Agents lists each entry so you can see the available artifacts.
- Installer specs can include `os: ["darwin"|"linux"|"win32"]` to filter options by platform.
- Node installs honor `skills.install.nodeManager` in `builderforce.json` (default: npm; options: npm/pnpm/yarn/bun).
  This only affects **skill installs**; the Gateway runtime should still be Node
  (Bun is not recommended for WhatsApp/Telegram).
- Go installs: if `go` is missing and `brew` is available, the gateway installs Go via Homebrew first and sets `GOBIN` to Homebrew’s `bin` when possible.
- Download installs: `url` (required), `archive` (`tar.gz` | `tar.bz2` | `zip`), `extract` (default: auto when archive detected), `stripComponents`, `targetDir` (default: `~/.builderforce/tools/<skillKey>`).

If no `metadata.builderforce` is present, the skill is always eligible (unless
disabled in config or blocked by `skills.allowBundled` for bundled skills).

## Config overrides (`~/.builderforce/builderforce.json`)

Bundled/managed skills can be toggled and supplied with env values:

```json5
{
  skills: {
    entries: {
      "nano-banana-pro": {
        enabled: true,
        apiKey: "GEMINI_KEY_HERE",
        env: {
          GEMINI_API_KEY: "GEMINI_KEY_HERE",
        },
        config: {
          endpoint: "https://example.invalid",
          model: "nano-pro",
        },
      },
      peekaboo: { enabled: true },
      sag: { enabled: false },
    },
  },
}
```

Note: if the skill name contains hyphens, quote the key (JSON5 allows quoted keys).

Config keys match the **skill name** by default. If a skill defines
`metadata.builderforce.skillKey`, use that key under `skills.entries`.

Rules:

- `enabled: false` disables the skill even if it’s bundled/installed.
- `env`: injected **only if** the variable isn’t already set in the process.
- `apiKey`: convenience for skills that declare `metadata.builderforce.primaryEnv`.
- `config`: optional bag for custom per-skill fields; custom keys must live here.
- `allowBundled`: optional allowlist for **bundled** skills only. If set, only
  bundled skills in the list are eligible (managed/workspace skills unaffected).

## Environment injection (per agent run)

When an agent run starts, BuilderForce Agents:

1. Reads skill metadata.
2. Applies any `skills.entries.<key>.env` or `skills.entries.<key>.apiKey` to
   `process.env`.
3. Builds the system prompt with **eligible** skills.
4. Restores the original environment after the run ends.

This is **scoped to the agent run**, not a global shell environment.

## Session snapshot (performance)

BuilderForce Agents snapshots the eligible skills **when a session starts** and reuses that list for subsequent turns in the same session. Changes to skills or config take effect on the next new session.

Skills can also refresh mid-session when the skills watcher is enabled or when a new eligible remote node appears (see below). Think of this as a **hot reload**: the refreshed list is picked up on the next agent turn.

## Remote macOS nodes (Linux gateway)

If the Gateway is running on Linux but a **macOS node** is connected **with `system.run` allowed** (Exec approvals security not set to `deny`), BuilderForce Agents can treat macOS-only skills as eligible when the required binaries are present on that node. The agent should execute those skills via the `nodes` tool (typically `nodes.run`).

This relies on the node reporting its command support and on a bin probe via `system.run`. If the macOS node goes offline later, the skills remain visible; invocations may fail until the node reconnects.

## Skills watcher (auto-refresh)

By default, BuilderForce Agents watches skill folders and bumps the skills snapshot when `SKILL.md` files change. Configure this under `skills.load`:

```json5
{
  skills: {
    load: {
      watch: true,
      watchDebounceMs: 250,
    },
  },
}
```

## Token impact (skills list)

When skills are eligible, BuilderForce Agents injects a compact XML list of available skills into the system prompt (via `formatSkillCatalog` in `@builderforce/agent-skills`, the same formatter cloud runs use). The cost is deterministic:

- **Base overhead (only when ≥1 skill):** 195 characters.
- **Per skill:** 97 characters + the length of the XML-escaped `<name>`, `<description>`, and `<location>` values.

Formula (characters):

```
total = 195 + Σ (97 + len(name_escaped) + len(description_escaped) + len(location_escaped))
```

Notes:

- XML escaping expands `& < > " '` into entities (`&amp;`, `&lt;`, etc.), increasing length.
- Token counts vary by model tokenizer. A rough OpenAI-style estimate is ~4 chars/token, so **97 chars ≈ 24 tokens** per skill plus your actual field lengths.

## Managed skills lifecycle

BuilderForce Agents ships a baseline set of skills as **bundled skills** as part of the
install (npm package or Builderforce.app). `~/.builderforce/skills` exists for local
overrides (for example, pinning/patching a skill without changing the bundled
copy). Workspace skills are user-owned and override both on name conflicts.

## Config reference

See [Skills config](/tools/skills-config) for the full configuration schema.

## Looking for more skills?

Browse [https://agenthub.com](https://agenthub.com).

---
