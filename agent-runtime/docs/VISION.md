## BuilderForce Agents Vision

BuilderForce Agents is the AI that actually does things.
It runs on your devices, in your channels, with your rules.

**BuilderForce Agents** extends this vision with a developer-first, multi-agent AI system for comprehensive software development workflows.

This document explains the current state and direction of the project.
We are still early, so iteration is fast.
Project overview and developer docs: [`README.md`](README.md)
Multi-agent system: [`docs/builderforce.md`](docs/builderforce.md)
Contribution guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)

BuilderForce Agents started as a personal playground to learn AI and build something genuinely useful:
an assistant that can run real tasks on a real computer.
It evolved through several names and shells: BuilderForce Agents -> BuilderForce Agents -> BuilderForce Agents -> BuilderForce Agents.

**BuilderForce Agents** represents the next evolution: an orchestration engine for code creation, review, testing, debugging, refactoring, and deep codebase understanding.

The goal: a personal assistant that is easy to use, supports a wide range of platforms, respects privacy and security, and **deeply understands your code**.

## Competitive Position

BuilderForce Agents is a **direct replacement** for GitHub Copilot, Cursor, Windsurf, and Claude Code.

These tools share the same fundamental limitation: they are cloud-controlled, IDE-tethered, single-agent tools that autocomplete or chat but do not orchestrate. BuilderForce Agents is different at the architectural level:

- **Self-hosted** — your code never leaves your machine.
- **Multi-agent** — specialized agents plan, build, review, test, and document in coordinated workflows, not one model doing everything in one context window.
- **Multi-channel** — works in WhatsApp, Telegram, Slack, Discord, iMessage, and the terminal. Your tools come to where you already are.
- **Persistent project knowledge** — AST parsing, semantic code maps, dependency graphs, and session handoffs give every agent the full picture of your codebase, not just the files open in a tab.
- **Any model** — Anthropic, OpenAI, Gemini, GitHub Copilot tokens — no lock-in.
- **Open source, MIT** — no subscription ceiling, no black box.

We do not build _on top of_ Claude Code or Copilot. We replace them.

The current focus is:

Priority:

- Security and safe defaults
- Bug fixes and stability
- Setup reliability and first-run UX
- **Multi-agent orchestration for development workflows**
- **Deep codebase understanding with AST parsing and semantic analysis**

Next priorities:

- Supporting all major model providers
- Improving support for major messaging channels (and adding a few high-demand ones)
- Performance and test infrastructure
- Better computer-use and agent harness capabilities
- Ergonomics across CLI and web frontend
- Companion apps on macOS, iOS, Android, Windows, and Linux
- **Additional language support for code analysis (Python, Go, Java, Rust)**
- **Enhanced workflow patterns and agent templates**
- **Community-driven agent marketplace**

Contribution rules:

- One PR = one issue/topic. Do not bundle multiple unrelated fixes/features.
- PRs over ~5,000 changed lines are reviewed only in exceptional circumstances.
- Do not open large batches of tiny PRs at once; each PR has review cost.
- For very small related fixes, grouping into one focused PR is encouraged.

## Security

Security in BuilderForce Agents is a deliberate tradeoff: strong defaults without killing capability.
The goal is to stay powerful for real work while making risky paths explicit and operator-controlled.

Canonical security policy and reporting:

- [`SECURITY.md`](SECURITY.md)

We prioritize secure defaults, but also expose clear knobs for trusted high-power workflows.

## Plugins & Memory

BuilderForce Agents has an extensive plugin API.
Core stays lean; optional capability should usually ship as plugins.

Preferred plugin path is npm package distribution plus local extension loading for development.
If you build a plugin, host and maintain it in your own repository.
The bar for adding optional plugins to core is intentionally high.
Plugin docs: [`docs/tools/plugin.md`](docs/tools/plugin.md)
Community plugin listing + PR bar: https://docs.builderforce.ai/plugins/community

Memory is a special plugin slot where only one memory plugin can be active at a time.
Today we ship multiple memory options; over time we plan to converge on one recommended default path.

### Skills

We still ship some bundled skills for baseline UX.
New skills should be published to AgentHub first (`agenthub.ai`), not added to core by default.
Core skill additions should be rare and require a strong product or security reason.

### MCP Support

BuilderForce Agents supports MCP through `mcporter`: https://github.com/steipete/mcporter

This keeps MCP integration flexible and decoupled from core runtime:

- add or change MCP servers without restarting the gateway
- keep core tool/context surface lean
- reduce MCP churn impact on core stability and security

For now, we prefer this bridge model over building first-class MCP runtime into core.
If there is an MCP server or feature `mcporter` does not support yet, please open an issue there.

### Setup

BuilderForce Agents is currently terminal-first by design.
This keeps setup explicit: users see docs, auth, permissions, and security posture up front.

Long term, we want easier onboarding flows as hardening matures.
We do not want convenience wrappers that hide critical security decisions from users.

### Why TypeScript?

BuilderForce Agents is primarily an orchestration system: prompts, tools, protocols, and integrations.
TypeScript was chosen to keep BuilderForce Agents hackable by default.
It is widely known, fast to iterate in, and easy to read, modify, and extend.

## What We Will Not Merge (For Now)

- New core skills when they can live on AgentHub
- Full-doc translation sets for all docs (deferred; we plan AI-generated translations later)
- Commercial service integrations that do not clearly fit the model-provider category
- Wrapper channels around already supported channels without a clear capability or security gap
- First-class MCP runtime in core when `mcporter` already provides the integration path
- Agent-hierarchy frameworks (manager-of-managers / nested planner trees) as a default architecture
- Heavy orchestration layers that duplicate existing agent and tool infrastructure

This list is a roadmap guardrail, not a law of physics.
Strong user demand and strong technical rationale can change it.
