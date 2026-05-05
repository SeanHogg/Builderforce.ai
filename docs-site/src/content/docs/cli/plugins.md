---
summary: "CLI reference for `coderclaw plugins` (list, install, uninstall, enable/disable, doctor)"
read_when:
  - You want to install or manage in-process Gateway plugins
  - You want to debug plugin load failures
title: "plugins"
---

# `coderclaw plugins`

Manage Gateway plugins/extensions (loaded in-process).

Related:

- Plugin system: [Plugins](/tools/plugin)
- Plugin manifest + schema: [Plugin manifest](/plugins/manifest)
- Security hardening: [Security](/gateway/security)

## Commands

```bash
coderclaw plugins list
coderclaw plugins info <id>
coderclaw plugins enable <id>
coderclaw plugins disable <id>
coderclaw plugins uninstall <id>
coderclaw plugins doctor
coderclaw plugins update <id>
coderclaw plugins update --all
```

Bundled plugins ship with CoderClaw but start disabled. Use `plugins enable` to
activate them.

All plugins must ship a `coderclaw.plugin.json` file with an inline JSON Schema
(`configSchema`, even if empty). Missing/invalid manifests or schemas prevent
the plugin from loading and fail config validation.

### Install

```bash
coderclaw plugins install <path-or-spec>
```

Security note: treat plugin installs like running code. Prefer pinned versions.

Npm specs are **registry-only** (package name + optional version/tag). Git/URL/file
specs are rejected. Dependency installs run with `--ignore-scripts` for safety.

Supported archives: `.zip`, `.tgz`, `.tar.gz`, `.tar`.

Use `--link` to avoid copying a local directory (adds to `plugins.load.paths`):

```bash
coderclaw plugins install -l ./my-plugin
```

### Uninstall

```bash
coderclaw plugins uninstall <id>
coderclaw plugins uninstall <id> --dry-run
coderclaw plugins uninstall <id> --keep-files
```

`uninstall` removes plugin records from `plugins.entries`, `plugins.installs`,
the plugin allowlist, and linked `plugins.load.paths` entries when applicable.
For active memory plugins, the memory slot resets to `memory-core`.

By default, uninstall also removes the plugin install directory under the active
state dir extensions root (`$CODERCLAW_STATE_DIR/extensions/<id>`). Use
`--keep-files` to keep files on disk.

`--keep-config` is supported as a deprecated alias for `--keep-files`.

### Update

```bash
coderclaw plugins update <id>
coderclaw plugins update --all
coderclaw plugins update <id> --dry-run
```

Updates only apply to plugins installed from npm (tracked in `plugins.installs`).
