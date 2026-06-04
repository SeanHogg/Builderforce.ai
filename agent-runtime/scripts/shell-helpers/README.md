# AgentNodeDock <!-- omit in toc -->

Stop typing `docker-compose` commands. Just type `agentNodedock-start`.

Inspired by Simon Willison's [Running BuilderForceAgents in Docker](https://til.simonwillison.net/llms/builderforce-docker).

- [Quickstart](#quickstart)
- [Available Commands](#available-commands)
  - [Basic Operations](#basic-operations)
  - [Container Access](#container-access)
  - [Web UI \& Devices](#web-ui--devices)
  - [Setup \& Configuration](#setup--configuration)
  - [Maintenance](#maintenance)
  - [Utilities](#utilities)
- [Common Workflows](#common-workflows)
  - [Check Status and Logs](#check-status-and-logs)
  - [Set Up WhatsApp Bot](#set-up-whatsapp-bot)
  - [Troubleshooting Device Pairing](#troubleshooting-device-pairing)
  - [Fix Token Mismatch Issues](#fix-token-mismatch-issues)
  - [Permission Denied](#permission-denied)
- [Requirements](#requirements)

## Quickstart

**Install:**

```bash
mkdir -p ~/.agentNodedock && curl -sL https://raw.githubusercontent.com/builderforce/builderforce/main/scripts/shell-helpers/agentNodedock-helpers.sh -o ~/.agentNodedock/agentNodedock-helpers.sh
```

```bash
echo 'source ~/.agentNodedock/agentNodedock-helpers.sh' >> ~/.zshrc && source ~/.zshrc
```

**See what you get:**

```bash
agentNodedock-help
```

On first command, AgentNodeDock auto-detects your BuilderForceAgents directory:

- Checks common paths (`~/builderforce`, `~/workspace/builderforce`, etc.)
- If found, asks you to confirm
- Saves to `~/.agentNodedock/config`

**First time setup:**

```bash
agentNodedock-start
```

```bash
agentNodedock-fix-token
```

```bash
agentNodedock-dashboard
```

If you see "pairing required":

```bash
agentNodedock-devices
```

And approve the request for the specific device:

```bash
agentNodedock-approve <request-id>
```

## Available Commands

### Basic Operations

| Command            | Description                     |
| ------------------ | ------------------------------- |
| `agentNodedock-start`   | Start the gateway               |
| `agentNodedock-stop`    | Stop the gateway                |
| `agentNodedock-restart` | Restart the gateway             |
| `agentNodedock-status`  | Check container status          |
| `agentNodedock-logs`    | View live logs (follows output) |

### Container Access

| Command                   | Description                                    |
| ------------------------- | ---------------------------------------------- |
| `agentNodedock-shell`          | Interactive shell inside the gateway container |
| `agentNodedock-cli <command>`  | Run BuilderForceAgents CLI commands                     |
| `agentNodedock-exec <command>` | Execute arbitrary commands in the container    |

### Web UI & Devices

| Command                 | Description                                |
| ----------------------- | ------------------------------------------ |
| `agentNodedock-dashboard`    | Open web UI in browser with authentication |
| `agentNodedock-devices`      | List device pairing requests               |
| `agentNodedock-approve <id>` | Approve a device pairing request           |

### Setup & Configuration

| Command              | Description                                       |
| -------------------- | ------------------------------------------------- |
| `agentNodedock-fix-token` | Configure gateway authentication token (run once) |

### Maintenance

| Command            | Description                                      |
| ------------------ | ------------------------------------------------ |
| `agentNodedock-rebuild` | Rebuild the Docker image                         |
| `agentNodedock-clean`   | Remove all containers and volumes (destructive!) |

### Utilities

| Command              | Description                               |
| -------------------- | ----------------------------------------- |
| `agentNodedock-health`    | Run gateway health check                  |
| `agentNodedock-token`     | Display the gateway authentication token  |
| `agentNodedock-cd`        | Jump to the BuilderForceAgents project directory   |
| `agentNodedock-config`    | Open the BuilderForceAgents config directory       |
| `agentNodedock-workspace` | Open the workspace directory              |
| `agentNodedock-help`      | Show all available commands with examples |

## Common Workflows

### Check Status and Logs

**Restart the gateway:**

```bash
agentNodedock-restart
```

**Check container status:**

```bash
agentNodedock-status
```

**View live logs:**

```bash
agentNodedock-logs
```

### Set Up WhatsApp Bot

**Shell into the container:**

```bash
agentNodedock-shell
```

**Inside the container, login to WhatsApp:**

```bash
builderforce channels login --channel whatsapp --verbose
```

Scan the QR code with WhatsApp on your phone.

**Verify connection:**

```bash
builderforce status
```

### Troubleshooting Device Pairing

**Check for pending pairing requests:**

```bash
agentNodedock-devices
```

**Copy the Request ID from the "Pending" table, then approve:**

```bash
agentNodedock-approve <request-id>
```

Then refresh your browser.

### Fix Token Mismatch Issues

If you see "gateway token mismatch" errors:

```bash
agentNodedock-fix-token
```

This will:

1. Read the token from your `.env` file
2. Configure it in the BuilderForceAgents config
3. Restart the gateway
4. Verify the configuration

### Permission Denied

**Ensure Docker is running and you have permission:**

```bash
docker ps
```

## Requirements

- Docker and Docker Compose installed
- Bash or Zsh shell
- BuilderForceAgents project (from `docker-setup.sh`)

## Development

**Test with fresh config (mimics first-time install):**

```bash
unset CLAWDOCK_DIR && rm -f ~/.agentNodedock/config && source scripts/shell-helpers/agentNodedock-helpers.sh
```

Then run any command to trigger auto-detect:

```bash
agentNodedock-start
```
