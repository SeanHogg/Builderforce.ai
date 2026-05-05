---
summary: "Overview of CoderClaw: self-healing AI engineering agent and orchestration platform with persistent memory, self-repair, human-in-the-loop governance, and multi-channel messaging"
read_when:
  - Learning what CoderClaw is and what it does
  - Deciding if CoderClaw fits your use case
  - Understanding which features are available
title: "CoderClaw Overview"
---

# CoderClaw Overview

CoderClaw is a **self-hosted, open-source AI coding assistant** that connects your favorite messaging apps to powerful AI agents. Run it on your own infrastructure — no cloud lock-in, no data leaving your control.

It is also a **self-healing AI engineering agent and orchestration platform** that manages tasks, workflows, and collaboration across all AI agents. It provides persistent memory, context-aware reasoning, and self-repair — allowing AI systems to detect failures, fix themselves, and adapt over time — while keeping humans in the loop for governance and approval.

## TL;DR

**CoderClaw** connects messaging apps (WhatsApp, Telegram, Discord, Slack, and more) to AI coding agents with a secure, extensible gateway.

- Personal use → spin up with a single command, message your AI from anywhere
- Team use → add RBAC, distributed execution, and audit logs as you grow
- **Self-healing** → agents detect failures, fix themselves, and adapt over time
- **Persistent memory** → context and knowledge survive restarts and session changes
- **Human-in-the-loop** → governance, approval flows, and audit trails built in
- **Any scale** → startups (5–50 devs) through enterprise (100–1,000+ devs)

## What is CoderClaw?

CoderClaw is a **self-hosted multi-channel AI gateway** that lets you interact with AI coding agents through the chat apps you already use. It is also a **self-hosted multi-agent AI orchestration platform** that coordinates specialized agents across the full development lifecycle — planning, coding, reviewing, testing, debugging, and refactoring — while maintaining persistent context and enabling self-repair.

**Core Features:**

- Multi-channel messaging (WhatsApp, Telegram, Discord, Slack, Signal, iMessage)
- WebSocket control plane for clients, nodes, and a web control UI
- Plugin system for extensibility
- Mobile nodes (iOS/Android)
- Canvas and voice features
- Tool system with skills support
- Self-healing agent runtime (failure detection, auto-repair, adaptive execution)
- Persistent memory and context-aware reasoning across sessions
- Multi-agent orchestration with 7 built-in roles and custom agent support
- Human-in-the-loop governance with approval flows and audit trails
- CI/CD integration and private/self-hosted deployment support

**coderClawLLM** — a pay-per-use API layer for AI agent compute — is included for teams who need managed model access without managing their own provider keys.

**Best For:**

- Personal AI assistant accessible from any device
- Small teams in a trusted environment
- Local or distributed execution
- Projects requiring full data sovereignty
- Startups (5–50 developers) using AI as a virtual workforce
- Enterprises (100–1,000+ developers) running complex multi-agent pipelines
- Organizations that need compliance, audit trails, and human approval workflows

## Enterprise Features

CoderClaw includes enterprise-grade capabilities for teams that need more:

**Additional Capabilities:**

- 🔄 **Transport Abstraction Layer** - Execute tasks locally or remotely
- 📊 **Distributed Task Lifecycle** - Formal state machine with persistence
- 🔐 **Enhanced Security** - RBAC, device trust, comprehensive audit logs
- 🎯 **Team Collaboration** - Multi-session isolation, shared registries
- 🏢 **Enterprise Ready** - CI/CD integration, deterministic execution
- 🧠 **Self-Healing Runtime** - Agents detect failures and repair automatically
- 💰 **coderClawLLM** - Pay-per-use API layer for AI agent compute

**Best For:**

- Development teams (5+ people)
- Remote or distributed execution
- Advanced security requirements (RBAC, granular permissions)
- CI/CD automation
- Enterprise compliance and audit trails

## Feature Summary

| Feature                                    | Personal | Enterprise  |
| ------------------------------------------ | -------- | ----------- |
| **Core Gateway**                           |          |             |
| Multi-channel messaging                    | ✅       | ✅          |
| WebSocket control plane                    | ✅       | ✅          |
| Plugin system                              | ✅       | ✅          |
| Mobile nodes                               | ✅       | ✅          |
| Canvas & voice                             | ✅       | ✅          |
| **Self-Healing & Memory**                  |          |             |
| Persistent memory across sessions          | ✅       | ✅          |
| Context-aware reasoning                    | ✅       | ✅          |
| Self-repair on failure                     | ✅       | ✅          |
| Human-in-the-loop approval flows          | ❌       | ✅          |
| **Execution**                              |          |             |
| Local task execution                       | ✅       | ✅          |
| Remote task execution                      | ❌       | ✅          |
| Transport abstraction                      | ❌       | ✅          |
| Distributed runtime                        | ❌       | ✅          |
| **Task Management**                        |          |             |
| Basic task execution                       | ✅       | ✅          |
| Task lifecycle management                  | ❌       | ✅          |
| Task persistence                           | ❌       | ✅          |
| Task resumability                          | ❌       | ✅          |
| Audit trail                                | ❌       | ✅          |
| **Security**                               |          |             |
| Allowlists                                 | ✅       | ✅          |
| Device pairing                             | ✅       | ✅          |
| Token authentication                       | ✅       | ✅          |
| RBAC                                       | ❌       | ✅          |
| Device trust levels                        | ❌       | ✅          |
| Comprehensive audit logs                   | ❌       | ✅          |
| Multi-provider auth (OIDC, GitHub, Google) | ❌       | ✅          |
| Granular permissions                       | ❌       | ✅          |
| **Collaboration**                          |          |             |
| Single-user sessions                       | ✅       | ✅          |
| Multi-session isolation                    | ❌       | ✅          |
| Shared agent registries                    | ❌       | ✅          |
| Team policy enforcement                    | ❌       | ✅          |
| CI/CD integration                          | Basic    | ✅ Advanced |
| **Developer Experience**                   |          |             |
| CLI tools                                  | ✅       | ✅          |
| Web Control UI                             | ✅       | ✅          |
| macOS/iOS/Android apps                     | ✅       | ✅          |
| Project knowledge engine                   | ❌       | ✅          |
| Multi-agent workflows                      | Basic    | ✅ Advanced |
| coderClawLLM compute API                   | ❌       | ✅          |

## Architecture

### CoderClaw Gateway

```
┌─────────────────────────────────────┐
│      Multi-Channel Gateway          │
│  (WhatsApp, Telegram, Discord...)   │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│       WebSocket Control Plane       │
│     (Clients, Nodes, Control UI)    │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│         Pi Agent Runtime            │
│       (Local execution only)        │
└─────────────────────────────────────┘
```

### CoderClaw with Enterprise Runtime

```
┌─────────────────────────────────────┐
│      Multi-Channel Gateway          │
│  (WhatsApp, Telegram, Discord...)   │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│       WebSocket Control Plane       │
│     (Clients, Nodes, Control UI)    │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│     CoderClaw Runtime Layer         │
│  ┌───────────────────────────────┐  │
│  │  Transport Abstraction Layer  │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ Distributed Task Engine       │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  Security Service (RBAC)      │  │
│  └───────────────────────────────┘  │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│   Pi Agent Runtime + Task Executor  │
│   (Local or Remote execution)       │
└─────────────────────────────────────┘
```

## Use Cases

### Personal and Small Team Use

✅ Personal AI assistant for messaging apps
✅ Small trusted team (2-5 people)
✅ Local execution is sufficient
✅ Basic allowlist security is enough
✅ No need for audit trails
✅ Simple deployment model

**Example**: "I want an AI assistant I can message on WhatsApp from my phone that runs on my Mac at home."

### Startup Use (5–50 developers)

✅ Use AI as a virtual workforce to ship faster with a small team
✅ Self-healing agents handle failures automatically, reducing on-call burden
✅ Persistent memory means agents understand your codebase without re-explaining
✅ Builderforce.ai gives a Jira-like view of what every agent is doing (api.builderforce.ai)
✅ coderClawLLM provides pay-per-use compute without managing provider keys

**Example**: "We're a 10-person startup. Our AI agents write code, review PRs, and fix failing tests automatically — all visible in Builderforce.ai. We don't need a dedicated DevOps engineer to babysit CI."

### Team and Enterprise Use

✅ Development team (5+ people)
✅ Need remote or distributed execution
✅ Require RBAC and granular permissions
✅ Need comprehensive audit logs
✅ CI/CD automation requirements
✅ Enterprise compliance needs
✅ Multi-tenant deployments
✅ Complex multi-agent pipelines with deterministic execution and full audit trails
✅ Human-in-the-loop approval gates for sensitive changes
✅ Private/self-hosted deployments for air-gapped or regulated environments

**Example**: "Our team needs an AI assistant that runs on a shared server, with different permission levels for developers, reviewers, and CI pipelines, plus full audit logs for compliance."

**Extended example**: "Our team needs AI agents that orchestrate across 50 microservice repos, with different permission levels for developers, reviewers, and CI pipelines, plus full audit logs for compliance — all governed by Builderforce.ai."

## Pricing and Licensing

CoderClaw is **MIT licensed** and **free to use**.

- Source: [github.com/SeanHogg/coderClaw](https://github.com/SeanHogg/coderClaw)

## Getting Started

```bash
npm install -g coderclaw@latest
coderclaw onboard --install-daemon
coderclaw gateway --port 18789
```

Documentation: [docs.coderclaw.ai](https://docs.coderclaw.ai)

### Enabling Enterprise Features

Enterprise features are **backward compatible** — your existing setup continues to work. Enable them as needed:

```bash
# Your existing setup works unchanged
coderclaw gateway --port 18789

# Opt-in to extended features
mkdir -p ~/.coderclaw/.coderClaw
# Add runtime.yaml and security.yaml as needed
```

## Contributing

CoderClaw welcomes contributions:

- Core gateway features, channels, tools
- Enterprise runtime, security, and distributed features

## Community

[Join Discord](https://discord.gg/9gUsc2sNG6)

## FAQ

**Q: Can I run CoderClaw on the same machine as other services?**

A: Yes, just ensure the gateway port (18789) is not in use by another process.

**Q: Is CoderClaw expensive to run?**

A: No. Enterprise features add minimal overhead. API costs depend on which AI models you configure.

**Q: Can I switch configurations easily?**

A: Yes. Backup your `~/.coderclaw` directory to preserve your configuration.

**Q: Which setup should I start with?**

A: If you're just exploring — start simple. If you know you need team features — enable enterprise capabilities from the start.

## Summary

**CoderClaw** = Self-hosted, open-source AI coding assistant + multi-channel messaging gateway + self-healing multi-agent orchestration platform.

- Connects messaging apps (WhatsApp, Telegram, Discord, Slack, and more) to powerful AI coding agents
- Manages tasks, workflows, and collaboration across all AI agents
- Persistent memory and context-aware reasoning across sessions
- Self-repair: agents detect failures, fix themselves, and adapt over time
- Human-in-the-loop governance with approval flows and audit trails
- **[Builderforce.ai](https://builderforce.ai)** (API: api.builderforce.ai) replaces Jira with a centralized orchestration portal (replaces builderforce.ai)
- **coderClawLLM** — pay-per-use API layer for AI agent compute

Choose your setup based on requirements:

- **Solo or small team + local only** — start with the default configuration
- **Startup (5–50 devs)** — use AI as a virtual workforce with full visibility in Builderforce.ai
- **Team or enterprise + distributed + security** — enable enterprise runtime features
- **Enterprise (100–1,000+ devs)** — multi-agent pipelines with RBAC, audit trails, and human approval gates

---

_This guide is maintained by the CoderClaw project. For questions, see [docs.coderclaw.ai](https://docs.coderclaw.ai)._
