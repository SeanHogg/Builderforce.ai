---
summary: "Fix Chrome/Brave/Edge/Chromium CDP startup issues for BuilderForce Agents browser control on Linux"
read_when: "Browser control fails on Linux, especially with snap Chromium"
title: "Browser Troubleshooting"
---

# Browser Troubleshooting (Linux)

## Problem: "Failed to start Chrome CDP on port 18800"

BuilderForce Agents's browser control server fails to launch Chrome/Brave/Edge/Chromium with the error:

```
{"error":"Error: Failed to start Chrome CDP on port 18800 for profile \"builderforce\"."}
```

### Root Cause

On Ubuntu (and many Linux distros), the default Chromium installation is a **snap package**. Snap's AppArmor confinement interferes with how BuilderForce Agents spawns and monitors the browser process.

The `apt install chromium` command installs a stub package that redirects to snap:

```
Note, selecting 'chromium-browser' instead of 'chromium'
chromium-browser is already the newest version (2:1snap1-0ubuntu2).
```

This is NOT a real browser — it's just a wrapper.

### Solution 1: Install Google Chrome (Recommended)

Install the official Google Chrome `.deb` package, which is not sandboxed by snap:

```bash
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
sudo apt --fix-broken install -y  # if there are dependency errors
```

Then update your BuilderForce Agents config (`~/.builderforce/builderforce.json`):

```json
{
  "browser": {
    "enabled": true,
    "executablePath": "/usr/bin/google-chrome-stable",
    "headless": true,
    "noSandbox": true
  }
}
```

### Solution 2: Use Snap Chromium with Attach-Only Mode

If you must use snap Chromium, configure BuilderForce Agents to attach to a manually-started browser:

1. Update config:

```json
{
  "browser": {
    "enabled": true,
    "attachOnly": true,
    "headless": true,
    "noSandbox": true
  }
}
```

2. Start Chromium manually:

```bash
chromium-browser --headless --no-sandbox --disable-gpu \
  --remote-debugging-port=18800 \
  --user-data-dir=$HOME/.builderforce/browser/builderforce/user-data \
  about:blank &
```

3. Optionally create a systemd user service to auto-start Chrome:

```ini
# ~/.config/systemd/user/builderforce-browser.service
[Unit]
Description=BuilderForce Agents Browser (Chrome CDP)
After=network.target

[Service]
ExecStart=/snap/bin/chromium --headless --no-sandbox --disable-gpu --remote-debugging-port=18800 --user-data-dir=%h/.builderforce/browser/builderforce/user-data about:blank
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Enable with: `systemctl --user enable --now builderforce-browser.service`

### Verifying the Browser Works

Check status:

```bash
curl -s http://127.0.0.1:18791/ | jq '{running, pid, chosenBrowser}'
```

Test browsing:

```bash
curl -s -X POST http://127.0.0.1:18791/start
curl -s http://127.0.0.1:18791/tabs
```

### Config Reference

| Option                   | Description                                                          | Default                                                     |
| ------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `browser.enabled`        | Enable browser control                                               | `true`                                                      |
| `browser.executablePath` | Path to a Chromium-based browser binary (Chrome/Brave/Edge/Chromium) | auto-detected (prefers default browser when Chromium-based) |
| `browser.headless`       | Run without GUI                                                      | `false`                                                     |
| `browser.noSandbox`      | Add `--no-sandbox` flag (needed for some Linux setups)               | `false`                                                     |
| `browser.attachOnly`     | Don't launch browser, only attach to existing                        | `false`                                                     |
| `browser.cdpPort`        | Chrome DevTools Protocol port                                        | `18800`                                                     |

### Problem: "Chrome extension relay is running, but no tab is connected"

You’re using the `chrome` profile (extension relay). It expects the BuilderForce Agents
browser extension to be attached to a live tab.

Fix options:

1. **Use the managed browser:** `builderforce browser start --browser-profile builderforce`
   (or set `browser.defaultProfile: "builderforce"`).
2. **Use the extension relay:** install the extension, open a tab, and click the
   BuilderForce Agents extension icon to attach it.

Notes:

- The `chrome` profile uses your **system default Chromium browser** when possible.
- Local `builderforce` profiles auto-assign `cdpPort`/`cdpUrl`; only set those for remote CDP.
