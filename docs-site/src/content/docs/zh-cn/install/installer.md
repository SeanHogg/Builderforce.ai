---
read_when:
  - 你想了解 `builderforce.ai/install.sh` 的工作机制
  - 你想自动化安装（CI / 无头环境）
  - 你想从 GitHub 检出安装
summary: 安装器脚本的工作原理（install.sh、install-cli.sh、install.ps1）、参数和自动化
title: 安装器内部机制
x-i18n:
  generated_at: "2026-02-01T21:07:55Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: 9e0a19ecb5da0a395030e1ccf0d4bedf16b83946b3432c5399d448fe5d298391
  source_path: install/installer.md
  workflow: 14
---

# 安装器内部机制

BuilderForce Agents 提供三个安装器脚本（托管在 `builderforce.ai`）。它们都安装 npm 包 `@seanhogg/builderforce-agents`，该包提供 `builderforce` CLI。

- `https://builderforce.ai/install.sh` — 使用你 `PATH` 中已有的 npm 进行全局安装；如果提供了工作区令牌，还会注册本机并启动 Gateway 网关
- `https://builderforce.ai/install-cli.sh` — 无需 root 权限的 CLI 安装器（安装到带有独立 Node 的前缀目录，支持 npm 或 git 检出）
- `https://builderforce.ai/install.ps1` — Windows PowerShell 版的 `install.sh`

`install-cli.sh` 的参数/行为：

```bash
curl -fsSL https://builderforce.ai/install-cli.sh | bash -s -- --help
```

如果安装器完成但在新终端中找不到 `builderforce`，通常是 Node/npm PATH 问题。参见：[安装](/install#nodejs--npm-path-sanity)。

## install.sh（推荐）

功能概述：

- 检查 `PATH` 中是否有 `npm`；没有则报错退出。脚本不会安装 Node.js，请先安装 Node.js 20+（或改用自带 Node 的 `install-cli.sh`）。
- 运行 `npm install -g @seanhogg/builderforce-agents@<tag>`（`BUILDERFORCE_TAG`，默认 `latest`）。
- 设置了 `BUILDERFORCE_TOKEN` 时：运行 `builderforce connect` 将本机注册为智能体主机，然后启动 `builderforce gateway`（设置 `BUILDERFORCE_NO_START` 时跳过启动）。
- 没有令牌时：安装后结束，并提示运行 `builderforce onboard`。

`install.sh` 不接受命令行参数，通过以下环境变量配置：

- `BUILDERFORCE_TAG=<dist-tag|version>` — 要安装的 npm dist-tag 或版本（默认：`latest`）
- `BUILDERFORCE_TOKEN=<token>` — 工作区令牌；设置后注册本机
- `BUILDERFORCE_WORKSPACE=<workgroup>` — 要注册到的工作组（由 `builderforce connect` 读取）
- `BUILDERFORCE_URL=<url>` — API 基础 URL（默认：`https://api.builderforce.ai`）
- `BUILDERFORCE_NO_START=1` — 仅注册，不启动 Gateway 网关

示例（安装 beta 版本）：

```bash
curl -fsSL https://builderforce.ai/install.sh | BUILDERFORCE_TAG=beta bash
```

[builderforce.ai/workforce](https://builderforce.ai/workforce) 上的"连接新智能体"命令会替你设置令牌和工作区。它们从环境变量读取，不会出现在命令行或 shell 历史中。

## install-cli.sh（无需 root 权限的 CLI 安装器）

此脚本将 `builderforce` 安装到前缀目录（默认：`~/.builderforce`），同时在该前缀下安装专用的 Node 运行时，因此可以在不想改动系统 Node/npm 的机器上使用。

- `npm`（默认）：`npm install -g --prefix <prefix> @seanhogg/builderforce-agents@<version>`
- `git`：克隆/更新 `https://github.com/SeanHogg/Builderforce.ai`，用 pnpm 安装并构建其中的 `agent-runtime` 包

从 GitHub 检出安装：

```bash
curl -fsSL https://builderforce.ai/install-cli.sh | bash -s -- --install-method git
```

`install-cli.sh` 读取的环境变量（名称沿用改名之前的写法，以保证现有自动化继续可用）：

- `CODERCLAW_PREFIX=<path>` — 安装前缀
- `CODERCLAW_VERSION=latest|next|<semver>` — 版本或 npm dist-tag
- `CODERCLAW_NODE_VERSION=<ver>` — Node 版本（默认：`22.22.0`）
- `CODERCLAW_INSTALL_METHOD=npm|git` — 安装方式
- `CODERCLAW_GIT_DIR=<path>` — git 方式的检出目录（默认：`~/builderforce`）
- `CODERCLAW_GIT_UPDATE=0|1` — 设为 `0` 跳过 `git pull`
- `CODERCLAW_NO_ONBOARD=1` — 跳过新手引导
- `CODERCLAW_NPM_LOGLEVEL=error|warn|notice` — npm 日志级别
- `SHARP_IGNORE_GLOBAL_LIBVIPS=0|1` — 默认 `1`，避免 `sharp` 针对系统 libvips 编译

### 为什么在全新 Linux 上 npm 会报 `EACCES`

在某些 Linux 设置中，npm 的全局前缀指向 root 拥有的位置，此时 `npm install -g ...` 会报 `EACCES` / `mkdir` 权限错误。使用 `install-cli.sh`（安装到自己的前缀），或传入 `--set-npm-prefix` 将 npm 前缀切换到 `~/.npm-global`（并在存在时将其添加到 `~/.bashrc` / `~/.zshrc` 的 `PATH` 中）。

## install.ps1（Windows PowerShell）

功能概述：

- 检查 `PATH` 中是否有 `npm`；没有则停止（请先安装 Node.js 20+）。需要 PowerShell 5.1+。
- 运行 `npm install -g @seanhogg/builderforce-agents@<Tag>`（默认 `latest`）。
- 设置了 `$env:BUILDERFORCE_TOKEN` 时：运行 `builderforce connect`，然后启动 `builderforce gateway`（传入 `-NoStart` 时跳过）。
- 脚本从不调用 `exit`，因此通过 `iex` 运行不会关闭你的 PowerShell 会话。

示例：

```powershell
iwr -useb https://builderforce.ai/install.ps1 | iex
```

```powershell
& ([scriptblock]::Create((iwr -useb https://builderforce.ai/install.ps1))) -Tag beta -NoStart
```

参数：

- `-Tag <tag>` — npm dist-tag 或版本（默认：`latest`）
- `-ApiUrl <url>` — API 基础 URL（默认：`$env:BUILDERFORCE_URL` 或 `https://api.builderforce.ai`）
- `-NoStart` — 仅安装和注册，不启动 Gateway 网关

环境变量：

- `BUILDERFORCE_TOKEN` — 工作区令牌；设置后注册本机
- `BUILDERFORCE_WORKSPACE` — 要注册到的工作组
- `BUILDERFORCE_URL` — API 基础 URL（未传 `-ApiUrl` 时使用）

在 CMD 中，`https://builderforce.ai/install.cmd` 会下载 `install.ps1`，并将 `--tag <ver>` 和 `--no-start` 转换为 `-Tag` 和 `-NoStart`。

常见 Windows 问题：

- **npm error spawn git / ENOENT**：安装 Git for Windows 并重新打开 PowerShell，然后重新运行安装器。
- **"builderforce" 不是可识别的命令**：你的 npm 全局 bin 文件夹不在 PATH 中。大多数系统使用 `%AppData%\\npm`。你也可以运行 `npm config get prefix` 并将 `\\bin` 添加到 PATH，然后重新打开 PowerShell。
