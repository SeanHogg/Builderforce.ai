/**
 * The SHARED PreFetch executors' contract (docs/design/deterministic-prefetch.md) — the
 * deterministic actions every surface with a workspace and a shell runs the same way:
 * the editor (VSIX) and on-prem (agent-runtime). A surface-only executor (the editor's
 * LSP diagnostics) stays with its surface.
 *
 * STRUCTURAL ON PURPOSE. These shapes are `@builderforce/prefetch`'s `PrefetchAction`,
 * `PrefetchResult` and `PrefetchExecutor`, restated: agent-tools may not import that
 * package, because every project that resolves agent-tools (the api, the frontend, the
 * Worker packages, …) would then have to resolve it too (the source-package graph's
 * "stated edges are closed" rule). The hosts that do import it hand these rows and
 * executors straight to `defineRegistry` / `PrefetchPort`, so a drift fails their type
 * check, not a run.
 */
/** The pseudo-tool `scaffold.template` requires — present when the host hands templates in. */
export const TEMPLATES_TOOL = 'ide-templates';
//# sourceMappingURL=contract.js.map