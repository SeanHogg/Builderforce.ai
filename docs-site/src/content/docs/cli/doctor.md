---
summary: "CLI reference for `builderforce doctor` (health checks + guided repairs)"
read_when:
  - You have connectivity/auth issues and want guided fixes
  - You updated and want a sanity check
title: "doctor"
---

# `builderforce doctor`

Health checks + quick fixes for the gateway and channels.

Related:

- Troubleshooting: [Troubleshooting](/gateway/troubleshooting)
- Security audit: [Security](/gateway/security)

## Examples

```bash
builderforce doctor
builderforce doctor --repair
builderforce doctor --deep
```

Notes:

- Interactive prompts (like keychain/OAuth fixes) only run when stdin is a TTY and `--non-interactive` is **not** set. Headless runs (cron, Telegram, no terminal) will skip prompts.
- `--fix` (alias for `--repair`) writes a backup to `~/.builderforce/builderforce.json.bak` and drops unknown config keys, listing each removal.

## macOS: `launchctl` env overrides

If you previously ran `launchctl setenv BUILDERFORCE_AGENTS_GATEWAY_TOKEN ...` (or `...PASSWORD`), that value overrides your config file and can cause persistent “unauthorized” errors.

```bash
launchctl getenv BUILDERFORCE_AGENTS_GATEWAY_TOKEN
launchctl getenv BUILDERFORCE_AGENTS_GATEWAY_PASSWORD

launchctl unsetenv BUILDERFORCE_AGENTS_GATEWAY_TOKEN
launchctl unsetenv BUILDERFORCE_AGENTS_GATEWAY_PASSWORD
```
