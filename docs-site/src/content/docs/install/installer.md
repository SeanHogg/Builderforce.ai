---
summary: "How the installer scripts work (install.sh, install-cli.sh, install.ps1), flags, and automation"
read_when:
  - You want to understand `builderforce.ai/install.sh`
  - You want to automate installs (CI / headless)
  - You want to install from a GitHub checkout
title: "Installer Internals"
---

# Installer internals

BuilderForce Agents ships three installer scripts, served from `builderforce.ai`. All of them install the npm package `@seanhogg/builderforce-agents`, which provides the `builderforce` CLI.

| Script                             | Platform             | What it does                                                                                                                                              |
| ---------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`install.sh`](#installsh)         | macOS / Linux / WSL  | Installs the package globally with the npm already on your `PATH`. With a workspace token it also registers this machine as an agent host and starts the gateway. |
| [`install-cli.sh`](#install-clish) | macOS / Linux / WSL  | Installs its own Node plus BuilderForce Agents into a local prefix (`~/.builderforce`), from npm or a git checkout. No root required.                        |
| [`install.ps1`](#installps1)       | Windows (PowerShell) | The Windows counterpart of `install.sh`.                                                                                                                  |

## Quick commands

<Tabs>
  <Tab title="install.sh">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install.sh | bash
    ```

    ```bash
    # Install the beta dist-tag instead of latest
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install.sh | BUILDERFORCE_TAG=beta bash
    ```

  </Tab>
  <Tab title="install-cli.sh">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install-cli.sh | bash
    ```

    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install-cli.sh | bash -s -- --help
    ```

  </Tab>
  <Tab title="install.ps1">
    ```powershell
    iwr -useb https://builderforce.ai/install.ps1 | iex
    ```

    ```powershell
    & ([scriptblock]::Create((iwr -useb https://builderforce.ai/install.ps1))) -Tag beta -NoStart
    ```

  </Tab>
</Tabs>

<Note>
If install succeeds but `builderforce` is not found in a new terminal, see [Node.js troubleshooting](/install/node#troubleshooting).
</Note>

---

## install.sh

<Tip>
Recommended on macOS/Linux/WSL when Node.js is already installed. If it is not, use [`install-cli.sh`](#install-clish), which brings its own Node.
</Tip>

### Flow (install.sh)

<Steps>
  <Step title="Check for npm">
    Exits with an error if `npm` is not on `PATH`. The script does not install Node.js; install Node.js 20+ from [nodejs.org](https://nodejs.org) first.
  </Step>
  <Step title="Install BuilderForce Agents">
    Runs `npm install -g @seanhogg/builderforce-agents@<tag>`, where the tag comes from `BUILDERFORCE_TAG` (default `latest`).
  </Step>
  <Step title="Register and start (only with a workspace token)">
    When `BUILDERFORCE_TOKEN` is set, runs `builderforce connect` to register this machine as an agent host, then starts `builderforce gateway` unless `BUILDERFORCE_NO_START` is set. Without a token it stops after installing and points you at `builderforce onboard`.
  </Step>
</Steps>

The "Connect a new agent" command on [builderforce.ai/workforce](https://builderforce.ai/workforce) sets the token and workspace for you. They are read from the environment by `builderforce connect`, so they never appear on the command line or in shell history.

### Examples (install.sh)

<Tabs>
  <Tab title="Default">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install.sh | bash
    ```
  </Tab>
  <Tab title="Specific version or tag">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install.sh | BUILDERFORCE_TAG=beta bash
    ```
  </Tab>
  <Tab title="Register without starting">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install.sh | \
      BUILDERFORCE_TOKEN=<token> BUILDERFORCE_WORKSPACE=<workgroup> BUILDERFORCE_NO_START=1 bash
    ```
  </Tab>
</Tabs>

<AccordionGroup>
  <Accordion title="Flags reference">

`install.sh` takes no command-line flags. Configure it with the environment variables below.

  </Accordion>

  <Accordion title="Environment variables reference">

| Variable                               | Description                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `BUILDERFORCE_TAG=<dist-tag\|version>` | npm dist-tag or version to install (default: `latest`)                              |
| `BUILDERFORCE_TOKEN=<token>`           | Workspace token. When set, the script registers this machine (`builderforce connect`) |
| `BUILDERFORCE_WORKSPACE=<workgroup>`   | Workgroup slug to register into (read by `builderforce connect`)                    |
| `BUILDERFORCE_URL=<url>`               | API base URL (default: `https://api.builderforce.ai`)                               |
| `BUILDERFORCE_NO_START=1`              | Register only; do not start the gateway                                             |

  </Accordion>
</AccordionGroup>

---

## install-cli.sh

<Info>
Designed for environments where you want everything under a local prefix (default `~/.builderforce`) and no system Node dependency.
</Info>

### Flow (install-cli.sh)

<Steps>
  <Step title="Install local Node runtime">
    Downloads Node tarball (default `22.22.0`) to `<prefix>/tools/node-v<version>` and verifies SHA-256.
  </Step>
  <Step title="Ensure Git">
    If Git is missing, attempts install via apt/dnf/yum on Linux or Homebrew on macOS.
  </Step>
  <Step title="Install BuilderForce Agents under prefix">
    - `npm` method (default): `npm install -g --prefix <prefix> @seanhogg/builderforce-agents@<version>` (retries `next` if `latest` fails)
    - `git` method: clones or updates `https://github.com/SeanHogg/Builderforce.ai` in the checkout directory, then installs and builds its `agent-runtime` package with pnpm

    Either way it writes a wrapper to `<prefix>/bin/builderforce` that runs the CLI on the prefix's Node.
  </Step>
</Steps>

### Examples (install-cli.sh)

<Tabs>
  <Tab title="Default">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install-cli.sh | bash
    ```
  </Tab>
  <Tab title="Custom prefix + version">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install-cli.sh | bash -s -- --prefix /opt/builderforce --version latest
    ```
  </Tab>
  <Tab title="Git checkout">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install-cli.sh | bash -s -- --install-method git
    ```
  </Tab>
  <Tab title="Automation JSON output">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install-cli.sh | bash -s -- --json --prefix /opt/builderforce
    ```
  </Tab>
  <Tab title="Run onboarding">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install-cli.sh | bash -s -- --onboard
    ```
  </Tab>
</Tabs>

<AccordionGroup>
  <Accordion title="Flags reference">

| Flag                                  | Description                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `--prefix <path>`                     | Install prefix (default: `~/.builderforce`)                                     |
| `--install-method npm\|git`           | Install method (default: `npm`). Alias: `--method`                              |
| `--npm`                               | Shortcut for `--install-method npm`                                             |
| `--git`                               | Shortcut for `--install-method git`. Alias: `--github`                          |
| `--git-dir <path>`                    | Checkout directory for the git method (default: `~/builderforce`). Alias: `--dir` |
| `--no-git-update`                     | Skip `git pull` for an existing checkout                                        |
| `--version <ver>`                     | BuilderForce Agents version or npm dist-tag (default: `latest`)                 |
| `--node-version <ver>`                | Node version (default: `22.22.0`)                                               |
| `--json`                              | Emit NDJSON events                                                              |
| `--onboard`                           | Run `builderforce onboard` after install                                        |
| `--no-onboard`                        | Skip onboarding (default)                                                       |
| `--set-npm-prefix`                    | On Linux, force npm prefix to `~/.npm-global` if current prefix is not writable |
| `--help`                              | Show usage (`-h`)                                                               |

  </Accordion>

  <Accordion title="Environment variables reference">

These are the variables `install-cli.sh` reads. Their names predate the BuilderForce rename and are kept so existing automation keeps working.

| Variable                                     | Description                                                     |
| -------------------------------------------- | --------------------------------------------------------------- |
| `CODERCLAW_PREFIX=<path>`                    | Install prefix (default: `~/.builderforce`)                     |
| `CODERCLAW_VERSION=latest\|next\|<semver>`   | BuilderForce Agents version or npm dist-tag                     |
| `CODERCLAW_NODE_VERSION=<ver>`               | Node version (default: `22.22.0`)                               |
| `CODERCLAW_INSTALL_METHOD=npm\|git`          | Install method (default: `npm`)                                 |
| `CODERCLAW_GIT_DIR=<path>`                   | Checkout directory for the git method (default: `~/builderforce`) |
| `CODERCLAW_GIT_UPDATE=0\|1`                  | Set `0` to skip `git pull` for an existing checkout             |
| `CODERCLAW_NO_ONBOARD=1`                     | Skip onboarding even when `--onboard` is passed                 |
| `CODERCLAW_NPM_LOGLEVEL=error\|warn\|notice` | npm log level (default: `error`)                                |
| `SHARP_IGNORE_GLOBAL_LIBVIPS=0\|1`           | Control sharp/libvips behavior (default: `1`)                   |

  </Accordion>
</AccordionGroup>

---

## install.ps1

### Flow (install.ps1)

<Steps>
  <Step title="Check for npm">
    Stops with an error if `npm` is not on `PATH`. Install Node.js 20+ from [nodejs.org](https://nodejs.org) first. Requires PowerShell 5.1+.
  </Step>
  <Step title="Install BuilderForce Agents">
    Runs `npm install -g @seanhogg/builderforce-agents@<Tag>` (default `latest`).
  </Step>
  <Step title="Register and start (only with a workspace token)">
    When `$env:BUILDERFORCE_TOKEN` is set, runs `builderforce connect`, then starts `builderforce gateway` unless `-NoStart` is passed. Without a token it stops after installing and points you at `builderforce onboard`.
  </Step>
</Steps>

The script never calls `exit`, so running it through `iex` does not close your PowerShell session.

### Examples (install.ps1)

<Tabs>
  <Tab title="Default">
    ```powershell
    iwr -useb https://builderforce.ai/install.ps1 | iex
    ```
  </Tab>
  <Tab title="Specific tag">
    ```powershell
    & ([scriptblock]::Create((iwr -useb https://builderforce.ai/install.ps1))) -Tag beta
    ```
  </Tab>
  <Tab title="Register without starting">
    ```powershell
    $env:BUILDERFORCE_TOKEN = "<token>"; $env:BUILDERFORCE_WORKSPACE = "<workgroup>"
    & ([scriptblock]::Create((iwr -useb https://builderforce.ai/install.ps1))) -NoStart
    ```
  </Tab>
  <Tab title="Debug trace">
    ```powershell
    # install.ps1 has no dedicated -Verbose flag.
    Set-PSDebug -Trace 1
    & ([scriptblock]::Create((iwr -useb https://builderforce.ai/install.ps1))) -NoStart
    Set-PSDebug -Trace 0
    ```
  </Tab>
</Tabs>

<AccordionGroup>
  <Accordion title="Flags reference">

| Flag             | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `-Tag <tag>`     | npm dist-tag or version (default: `latest`)                          |
| `-ApiUrl <url>`  | API base URL (default: `$env:BUILDERFORCE_URL` or `https://api.builderforce.ai`) |
| `-NoStart`       | Install and register only; do not start the gateway                  |

  </Accordion>

  <Accordion title="Environment variables reference">

| Variable                 | Description                                                     |
| ------------------------ | --------------------------------------------------------------- |
| `BUILDERFORCE_TOKEN`     | Workspace token. When set, the script registers this machine    |
| `BUILDERFORCE_WORKSPACE` | Workgroup slug to register into (read by `builderforce connect`) |
| `BUILDERFORCE_URL`       | API base URL, used when `-ApiUrl` is not given                  |

  </Accordion>
</AccordionGroup>

<Note>
From CMD, `https://builderforce.ai/install.cmd` downloads `install.ps1` and passes `--tag <ver>` and `--no-start` through as `-Tag` and `-NoStart`.
</Note>

---

## CI and automation

`install.sh` and `install.ps1` never prompt, so they run unattended as-is. Use `install-cli.sh` when you need a git checkout or machine-readable output.

<Tabs>
  <Tab title="install.sh (pinned tag)">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install.sh | BUILDERFORCE_TAG=latest bash
    ```
  </Tab>
  <Tab title="install-cli.sh (git checkout)">
    ```bash
    CODERCLAW_INSTALL_METHOD=git \
      curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install-cli.sh | bash
    ```
  </Tab>
  <Tab title="install-cli.sh (JSON)">
    ```bash
    curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install-cli.sh | bash -s -- --json --prefix /opt/builderforce
    ```
  </Tab>
  <Tab title="install.ps1 (install only)">
    ```powershell
    & ([scriptblock]::Create((iwr -useb https://builderforce.ai/install.ps1))) -NoStart
    ```
  </Tab>
</Tabs>

---

## Troubleshooting

<AccordionGroup>
  <Accordion title="install.sh says npm was not found">
    `install.sh` and `install.ps1` use the Node.js you already have. Install Node.js 20+ and re-run, or use `install-cli.sh`, which downloads its own Node into the prefix.
  </Accordion>

  <Accordion title="Why does install-cli.sh need Git?">
    Git is required for the `git` install method. For `npm` installs, `install-cli.sh` still checks for Git (and installs it when it can) to avoid `spawn git ENOENT` failures when dependencies use git URLs.
  </Accordion>

  <Accordion title="Why does npm hit EACCES on Linux?">
    Some Linux setups point the npm global prefix at root-owned paths. Use `install-cli.sh`, which installs into its own prefix, or pass `--set-npm-prefix` to switch the npm prefix to `~/.npm-global` and append PATH exports to your shell rc files (when those files exist).
  </Accordion>

  <Accordion title="sharp/libvips issues">
    `install-cli.sh` defaults `SHARP_IGNORE_GLOBAL_LIBVIPS=1` to avoid sharp building against system libvips. To override:

    ```bash
    SHARP_IGNORE_GLOBAL_LIBVIPS=0 curl -fsSL --proto '=https' --tlsv1.2 https://builderforce.ai/install-cli.sh | bash
    ```

  </Accordion>

  <Accordion title='Windows: "npm error spawn git / ENOENT"'>
    Install Git for Windows, reopen PowerShell, rerun installer.
  </Accordion>

  <Accordion title='Windows: "builderforce is not recognized"'>
    Run `npm config get prefix`, append `\bin`, add that directory to user PATH, then reopen PowerShell.
  </Accordion>

  <Accordion title="Windows: how to get verbose installer output">
    `install.ps1` does not expose a `-Verbose` switch.
    Use PowerShell tracing for script-level diagnostics:

    ```powershell
    Set-PSDebug -Trace 1
    & ([scriptblock]::Create((iwr -useb https://builderforce.ai/install.ps1))) -NoStart
    Set-PSDebug -Trace 0
    ```

  </Accordion>

  <Accordion title="builderforce not found after install">
    Usually a PATH issue. See [Node.js troubleshooting](/install/node#troubleshooting).
  </Accordion>
</AccordionGroup>
