---
summary: "CLI reference for `builderforce plugins` (list, install, uninstall, enable/disable, doctor)"
read_when:
  - You want to install or manage in-process Gateway plugins
  - You want to debug plugin load failures
title: "plugins"
---

# `builderforce plugins`

Manage Gateway plugins/extensions (loaded in-process).

Related:

- Plugin system: [Plugins](/tools/plugin)
- Plugin manifest + schema: [Plugin manifest](/plugins/manifest)
- Security hardening: [Security](/gateway/security)

## Commands

```bash
builderforce plugins list
builderforce plugins info <id>
builderforce plugins enable <id>
builderforce plugins disable <id>
builderforce plugins uninstall <id>
builderforce plugins doctor
builderforce plugins update <id>
builderforce plugins update --all
```

Bundled plugins ship with BuilderForce Agents but start disabled. Use `plugins enable` to
activate them.

All plugins must ship a `builderforce.plugin.json` file with an inline JSON Schema
(`configSchema`, even if empty). Missing/invalid manifests or schemas prevent
the plugin from loading and fail config validation.

### Install

```bash
builderforce plugins install <path-or-spec>
```

Security note: treat plugin installs like running code. Prefer pinned versions.

Npm specs are **registry-only** (package name + optional version/tag). Git/URL/file
specs are rejected. Dependency installs run with `--ignore-scripts` for safety.

Supported archives: `.zip`, `.tgz`, `.tar.gz`, `.tar`.

Use `--link` to avoid copying a local directory (adds to `plugins.load.paths`):

```bash
builderforce plugins install -l ./my-plugin
```

### Uninstall

```bash
builderforce plugins uninstall <id>
builderforce plugins uninstall <id> --dry-run
builderforce plugins uninstall <id> --keep-files
```

`uninstall` removes plugin records from `plugins.entries`, `plugins.installs`,
the plugin allowlist, and linked `plugins.load.paths` entries when applicable.
For active memory plugins, the memory slot resets to `memory-core`.

By default, uninstall also removes the plugin install directory under the active
state dir extensions root (`$BUILDERFORCE_AGENTS_STATE_DIR/extensions/<id>`). Use
`--keep-files` to keep files on disk.

`--keep-config` is supported as a deprecated alias for `--keep-files`.

### Update

```bash
builderforce plugins update <id>
builderforce plugins update --all
builderforce plugins update <id> --dry-run
```

Updates only apply to plugins installed from npm (tracked in `plugins.installs`).
