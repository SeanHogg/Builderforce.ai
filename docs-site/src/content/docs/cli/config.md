---
summary: "CLI reference for `coderclaw config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
title: "config"
---

# `coderclaw config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `coderclaw configure`).

## Examples

```bash
coderclaw config get browser.executablePath
coderclaw config set browser.executablePath "/usr/bin/google-chrome"
coderclaw config set agents.defaults.heartbeat.every "2h"
coderclaw config set agents.list[0].tools.exec.node "node-id-or-name"
coderclaw config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
coderclaw config get agents.defaults.workspace
coderclaw config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
coderclaw config get agents.list
coderclaw config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--json` to require JSON5 parsing.

```bash
coderclaw config set agents.defaults.heartbeat.every "0m"
coderclaw config set gateway.port 19001 --json
coderclaw config set channels.whatsapp.groups '["*"]' --json
```

Restart the gateway after edits.
