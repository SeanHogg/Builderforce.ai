---
read_when:
  - 将 Builderforce 添加到 Claude、Cursor、Cline、Goose 或其他 MCP 客户端
  - 将 Builderforce 作为远程 MCP 服务器列出或使用
summary: 通过托管的远程 MCP 服务器，把任意 MCP 客户端连接到你的 Builderforce 工作区
title: 远程 MCP 服务器
---

# 远程 MCP 服务器

Builderforce 本身就是一个远程 **MCP** 服务器。把任意 MCP 客户端指向它，该客户端
即可运行你的工作区：创建与移动工单、操作看板与泳道、读取并更新投资组合、举措与
OKR、派发云端编码代理，以及查询执行记录。

- **端点**：`https://api.builderforce.ai/mcp`
- **传输**：Streamable HTTP（JSON-RPC 2.0），**无状态** —— 没有会话 ID，也没有
  服务端到客户端的流
- **认证**：`Authorization: Bearer bfk_…`（租户 API 密钥）

## 获取 API 密钥

设置 → **API 密钥** → 创建密钥。密钥形如 `bfk_…`。

密钥所属的租户就是每次工具调用的作用域：使用该密钥认证的客户端，只能看到该租户
可见的项目、看板与代理，除此之外一无所见。请像对待密码一样对待它——任何持有它的
人都能在你的工作区中执行操作。

## 连接客户端

大多数客户端只需要 URL 和一个请求头。以 Claude Code 为例：

```bash
claude mcp add --transport http builderforce https://api.builderforce.ai/mcp \
  --header "Authorization: Bearer bfk_your_key"
```

通过配置文件配置的客户端（Cursor、Windsurf、Cline 等）使用等价的 JSON：

```json
{
  "mcpServers": {
    "builderforce": {
      "type": "http",
      "url": "https://api.builderforce.ai/mcp",
      "headers": { "Authorization": "Bearer bfk_your_key" }
    }
  }
}
```

## 你能获得哪些工具

工具目录是**按租户**决定的，因此请调用 `tools/list` 获取实时列表。它是三个来源的
并集：

| 来源 | 说明 |
| --- | --- |
| 平台工具 | Builderforce 第一方操作——项目、工单、看板、泳道、规格、审批、投资组合、举措、OKR、执行记录、定时任务等。 |
| 连接器 | 你的租户已**连接**的每个连接器，通过连接器运行时执行（具备 SSRF 防护并记录审计）。 |
| 外部 MCP 服务器 | 你的租户注册的每个 MCP 服务器，使用其存储的密钥在服务端之间中继。该密钥仅在服务端解密，永不下发到客户端。 |

只读工具会声明 `annotations.readOnlyHint: true`。其余一律按会写入处理——外部服务器
无法声明该标志，因此缺少提示即意味着“假定它会写入”。

## 方法

`initialize`、`notifications/initialized`、`ping`、`tools/list`、`tools/call`。

由于服务器是无状态的，`GET /mcp` 与 `DELETE /mcp` 返回 `405`：没有可打开的流，也
没有可结束的会话。请一律使用 `POST`。

## 手动验证

```bash
curl -s https://api.builderforce.ai/mcp \
  -H "content-type: application/json" \
  -H "Authorization: Bearer bfk_your_key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 400
```

不带密钥时，同样的调用会返回 `401` 以及 `WWW-Authenticate: Bearer` 质询——这也是
确认端点可达的最快方式。

## 速率限制

该端点运行与网关其余部分相同的计费工具，并采用同样的按租户滑动窗口限制。被限流的
调用会返回 `429`。

## 相关文档

- [网关认证](/docs/zh-cn/gateway/authentication)
- [OpenAI Chat Completions](/docs/zh-cn/gateway/openai-http-api)
