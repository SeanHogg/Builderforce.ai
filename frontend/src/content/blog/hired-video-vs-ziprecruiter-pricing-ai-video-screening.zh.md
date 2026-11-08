## 核心数字

**ZipRecruiter（2026）：** Standard 每个职位名额每月约 299–399 美元。Premium 约 419–519 美元。Pro 约 719–899 美元。按行业、地点和名额数量单独报价。

**Builderforce Pro：** 一个固定月费，另有折扣年付选项。当前的数字和各套餐的限额见[价格页面](/pricing)。

入门档*每个名额*的价格差距约为 30 倍。ZipRecruiter 按名额计价是其承重的前提：你招聘的职位越多，费用就越高。

## AI 匹配：ZipRecruiter 与 Builderforce

**ZipRecruiter** 使用一种 AI 匹配算法，把你的职位同步分发到 100 多个合作站点，并邀请顶尖候选人前来申请。“AI 匹配邀请”是它的核心卖点。

**Builderforce** 则使用 AI 匹配界面加上一个主动寻访的智能体。AI Recruiter Agent v2（`/api/recruiter/agent/intake` + `/source`）不只是邀请候选人来申请——它会从简历库中寻访，针对职位给每位候选人打分，并起草个性化的外联信息。

区别在于：ZipRecruiter 的 AI 是*被动的*（等待匹配到的候选人自己选择加入）。Builderforce 的 AI 是*主动的*（它会主动去把人找来）。对于最优秀的候选人并没有在积极求职的职位，主动寻访更胜一筹。

## 视频筛选：ZipIntro 与 Live Screening Sessions

**ZipIntro（ZipRecruiter）：** 招聘人员选定一个时间窗口，ZipRecruiter 匹配候选人，邀请他们在同一个时段内连续参加简短的视频通话。这是 ZipRecruiter 2026 年的主打功能。

**Live Screening Sessions（Builderforce）：** 同样的工作流。招聘人员声明时间窗口和时段长度，通过 `/sessions/:id/schedule` 提交候选人，候选人通过带令牌的公开链接接受或拒绝，连续时段依次交付。

主要区别：
- **成本。** ZipIntro 包含在 ZipRecruiter Pro 中（约 719 美元以上/月）。Live Screening Sessions 包含在 Builderforce Pro 中；当前价格见[价格页面](/pricing)。
- **候选人池。** ZipIntro 会从 ZipRecruiter 的候选人数据库中自动匹配。Builderforce 的流程目前要求你显式 POST 候选人——通常来自此前一次 AI Recruiter Agent 的运行。由智能体自动匹配已列入路线图（Gap Register #1208）。
- **会议基础设施。** ZipIntro 自己托管视频通话。Builderforce 使用你的会议链接（Zoom / Meet / Whereby）。基础设施占用更轻，工具选择更多。原生 WebRTC 是一个路线图事项（Gap Register #1210）。

## 分发：覆盖面重要吗？

ZipRecruiter 的卖点是分发：发布一次，同步到 100 多个合作站点。这对通用类职位确实有价值，但价值集中在前三个站点（Indeed、Google for Jobs、Glassdoor）上——长尾的另外 97 个以上的站点贡献微乎其微。

Builderforce 分发到 Google for Jobs 以及它自己的活跃候选人群体。对于专业化职位（工程、设计、产品、销售、高管），针对性的 Builderforce 受众通常胜过撒向 100 个站点的分散投放。

决策规则：如果你的职位是通用型、大批量的，ZipRecruiter 的分发值得付这份溢价。如果你的职位是专业化、对质量敏感的，Builderforce 针对每个职位更深入的工作流是更好的杠杆。

## 何时选择哪一个

**在以下情况选择 ZipRecruiter：** 你每季度招聘 1–3 个通用职位，分发是你看重的价值；你想要无需手动跨站发布的、跨 100 多个站点的托管式同步分发；预算不是制约因素。

**在以下情况选择 Builderforce：** 你每季度招聘 5 个以上职位（ZipRecruiter 的按名额计价会变得惩罚性）；你希望在一个工作流里完成 AI 驱动的寻访 + 评分 + 外联 + 跟进；你希望用固定月费取代按名额计价；ZipIntro 很有吸引力，但为它专门每月支付 719 美元就不值了。

**两者并用：** 把最难招的职位发布在 ZipRecruiter Pro 上以获得分发，其余所有职位放在 Builderforce 上，所有视频筛选都用 Builderforce 的 Live Screening Sessions。

## 常见问题

### Builderforce 的 Live Screening 能像 ZipIntro 一样开箱即用吗？

招聘人员的工作流形态是一样的：声明时间窗口、安排候选人、接受流程、连续时段。主要的成熟度差距在自动匹配——ZipIntro 会从他们的候选人库自动填满时段；Builderforce 目前要求你从此前一次 AI Recruiter Agent 的运行中 POST 候选人，自动匹配已列入路线图。

### ZipRecruiter 每次视频筛选收费多少？

ZipIntro 包含在 ZipRecruiter Pro 中（每个职位名额每月约 719–899 美元）。Builderforce 的 Live Screening Sessions 包含在固定费率的 Pro 套餐中。

### 我可以把 ZipRecruiter 的候选人导出到 Builderforce 吗？

ZipRecruiter 没有开放完整的候选人列表 API，但 Builderforce 的 Chrome 扩展可以提取你在 ZipRecruiter 仪表盘中有权访问的候选人资料，并推送到你的人才库。

---

**立即试用：** Builderforce 上的 [Builderforce for Recruiters](/hires)。
