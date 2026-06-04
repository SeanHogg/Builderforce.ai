---
summary: "Uninstall BuilderForce Agents completely (CLI, service, state, workspace)"
read_when:
  - You want to remove BuilderForce Agents from a machine
  - The gateway service is still running after uninstall
title: "Uninstall"
---

# Uninstall

Two paths:

- **Easy path** if `builderforce` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
builderforce uninstall
```

Non-interactive (automation / npx):

```bash
builderforce uninstall --all --yes --non-interactive
npx -y builderforce uninstall --all --yes --non-interactive
```

Manual steps (same result):

1. Stop the gateway service:

```bash
builderforce gateway stop
```

2. Uninstall the gateway service (launchd/systemd/schtasks):

```bash
builderforce gateway uninstall
```

3. Delete state + config:

```bash
rm -rf "${BUILDERFORCE_AGENTS_STATE_DIR:-$HOME/.builderforce}"
```

If you set `BUILDERFORCE_AGENTS_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/.builderforce/workspace
```

5. Remove the CLI install (pick the one you used):

```bash
npm rm -g builderforce
pnpm remove -g builderforce
bun remove -g builderforce
```

6. If you installed the macOS app:

```bash
rm -rf /Applications/BuilderForce Agents.app
```

Notes:

- If you used profiles (`--profile` / `BUILDERFORCE_AGENTS_PROFILE`), repeat step 3 for each state dir (defaults are `~/.builderforce-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `builderforce` is missing.

### macOS (launchd)

Default label is `bot.molt.gateway` (or `bot.molt.<profile>`; legacy `com.builderforce.*` may still exist):

```bash
launchctl bootout gui/$UID/bot.molt.gateway
rm -f ~/Library/LaunchAgents/bot.molt.gateway.plist
```

If you used a profile, replace the label and plist name with `bot.molt.<profile>`. Remove any legacy `com.builderforce.*` plists if present.

### Linux (systemd user unit)

Default unit name is `builderforce-gateway.service` (or `builderforce-gateway-<profile>.service`):

```bash
systemctl --user disable --now builderforce-gateway.service
rm -f ~/.config/systemd/user/builderforce-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `BuilderForce Agents Gateway` (or `BuilderForce Agents Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "BuilderForce Agents Gateway"
Remove-Item -Force "$env:USERPROFILE\.builderforce\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.builderforce-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://builderforce.ai/install.sh` or `install.ps1`, the CLI was installed with `npm install -g builderforce@latest`.
Remove it with `npm rm -g builderforce` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `builderforce ...` / `bun run builderforce ...`):

1. Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2. Delete the repo directory.
3. Remove state + workspace as shown above.
