---
read_when:
  - 安装 BuilderForce Agents
  - 你想从 GitHub 安装
summary: 安装 BuilderForce Agents（推荐安装器、全局安装或从源代码安装）
title: 安装
x-i18n:
  generated_at: "2026-02-03T10:07:43Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: b26f48c116c26c163ee0090fb4c3e29622951bd427ecaeccba7641d97cfdf17a
  source_path: install/index.md
  workflow: 15
---

# 安装

除非有特殊原因，否则请使用安装器。它会设置 CLI 并运行新手引导。

## 快速安装（推荐）

```bash
curl -fsSL https://builderforce.ai/install.sh | bash
```

Windows（PowerShell）：

```powershell
iwr -useb https://builderforce.ai/install.ps1 | iex
```

下一步（如果你跳过了新手引导）：

```bash
builderforce onboard --install-daemon
```

## 系统要求

- **Node >=22**
- macOS、Linux 或通过 WSL2 的 Windows
- `pnpm` 仅在从源代码构建时需要

## 选择安装路径

### 1）安装器脚本（推荐）

通过 npm 全局安装 `@seanhogg/builderforce-agents`（即 `builderforce` CLI）。如果提供了工作区令牌，还会注册本机并启动 Gateway 网关；否则安装后请运行 `builderforce onboard --install-daemon`。需要 `PATH` 中已有 Node.js 20+ 和 npm。

```bash
curl -fsSL https://builderforce.ai/install.sh | bash
```

安装器不接受命令行参数，通过环境变量配置。详情：[安装器内部原理](/install/installer)。

注册但暂不启动 Gateway 网关：

```bash
curl -fsSL https://builderforce.ai/install.sh | BUILDERFORCE_NO_START=1 bash
```

### 2）全局安装（手动）

如果你已经有 Node：

```bash
npm install -g @seanhogg/builderforce-agents@latest
```

如果你全局安装了 libvips（macOS 上通过 Homebrew 安装很常见）且 `sharp` 安装失败，请强制使用预构建二进制文件：

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install -g @seanhogg/builderforce-agents@latest
```

如果你看到 `sharp: Please add node-gyp to your dependencies`，要么安装构建工具（macOS：Xcode CLT + `npm install -g node-gyp`），要么使用上面的 `SHARP_IGNORE_GLOBAL_LIBVIPS=1` 变通方法来跳过原生构建。

或使用 pnpm：

```bash
pnpm add -g @seanhogg/builderforce-agents@latest
pnpm approve-builds -g                # 批准 @seanhogg/builderforce-agents、node-llama-cpp、sharp 等
pnpm add -g @seanhogg/builderforce-agents@latest   # 重新运行以执行 postinstall 脚本
```

pnpm 需要显式批准带有构建脚本的包。在首次安装显示"Ignored build scripts"警告后，运行 `pnpm approve-builds -g` 并选择列出的包，然后重新运行安装以执行 postinstall 脚本。

然后：

```bash
builderforce onboard --install-daemon
```

### 3）从源代码（贡献者/开发）

```bash
git clone https://github.com/SeanHogg/Builderforce.ai.git
cd builderforce
pnpm install
pnpm ui:build # 首次运行时自动安装 UI 依赖
pnpm build
builderforce onboard --install-daemon
```

提示：如果你还没有全局安装，请通过 `pnpm builderforce ...` 运行仓库命令。

### 4）其他安装选项

- Docker：[Docker](/install/docker)
- Nix：[Nix](/install/nix)
- Ansible：[Ansible](/install/ansible)
- Bun（仅 CLI）：[Bun](/install/bun)

## 安装后

- 运行新手引导：`builderforce onboard --install-daemon`
- 快速检查：`builderforce doctor`
- 检查 Gateway 网关健康状态：`builderforce status` + `builderforce health`
- 打开仪表板：`builderforce dashboard`

## 安装方式：npm vs git（安装器）

- `install.sh` / `install.ps1` 只支持 npm：`npm install -g @seanhogg/builderforce-agents@latest`
- `install-cli.sh` 支持 `npm`（默认）和 `git`（从 GitHub 克隆/构建并从源代码 checkout 运行）

### CLI 标志（install-cli.sh）

```bash
# 显式 npm
curl -fsSL https://builderforce.ai/install-cli.sh | bash -s -- --install-method npm

# 从 GitHub 安装（源代码 checkout）
curl -fsSL https://builderforce.ai/install-cli.sh | bash -s -- --install-method git
```

常用标志：

- `--install-method npm|git`
- `--git-dir <path>`（默认：`~/builderforce`）
- `--no-git-update`（使用现有 checkout 时跳过 `git pull`）
- `--prefix <path>`（默认：`~/.builderforce`）
- `--onboard` / `--no-onboard`（默认跳过新手引导）

### 环境变量

`install-cli.sh` 读取的环境变量（名称沿用改名之前的写法）：

- `CODERCLAW_INSTALL_METHOD=npm|git`
- `CODERCLAW_GIT_DIR=...`
- `CODERCLAW_GIT_UPDATE=0|1`
- `CODERCLAW_NO_ONBOARD=1`
- `SHARP_IGNORE_GLOBAL_LIBVIPS=0|1`（默认：`1`；避免 `sharp` 针对系统 libvips 构建）

`install.sh` 读取的环境变量：`BUILDERFORCE_TAG`、`BUILDERFORCE_TOKEN`、`BUILDERFORCE_WORKSPACE`、`BUILDERFORCE_URL`、`BUILDERFORCE_NO_START`。

## 故障排除：找不到 `builderforce`（PATH）

快速诊断：

```bash
node -v
npm -v
npm prefix -g
echo "$PATH"
```

如果 `$(npm prefix -g)/bin`（macOS/Linux）或 `$(npm prefix -g)`（Windows）**不**在 `echo "$PATH"` 的输出中，你的 shell 无法找到全局 npm 二进制文件（包括 `builderforce`）。

修复：将其添加到你的 shell 启动文件（zsh：`~/.zshrc`，bash：`~/.bashrc`）：

```bash
# macOS / Linux
export PATH="$(npm prefix -g)/bin:$PATH"
```

在 Windows 上，将 `npm prefix -g` 的输出添加到你的 PATH。

然后打开新终端（或在 zsh 中执行 `rehash` / 在 bash 中执行 `hash -r`）。

## 更新/卸载

- 更新：[更新](/install/updating)
- 迁移到新机器：[迁移](/install/migrating)
- 卸载：[卸载](/install/uninstall)
