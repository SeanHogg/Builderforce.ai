---
title: 创建 Skills
x-i18n:
  generated_at: "2026-02-03T10:10:19Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: ad801da34fe361ffa584ded47f775d1c104a471a3f7b7f930652255e98945c3a
  source_path: tools/creating-skills.md
  workflow: 15
---

# 创建自定义 Skills 🛠

Skills 是教 BuilderForce 智能体掌握新流程的主要方式。BuilderForce 遵循开放的 **[Agent Skills](https://agentskills.io) 标准**，因此你在这里编写的 Skill 也能在 Claude Code 以及任何读取该标准的智能体中使用，反之亦然。

## 什么是 Skill？

Skill 是一个**文件夹**，包含一个 `SKILL.md` 文件，以及（可选）其说明所引用的文件：

```
hello-world/
├── SKILL.md          # 必需：frontmatter + 说明
├── scripts/          # 可选：智能体可以运行的代码
├── references/       # 可选：额外文档，仅在需要时加载
└── assets/           # 可选：模板、数据
```

智能体起初只看到每个 Skill 的 `name` 和 `description`。当任务匹配时，它会加载 `SKILL.md` 的说明；只有当说明指向某个附带文件时，才会加载该文件。这就是标准中的*渐进式披露*：一个工作区可以容纳许多 Skills，而每个只占一行的成本。

## 分步指南：你的第一个 Skill

### 1. 创建文件夹

在自托管智能体上，Skill 文件夹可以放在以下任一位置（优先级从高到低）：

- `<workspace>/skills/`
- `<workspace>/.claude/skills/` 或 `<workspace>/.agents/skills/`
- `~/.claude/skills/` 或 `~/.agents/skills/`
- `~/.builderforce/skills/`（托管；分配的 Skills 会同步到这里）

```bash
mkdir -p ~/.builderforce/workspace/skills/hello-world
```

### 2. 编写 `SKILL.md`

```markdown
---
name: hello-world
description: Greets the user. Use when the user asks for a greeting or says hello.
license: MIT
---

# Hello World Skill

When the user asks for a greeting, reply "Hello from your custom skill!".
```

frontmatter 遵循规范：

| 字段 | 必需 | 规则 |
|---|---|---|
| `name` | 是 | 1–64 个字符；小写字母、数字和连字符；不能以连字符开头或结尾，不能连续两个连字符；**必须与文件夹名称相同** |
| `description` | 是 | 1–1024 个字符。说明它做什么**以及何时使用**，因为智能体正是用这段文字来匹配任务 |
| `license` | 否 | 许可证名称或附带的许可证文件 |
| `compatibility` | 否 | 最多 500 个字符：所需产品、系统软件包、网络访问 |
| `metadata` | 否 | 字符串键到字符串值的映射（作者、版本等） |
| `allowed-tools` | 否 | 以空格分隔的预先批准工具（规范中为实验性） |

`hello_world` **不是**有效名称（含下划线）；名为 `hello-world` 的文件夹中写 `name: helloworld` 也违反文件夹规则。运行时仍会以声明的名称加载违反命名规则的 Skill，但会记录诊断信息。平台导入和市场会拒绝它，因为其他智能体工具也会拒绝。

### 3. 添加脚本或参考资料（可选）

用相对于 Skill 根目录的路径引用附带文件，例如"运行 `scripts/greet.sh`"或"参见 [参考资料](references/REFERENCE.md)"。让 `SKILL.md` 保持在约 500 行以内，把细节移到 `references/`。

### 4. 刷新

让你的智能体"refresh skills"或重启 Gateway 网关。Skills 监视器也会捕获上述任一文件夹中的变更。

## 把 Skill 带到平台上

同一个文件夹适用于 BuilderForce 的每个界面：

- **导入**：在 **Skills → 工作区技能** 中选择*导入技能文件夹*，然后选择该文件夹、它的 `.zip` 或单个 `SKILL.md`。导入即代表签发：工作区中的每个智能体从下一次运行起都可以加载它，包括云端运行、网页/VS Code/Rovr 中的 Brain、创建画布和 Studio。
- **在浏览器中编写**：选择*+ 新建技能*。你写的内容会保存为标准的 `SKILL.md`。
- **带到别处**：每个 Skill 都有*下载文件夹*，会得到可直接放入 `.claude/skills` 或 `.agents/skills` 的 `<name>.zip`。
- **发布**：已批准的 Skill 可以连同整个文件夹发布到市场；安装者下载的正是你运行的内容。

## 最佳实践

- **为匹配而写描述**：写出适用场景（"当变更需要新增数据库列时使用"），而不是步骤。
- **简洁**：告诉模型*做什么*，而不是如何做一个 AI。
- **安全第一**：如果你的 Skill 运行 `bash`，确保不受信任的输入无法进入命令行。
- **本地测试**：`builderforce agent --message "use my new skill"`。

## 共享 Skills

在[市场](https://builderforce.ai/marketplace)或 [AgentHub](https://agenthub.com) 上浏览和贡献 Skills。
