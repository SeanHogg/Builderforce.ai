# @seanhogg/builderforce-agents

The BuilderForce agent virtualization runtime: a distributed AI coding agent runtime with secure orchestration. It runs agents next to the work they do, behind the channels and tools they are allowed to use.

## Workspace layout

| Path | What lives there |
|---|---|
| `src/` | Runtime, CLI and gateway source |
| `ui/` | `builderforce-control-ui`, the control UI (see [`ui/README.md`](ui/README.md)) |
| `extensions/*` | Channel and tool adapters (messaging channels, voice, and so on), one workspace package each |
| `skills/` | Bundled agent skills |
| `docs/` | Runtime-specific documentation |

## Build and test

Run from this folder with `pnpm`.

| Command | What it does |
|---|---|
| `pnpm build` | Bundle the runtime, plugin SDK typings and build metadata |
| `pnpm dev` | Run the CLI from source |
| `pnpm ui:build` / `pnpm ui:dev` | Build or serve the control UI |
| `pnpm test` | Parallel unit test run |
| `pnpm check` | Format check, typecheck and lint |

## Where this fits

Part of BuilderForce's **Idea → Make → Run → Measure → Reach** method ([definitions](../docs/specs/README.md)). This package serves **Make** and **Run**: the agent virtualization runtime that hosts agents next to the work they do.

See the [Agent Environment](https://builderforce.ai/features/agent-environment) and [Autonomous Execution](https://builderforce.ai/features/autonomous-execution) pages for how agents are declared and how their work finishes.
