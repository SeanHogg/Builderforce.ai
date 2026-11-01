# PRD 35 — One agent, one kernel

| | |
|---|---|
| Status | **Complete, 2026-11-01.** Nothing is left to do. Everything finished is in DONE.md (2026-11-01 and 2026-10-31), under its original section numbers. Board: epic 5979. |
| Owner | Agents program. Model roles are in CLAUDE.md. |
| Design reference | [`docs/design/one-agent-one-kernel.html`](../design/one-agent-one-kernel.html), the picture: end state, both matrices, retention ledger, telemetry. Live copy: https://claude.ai/artifact/Ggc3G5y2ZLkJsVe1jDHag8 |

**The goal.** Many entry points → ONE agent (`packages/agent-run`) → ONE kernel (`packages/agent-loop`). An entry point decides *where* a run gets its model, files, shell, storage and people, never *how* the run behaves. Cloud runs, @-replies, canvas and on-prem tickets already run on `runAgent`. So do VS Code, web and Rovr chat, and on-prem channels: every entry point is on `runAgent`, and `check:one-execution` enforces it.
