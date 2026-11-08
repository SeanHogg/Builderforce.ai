每个团队都有一份简短的清单，列着一项改动缺了就不算完成的事项。README 里要提到新加的参数。DONE.md 要记录已交付的内容。Linter 要通过。没人会带着失败的测试往 main 推送。

你可以每次都告诉智能体，但你会忘记。你的队友则根本不知道该说。而且，在某个聊天里输入的指令会随着该聊天结束而结束，下一次会话又得从头开始。

这份清单属于代码仓库，而不是碰巧在打字的那个人。所以现在，它就住在仓库里。

## 工作区钩子

在你的仓库中添加一个文件 `.builderforce/hooks.json`：

```json
{
  "hooks": [
    { "on": "stop", "prompt": "Update README.md and DONE.md with the work completed in this session." },
    { "on": "stop", "command": "npm run lint" },
    { "on": "preTool", "tool": "git_push", "command": "npm test" },
    { "on": "postTool", "tool": "write_file|edit_file", "command": "npx prettier --check ." }
  ]
}
```

该工作区中的每一次智能体运行现在都会遵循它，无论是从 BuilderForce 面板启动，还是从 VS Code 内置聊天启动。

```bf-figure
{
  "kind": "flow",
  "title": "每个钩子在一次运行中的触发位置",
  "steps": [
    { "label": "preTool", "note": "在匹配的工具调用之前。命令失败会拒绝该调用，智能体会看到原因。", "hue": "make" },
    { "label": "postTool", "note": "在调用成功之后。检查失败的输出会连同结果一起返回给智能体。", "hue": "make" },
    { "label": "stop", "note": "运行即将结束。提示只会交付一次。检查失败会让运行停在原地，直到通过为止。", "hue": "run", "tag": "交付之前" },
    { "label": "runEnd", "note": "在运行结束之后。用于通知、报告和清理的命令。", "hue": "measure" }
  ],
  "caption": "stop 钩子在智能体提交和推送之前运行，因此无论它们要求什么，比如文档、更新日志条目或 lint 修复，都会随同一次提交一起交付。"
}
```

**prompt（提示）**是一条用平实语言写成的指令，由智能体用它自己的工具去执行。**command（命令）**是在工作区根目录运行的检查，其输出决定接下来发生什么。默认情况下，stop 钩子只在修改了代码的运行上触发，因此关于代码库的提问不会让智能体跑去重写你的 README。如果你希望某个钩子在每次运行时都触发，请设置 `"when": "always"`。

与特定时刻无关的常设指引，放在 `.builderforce/rules.md` 中，例如“使用 pnpm”“每个迁移都要有回滚”或“用 Vitest 编写测试”。它会被读入每次运行的指令中，位于你所在组织的治理关卡之下、其他一切之上。

```bf-figure
{
  "kind": "screen",
  "frame": "一个带有团队指令的代码仓库",
  "ratio": 1.62,
  "regions": [
    { "label": ".builderforce/hooks.json", "note": "输入时即按其 schema 检查", "x": 4, "y": 8, "w": 44, "h": 40, "hue": "make" },
    { "label": ".builderforce/rules.md", "note": "适用于每项任务的常设指令", "x": 4, "y": 52, "w": 44, "h": 36, "hue": "idea" },
    { "label": "智能体聊天", "note": "在你完成之前，该工作区要求你：更新 README.md 和 DONE.md……", "x": 52, "y": 8, "w": 44, "h": 80, "hue": "run" }
  ],
  "caption": "两个文件都是你仓库里的纯文本：在拉取请求中评审、随代码一起版本化，并且对每个克隆它的人都完全一致。"
}
```

## 可共享，而且依然安全

这些文件位于 `.builderforce/` 中，因此会被提交。这也意味着，每次克隆都会带来一个钩子文件，而其中的命令会在你的机器上运行。所以命令在你批准之前不会运行，每台机器批准一次。VS Code 会向你展示确切的命令列表。如果有人修改了某条命令或新增了一条，你会被再次询问。编辑提示或规则无需批准，因为它们是智能体读取的文本，和仓库里的其他文件一样。在 VS Code 不信任的工作区中，什么都不会运行。

## 它在方法论中的位置

钩子属于**构建（Build）**，也就是第三幕，也是代价高昂的那一幕。[阅读与验证](/blog/read-prove-build-the-inner-loop)不花成本，因为代码还没有改动。一旦代码发生变化，团队对“完成”的定义，就是防止一次运行给下一个人留下烂摊子的东西。在本地编辑器会话中，智能体是这次改动在交付前唯一的评审者，因此团队的标准必须成为运行本身的一部分，而不是依赖某人记得的一句提醒。

```bf-figure
{
  "kind": "compare",
  "title": "完成一项改动",
  "columns": [
    { "title": "没有钩子", "hue": "muted", "items": ["智能体交付了代码", "有人发现 README 过时了", "又有人发现 lint 是红的", "一次后续提交修复了两者", "下一位队友的运行又重蹈覆辙"] },
    { "title": "有了工作区钩子", "hue": "make", "items": ["智能体修改代码", "它按要求更新文档", "lint 必须通过才允许完成", "一次提交交付全部内容", "团队中的每个人都一样"] }
  ],
  "caption": "团队对“完成”的定义，从一种习惯变成了运行的一部分。"
}
```

## 你今天就能用它做什么

- **无需开口就保持文档最新**：一个 stop 提示让“更新 README 和 DONE”成为每次改动的一部分。
- **把检查变成硬性要求**：一个 stop 命令会让运行停下，直到你的 linter 或类型检查通过，尝试次数有上限。
- **为高风险操作设闸**：preTool 命令可以在 `npm test` 通过之前拒绝 `git_push`。
- **边做边纠正**：失败的 postTool 检查会把格式化工具的抱怨直接送回给智能体。
- **通过 git 共享一切**：提交 `.builderforce/`，每位队友的智能体都会遵循同样的指令。

在 VS Code 中运行 **BuilderForce: Edit Workspace Hooks** 即可创建一个起始文件。

---

**相关阅读：**[审批关卡与人工监督](/blog/approval-gates-and-human-oversight) · [BuilderForce 对比 Claude Code](/blog/builderforce-vs-claude-code) · [多智能体编排](/blog/multi-agent-orchestration)
