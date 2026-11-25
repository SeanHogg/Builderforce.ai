# builderforce-control-ui

The control UI for the BuilderForce agent runtime ([`@seanhogg/builderforce-agents`](../README.md)). A Vite app for inspecting and steering a running agent gateway.

## Build and test

Run from this folder with `pnpm`.

| Command | What it does |
|---|---|
| `pnpm dev` | Start the Vite dev server |
| `pnpm build` | Production build |
| `pnpm preview` | Preview the production build |
| `pnpm test` | Run the unit tests |

From the runtime root, `pnpm ui:dev` and `pnpm ui:build` wrap the same steps.

## Where this fits

Part of BuilderForce's **Idea → Make → Run → Measure → Reach** method ([definitions](../../docs/specs/README.md)). This package serves **Make** and **Run**: the control UI for the agent virtualization runtime.
