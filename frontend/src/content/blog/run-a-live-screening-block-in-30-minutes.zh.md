## 为什么连续面试胜过异步

异步视频简历有它的用武之地——让你在一个晚上筛选 100 位候选人。但对于已经进入你候选名单的人，异步筛选会失去同步筛选所保留的三样东西：

1. **实时追问。**你无法让一段录制好的回答来澄清自己。
2. **对精力与文化契合度的判断。**异步会剪掉那些能告诉你是否真的愿意与某人共事的瞬间。
3. **决策速度。**纯异步流程每一轮要多出 3–5 天；连续面试时段则让你当天就能做出决定。

ZipRecruiter 的 ZipIntro 是这方面的经典产品。Builderforce 的 Live Screening Sessions 是同样的工作流，而成本只是其一小部分——并且能与上一篇文章中的 AI Recruiter Agent v2 结果集成。

## 第 1 步：声明你的时间窗口

用该时间窗口调用 `POST /api/recruiter/live-screen/sessions`：

```json
{
  "title": "Staff Backend Engineer first-rounds",
  "jobId": "<uuid>",
  "startTime": "2026-06-03T13:00:00Z",
  "endTime": "2026-06-03T15:00:00Z",
  "slotMinutes": 15,
  "meetingUrl": "https://meet.google.com/abc-defg-hij"
}
```

该会话会以状态 `scheduled` 持久化到 `live_screening_sessions` 中。窗口为 2 小时；按 15 分钟一个时段，容量为 8 位候选人。时段长度可以在 3 到 60 分钟之间任选——大多数猎头在筛选时选 8 分钟，在较深入的首轮面试时选 15 分钟。

## 第 2 步：安排你的候选人

把候选人列表 POST 到 `/sessions/:id/schedule`：

```json
{
  "candidates": [
    { "candidateId": "…", "candidateName": "Alice Chen", "candidateEmail": "alice@example.com" },
    { "candidateId": "…", "candidateName": "Bob Park", "candidateEmail": "bob@example.com" }
  ]
}
```

纯函数 `buildBackToBackSchedule` 会把你的窗口切分成连续的时段，并把前 N 位候选人依次对应上去。响应会告诉你容量、已安排的人数，以及哪些人（如果有）溢出了——当你入围的候选人比窗口能容纳的更多时，这很有用。

每份邀请都会获得一个 32 字节、无法猜测的 `invite_token`。通过电子邮件或短信把链接 `https://Builderforce/live-screen/invite/{token}` 发给候选人——他们无需 Builderforce 账号即可回复。

## 第 3 步：候选人接受（或拒绝）

候选人访问邀请 URL 时，会看到时段时间和会话标题。一键即可接受或拒绝。公开端点——`GET /api/live-screen/invites/:token` 和 `POST /api/live-screen/invites/:token/respond`——无需身份验证，因此该链接在任何收件箱里都能用。

会议 URL **只有在候选人接受之后才会显示**。这能防止 URL 被分享而泄露，也让你得到一个干净的接受率指标：拒绝的候选人从未见过会议链接。

在你的仪表板上，可以看到邀请列表随着候选人回复而从 `pending` → `accepted` / `declined` 变化。大多数邀请会在 24 小时内得到回应；少数没有回应的，可以在窗口开始前再次提醒或替换。

## 当天的工作流程

**T-30 分钟。**打开会话的详情视图。确认已接受的邀请数量符合预期。对未回复者做最后一次提醒。

**T-0。**打开会议 URL。候选人 1 加入，时长 15 分钟。你提出 2–3 个问题，在仪表板里记笔记。到 T+15，候选人 1 离开，候选人 2 加入——同一个房间、同一个 URL，连续进行。

**T+会话结束。**最后一位候选人离开后，把会话状态切换为 `completed`。可选地，对没有出席的邀请标记 `no_show`。通过常规流水线，把最强的 2–3 位推进到下一轮。

一个 2 小时的时间块，可以以每人 15 分钟面试 8 位候选人。过去这要花两周“我们找个都方便的时间吧”。现在只是一个周二的下午。

## 与“电话接力”式排期相比的投资回报

**电话接力式工作流：**8 位候选人 ×（3 封邮件 + 1 次改期 + 30 分钟通话 + 5 分钟收尾）= 约 4.5 小时猎头时间 + 从“有意向”到“决定”共 14 个日历日。

**实时筛选工作流：**8 位候选人 ×（1 份邀请 + 15 分钟时段）= 约 2.5 小时猎头时间 + 3 个日历日。

每 8 位候选人节省的时间：**2 小时猎头工时 + 11 天周期时间**。周期时间比猎头工时更重要——手握三份 offer 的候选人会接受行动最快的公司。实时筛选时段把周期时间变成你的竞争优势。

## 常见问题

### 候选人需要 Builderforce 账号才能接受邀请吗？

不需要。接受 / 拒绝流程完全基于令牌——邀请 URL 包含一个 32 字节、无法猜测的令牌，公开端点不需要身份验证。候选人可以在任何设备、任何收件箱里，一键回复。

### Builderforce 提供视频会议室吗？

本次发布中不提供。你提供会议 URL（Zoom、Meet、Whereby），Builderforce 负责匹配、排期、邀请、接受流程和提醒。原生 WebRTC 会议室已在路线图上（Gap Register #1210），但外部会议室目前效果良好，还能让你复用已有的工具。

### 我能从之前的智能体运行结果自动匹配候选人吗？

从已保存的智能体运行结果自动匹配到会话中，已在路线图上（Gap Register #1208）。目前你需要显式 POST 候选人列表。最常见的做法是：运行 AI Recruiter Agent（按得分取前 8 名），把这些 ID 复制到 `/schedule` 请求体里，发送。端到端两分钟。

---

**立即试用：**Builderforce 上的 [Live Screening Sessions](/hires)。
