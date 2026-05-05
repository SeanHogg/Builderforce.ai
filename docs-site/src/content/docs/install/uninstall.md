---
summary: "Uninstall CoderClaw completely (CLI, service, state, workspace)"
read_when:
  - You want to remove CoderClaw from a machine
  - The gateway service is still running after uninstall
title: "Uninstall"
---

# Uninstall

Two paths:

- **Easy path** if `coderclaw` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
coderclaw uninstall
```

Non-interactive (automation / npx):

```bash
coderclaw uninstall --all --yes --non-interactive
npx -y coderclaw uninstall --all --yes --non-interactive
```

Manual steps (same result):

1. Stop the gateway service:

```bash
coderclaw gateway stop
```

2. Uninstall the gateway service (launchd/systemd/schtasks):

```bash
coderclaw gateway uninstall
```

3. Delete state + config:

```bash
rm -rf "${CODERCLAW_STATE_DIR:-$HOME/.coderclaw}"
```

If you set `CODERCLAW_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/.coderclaw/workspace
```

5. Remove the CLI install (pick the one you used):

```bash
npm rm -g coderclaw
pnpm remove -g coderclaw
bun remove -g coderclaw
```

6. If you installed the macOS app:

```bash
rm -rf /Applications/CoderClaw.app
```

Notes:

- If you used profiles (`--profile` / `CODERCLAW_PROFILE`), repeat step 3 for each state dir (defaults are `~/.coderclaw-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `coderclaw` is missing.

### macOS (launchd)

Default label is `bot.molt.gateway` (or `bot.molt.<profile>`; legacy `com.coderclaw.*` may still exist):

```bash
launchctl bootout gui/$UID/bot.molt.gateway
rm -f ~/Library/LaunchAgents/bot.molt.gateway.plist
```

If you used a profile, replace the label and plist name with `bot.molt.<profile>`. Remove any legacy `com.coderclaw.*` plists if present.

### Linux (systemd user unit)

Default unit name is `coderclaw-gateway.service` (or `coderclaw-gateway-<profile>.service`):

```bash
systemctl --user disable --now coderclaw-gateway.service
rm -f ~/.config/systemd/user/coderclaw-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `CoderClaw Gateway` (or `CoderClaw Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "CoderClaw Gateway"
Remove-Item -Force "$env:USERPROFILE\.coderclaw\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.coderclaw-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://coderclaw.ai/install.sh` or `install.ps1`, the CLI was installed with `npm install -g coderclaw@latest`.
Remove it with `npm rm -g coderclaw` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `coderclaw ...` / `bun run coderclaw ...`):

1. Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2. Delete the repo directory.
3. Remove state + workspace as shown above.
