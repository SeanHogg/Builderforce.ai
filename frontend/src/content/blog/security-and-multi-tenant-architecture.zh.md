Builderforce 上的每个团队都共用同一套 API 基础设施，但没有任何团队能看到其他团队的项目、智能体、任务或对话。这种隔离不是事后外挂的功能——它是一条根本性的架构前提，每一条数据库查询、每一个 API 路由、每一次智能体派发，都是围绕它构建的。

本文将介绍信任模型、访问控制体系、智能体认证的工作方式，以及审计轨迹覆盖的范围。

![Builderforce 多租户安全示意图：三条被上锁隔墙分开的独立租户通道，三种认证机制（Web JWT、哈希存储的 AgentHost API 密钥、HMAC-SHA256 派发签名），以及查询级隔离——每条租户范围的查询都带有 eq(tenantId) 过滤条件](/blog/security-multitenant.svg)

---

## 租户模型

**租户**是你的组织在 Builderforce 上的独立工作区。所有资源——项目、任务、AgentHost、智能体、技能、审批、对话——都限定在某个租户范围内。不存在跨租户的可见性或共享。

用户可以属于一个或多个租户，并在每个租户中拥有特定的**角色**：

| 角色 | 可以做什么 |
|---|---|
| `viewer` | 对项目、任务、聊天记录和可观测性数据的只读访问 |
| `developer` | 对项目和任务的读写访问；可以使用 IDE 和聊天 |
| `manager` | 拥有 developer 的全部权限，另外还可以：批准/驳回审批关卡、管理 AgentHost 实例、分配技能、管理成员 |
| `owner` | 拥有 manager 的全部权限，另外还可以：管理账单、删除租户、配置源代码管理集成 |

角色在 API 层强制执行——每个受保护的端点在处理请求之前，都会先检查调用者的角色是否达到最低要求。一个 developer 如果试图批准审批关卡，会收到 `403`。

---

## 认证

Builderforce 采用**双令牌认证模型**，把浏览器会话与智能体 API 访问干净地分离开来。

### Web JWT（用户会话）

基于浏览器的用户通过邮箱和密码登录，获得一个短期有效的 JWT。令牌中编码了：

- `userId`——已认证的用户
- `tenantId`——本次会话的租户上下文
- `role`——用户在该租户中的角色
- `exp`——过期时间（短期有效；可刷新）

所有 JWT 操作都经由 `/api/auth` 路由完成。令牌可以在安全设置页面中逐个吊销。

### 多因素认证

用户可以在 [设置 → 安全](/security) 中启用基于 TOTP 的 MFA。启用后，每次登录除了密码之外，还需要输入 TOTP 验证码。

恢复码会在启用 MFA 时生成——请妥善保存。它们会立即被哈希处理，之后无法再次获取。

### AgentHost API 密钥

BuilderForce Agents 实例不使用 JWT。每个注册的 AgentHost 在注册时都会收到一个**一次性明文 API 密钥**。密钥会立即被哈希处理，明文从不存储——如果丢失了，就重新生成一个。

AgentHost 在每个请求中都通过 `Authorization: Bearer <key>` 发送这个密钥。API 会将其与存储的哈希值比对验证，并根据 AgentHost 的注册记录解析出租户上下文。

**密钥绝不出现在 URL 中。**这曾是 Builderforce 部分端点的历史做法，现已全部迁移——所有使用 AgentHost 认证的端点现在都只使用 `Authorization` 请求头，确保密钥不会出现在服务器访问日志和 CDN 缓存中。

---

## 会话管理

每个活跃的浏览器会话都记录在 `auth_user_sessions` 表中。管理者可以在安全面板中查看并吊销其租户内任意用户的会话。

会话视图显示：

| 字段 | 值 |
|---|---|
| 会话 ID | 唯一标识符 |
| User agent | 浏览器和操作系统 |
| IP 地址 | 最近一次访问的 IP |
| 创建时间 | 会话开始时间 |
| 最近活跃 | 最近一次经过认证的请求 |
| 状态 | 活跃或已吊销 |

吊销一个会话，会使该会话内签发的所有令牌失效。用户会在下一次请求时被登出。

---

## BuilderForce Agents 的信任与派发安全

AgentHost 网格引入了额外的信任面：AgentHost 之间的派发。当 AgentHost A 向 AgentHost B 发送任务时，AgentHost B 需要确认请求确实来自 AgentHost A——而不是来自某个发现了 AgentHost B 端点的攻击者。

Builderforce 对所有 AgentHost 之间的派发都使用 **HMAC-SHA256 载荷签名**：

```
AgentHost A sends:
  POST /api/agent-hosts/:id/forward
  Authorization: Bearer <agentHostApiKey>
  X-AgentHost-Signature: sha256=<hmac>
  X-AgentHost-From: <sourceAgentHostId>
  Body: { task: "..." }
```

HMAC 基于原始请求体计算，以发送方 AgentHost 的 API 密钥作为密钥。接收方 AgentHost（通过 Builderforce 的 `verifyAgentHostSignature`）会重新计算 HMAC 并进行比对。如果不匹配，会在处理载荷之前直接返回 `403`。

如果请求中没有签名，出于向后兼容的考虑，Builderforce 仍会接受该请求——但会记录签名缺失。在未来的一次安全加固版本中，转发任务缺少签名将变为直接拒绝。

---

## 审计日志

Builderforce 中的每一项重要操作都会记录在**审计日志**中——所有者和管理者可以在 [/admin](/admin) 访问。

审计日志记录以下内容：

| 事件类型 | 触发原因 |
|---|---|
| `tenant.member_added` | 用户被添加到租户 |
| `tenant.member_removed` | 用户被移出租户 |
| `agentHost.registered` | 新建了 BuilderForce Agents 实例 |
| `agentHost.status_changed` | AgentHost 被激活、停用或暂停 |
| `approval.created` | 智能体请求了一个审批关卡 |
| `approval.decided` | 管理者批准或驳回 |
| `task.created` | 在看板上创建了任务 |
| `execution.submitted` | 任务被提交执行 |
| `execution.state_changed` | 执行状态变为运行中/已完成/失败 |
| `project.created` | 创建了新项目 |
| `skill.assigned` | 技能被分配给租户或 AgentHost |

每个事件都会记录：谁、做了什么、何时、涉及哪个资源（类型和 ID），以及结构化元数据。

### 工具审计事件

独立于租户审计日志之外，**工具审计日志**记录了 BuilderForce Agents 智能体的每一次工具调用：工具名称、输入参数、结果、耗时，以及成功还是出错。这份日志是回答“智能体到底做了什么”的事实依据——无论是排查问题还是合规审查都很有用。

---

## 数据隔离架构

多租户隔离是在数据库查询层面强制执行的——而不是在应用逻辑层面。

每一条针对租户范围表的查询，都包含一个显式的 `tenantId` 条件：

```typescript
const rows = await db
  .select()
  .from(projects)
  .where(
    and(
      eq(projects.tenantId, tenantId),  // always present
      eq(projects.status, 'active'),
    )
  );
```

不存在任何省略租户过滤条件的“全量查询”路径。即使应用逻辑出现 bug，查询也不会返回其他租户的数据。

BuilderForce Agents 实例同样限定在租户范围内——注册到租户 A 的 AgentHost 无法接收来自租户 B 的派发，不会出现在租户 B 的机群视图中，也无法读取租户 B 的项目上下文。

---

## 隐私控制

Builderforce 支持 GDPR 和 CCPA 合规请求。用户可以在账户设置中提交数据删除或数据访问请求，管理者也可以代为提交。

隐私请求通过一个正式的工作流进行跟踪：

```
submitted → in_review → completed / closed
```

与该请求相关的所有个人数据（聊天记录、审计事件、用量快照）都可以根据适用法规应要求删除。

---

## 源代码管理安全

当你通过源代码管理集成连接 GitHub 或 Bitbucket 账户时，Builderforce 只存储：

- 账户标识（组织/用户名）
- 主机 URL（用于自托管的 GitHub Enterprise）
- 集成类型

Builderforce 的数据库中不存储任何 OAuth 令牌或 PAT。令牌管理由执行 git 操作的 BuilderForce Agents 实例负责。

---

## 安全路线图

第二阶段及之后规划了多项安全增强：

- **强制 HMAC 签名**——拒绝未签名的 AgentHost 间派发，不再保留向后兼容窗口
- **设备信任**——注册受信任设备；从新设备登录时要求重新认证
- **IP 允许列表**——将租户访问限制在特定的 CIDR 范围内
- **SSO**——面向企业身份提供商的 SAML 和 OIDC
- **SIEM 导出**——通过 OTel 将审计事件流式传输到外部日志系统

---

## 最佳实践

**每季度轮换 AgentHost API 密钥。**一个从未轮换过的密钥，很可能已经在某个 shell 历史文件里躺了好几个月。注册一个新密钥，更新 AgentHost 的环境变量，重启 AgentHost，然后吊销旧密钥。

**只授予必要的最低角色。**开发者不需要 `MANAGER` 权限，评审者不需要 `DEVELOPER` 权限。角色分配应当与实际职责相匹配。

**为所有管理者和所有者启用 MFA。**拥有读写权限的开发者账户是有价值的攻击目标；而能够批准破坏性操作的管理者账户，价值更高。

**智能体出现任何意外行为后，都要查看工具审计日志。**在重新运行一个产生了意外输出的工作流之前，先看看智能体实际做了什么——工具审计日志才是权威记录。

---

## 后续步骤

- 在 [设置 → 成员](/settings) 中检查团队的角色分配
- 在 [设置 → 安全](/security) 中启用 MFA
- 查看 [审计日志](/admin)，了解你租户近期的重要事件
- 阅读 [审批关卡与人工监督](/blog/approval-gates-and-human-oversight)，了解与平台安全相辅相成的人工参与控制
