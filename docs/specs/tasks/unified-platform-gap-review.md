# Unified platform: gap and consistency review

Reviewed 2026-11-26 against the product vision "one AI-native development and execution environment". Gap entries: `UP-G001`–`UP-G014` in [GAP-REGISTER.md](../../roadmap/GAP-REGISTER.md). The 3D stage and code editor work is already designed in [one-stage-one-editor.md](one-stage-one-editor.md) (`AE-G059`/`AE-G060`).

## Verdict

Most of the vision exists already, in pieces. Two things are missing:

1. **No layer is shared across hosts except the run kernel.** UI reuse in VS Code works by compiling the frontend's source through Next shims, not through a host-adapter seam. Chrome reuses almost nothing.
2. **Four repos solve the same problems separately.** There are three or four inference stacks, two memory meanings, four MCP code paths, and two desktop shells.

So the work is mostly *unify and extract*, not *build*. The pasted roadmap's phase 2, a new "Secure Rust/WASM execution kernel", is the one item that does not fit as written; see §4.

## 1. Vision vs today

| Vision item | Exists today | Where | Hosts | Gap |
|---|---|---|---|---|
| Starter kits as composable environment manifests | Yes, partly. Kits are composed from parts (frontend × backend × extras). Each part contributes a `builderforce.json` v1 fragment: services, resources, capabilities, agents. | `packages/ide-templates/src/kits/*`, `packages/app-detect/src/manifest/*` | Web; VS Code (editor starters) | No model, knowledge or IDE-component sections. Kit and `AppBlueprint` are two shapes bridged by `manifestToBlueprintOverrides` (`UP-G001`). The categories AI-from-scratch, Existing model, Knowledge pack, Autonomous agent and Agent factory are not kits yet (`UP-G002`). |
| Starter picker ("What do you want to build?") | Yes | `components/creation-sessions/CreationStarterPanel.tsx`, `create/*`, `CanvasAppStart.tsx`, `StudioHome.tsx` | Web only | Three entry points. Make them one picker fed by the kit registry, mountable in every host (`UP-G002`). |
| Code editor | Monaco (web); the KG reader | `CodeEditor.tsx`, `FileChangeViewer.tsx`, `knowledge-graph-view/stage/drill` | Web; VS Code uses its native editor | `AE-G060` |
| File explorer, terminal | Yes | `FileExplorer.tsx`, `Terminal.tsx` + `browserRuntime/workspaceShell.ts`; VS Code `src/tools/localShell*.ts` | Web; VS Code native | Shell logic exists twice with different engines. Unify them behind one `ShellPort` with WebContainer and local adapters (`UP-G003`). |
| AI chat | `brain-ui` package | `packages/brain-ui`; plus `ChatInput.tsx`/`CanvasChatSurface.tsx`, `webview/chat/VsCodeChat*`, `chrome/sidepanel/ChatView.tsx` | All three | Composer and chat view implemented three times (`UP-G004`). |
| Canvas, Room, 3D | Yes | `creation-canvas/**` (about 118 modules), `world3d/*` | Web; VS Code (compiled closure) | `AE-G059`. Room is not on the shared stage, and agents are not first-class. |
| App preview | Yes | `components/preview/*` | Web; VS Code via the closure | Not a package. |
| Debugger | Agent and permission debug only | `PermissionDebuggerPanel.tsx`, `AgentHostDebugContent.tsx` | Web | No code or runtime debugger (`UP-G005`). |
| AI / Training / Eval / Knowledge / Agent / Deployment studios | Yes, as frontend components | `AITrainingPanel`, `FinetuneStudioPanel`, `EvermindStudioPanel`, `BenchmarkPanel`, `knowledge-browser`, `AgentDeclarationPanel`, `DeploymentList` | Web; VS Code has Evermind only | None is a package (`UP-G006`). |
| Security dashboard | Engine yes | `packages/code-shield` + `WebSecurityScanPanel.tsx`; webcontainers `src/security` | Web; VS Code analyzers | Two security engines with no shared policy model (`UP-G007`). |
| Resource monitor, database explorer | No | Closest: `ObservabilityContent`, `dataTable/` | — | `UP-G005` |
| Marketplace | Yes (publish/sell) | `components/marketplace/*` | Web; VS Code voice marketplace only | Kits and components are not marketplace items yet (`UP-G002`). |
| Five layers (host adapter → components → headless → SDK → kernel) | Headless packages: about 46 (agent-run, agent-tools, run-*, model-router, knowledge-client, code-shield…). Port seam: `agent-run/src/surface.ts` `RunPorts`. | `packages/*` | All hosts consume the run kernel | There is no port seam for UI or workspace services. Packages are source-only, so there is no runtime SDK (`UP-G008`). |
| Humans and agents use one SDK | Canvas and build actions are model tools (`canvasTools.ts`, `canvasAi*`). There is an MCP gateway (`api/.../mcpGateway`) and a REST API (Hono). | — | Web | The tools execute in the frontend (`canvasAiToolExecution.ts`), so MCP, REST and CLI cannot reach them. The published `/sdk` is an LLM gateway client only. There is no event bus (`UP-G009`). |
| Lifecycle Idea → Make → Run → Measure → Reach | Yes | `docs/specs/*.md`, `lib/methodology.ts`, `api/application/realization` | Web only | VS Code and Synapse have no stage model (`UP-G010`). |
| Deploy targets | `RunTargetId = 'browser' \| 'container'` | `frontend/src/lib/runTarget/*` | Web | No cloudflare or native target. The registry lives in the frontend `lib/`, not in a package (`UP-G011`). |
| Runtime: multi-language WebContainer | Yes, strong. A Node-compatible worker per process, esbuild-wasm, Pyodide, php-wasm, .NET wasm + Roslyn, Rust/WASI, PGlite. React, Vue, Svelte, Angular 17–20, Next and SvelteKit run. | `builderforce-webcontainers/packages/{core,browser}` | Web (VS Code via preview) | Nuxt and SQLite missing. No capability matrix published to kits (`UP-G012`). |
| Kernel services: memory manager, scheduler, capability manager, Shield, hibernation, checkpoints | Present in parts: `src/memory/{manager,pressure,eviction,spillTier}`, `jobScheduler`, manifest `capabilities.ts`, Shield + egress CSP, `snapshotStore` + `recovery` | webcontainers | Web | No unified capability manager, no hard per-process limits, and hibernation is not a lifecycle state. This is a *kernel interface* over what exists, not a new kernel (§4, `UP-G013`). |
| Local inference / model virtualization | Four stacks: Rust `bfi-*` (Synapse), `bfi-web`/`bfi-node` (copied into Builderforce.ai/packages), webcontainers `src/inference` + `kvcache`, `packages/local-inference` + `model-catalog` | Four repos | — | Adopt one engine, used everywhere, with one model catalog. KV/prefix-cache logic exists in both TS and Rust (`UP-G014`). |

## 2. Consistency findings

1. **Naming.**
   - Packages use `@builderforce/*`, while `brain-ui`, `brain-embedded`, `sdk`, the webcontainers packages and memory are still `@seanhogg/*`.
   - `builderforce-inference` contains the `bfi` engine, `bf-context`, the Teach-once helper, and the Synapse Code-OSS build recipe. The old Tauri app was retired.
   - "Evermind", "brain" and "Agent Memory" name one thing.
   - "Memory" in webcontainers means RAM and KV cache, not agent memory.
   - Pick one product noun per capability (see the table in §5) and rename at the next major version.
2. **Versions.** Four CalVer streams: inference 2026.10.12, webcontainers 2026.11.29, VSIX 2026.11.224, spawn 2026.10.4. Fine as long as each is independent, but there is no compatibility matrix between them.
3. **Build coupling.**
   - The legacy Spawn app uses the local `bf-cloud` and `bf-vault` crates. The Spawn extension uses the Builderforce extension API for its session.
   - The relative-path console link went with the Synapse app (retired 2026-11-27).
4. **Duplicated shells.** The Tauri Synapse app was removed on 2026-11-27. Spawn's Tauri shell goes when its extension ships in the Synapse fork (`UP-G017`).
5. **The UI reuse seam is aliasing, not adapters.**
   - VS Code compiles `frontend/src/components/creation-canvas/**` with Next shims.
   - Any new Next or `window` import in that closure breaks the extension build, which is also why the VSIX package takes 9.5 minutes (`AE-G061`).
6. **Repo hygiene.** The Builderforce.ai root holds `_tsc_*.log`, `tsgo-*.log`, `_probe_sqlite.cjs` and a stray file named `-p`.

## 3. Synapse becomes a VS Code fork (decision, 2026-11-27)

> **User, 2026-11-27:** The Builderforce VSIX stays the same: an agent runtime plus the code visualizer. The Synapse desktop app is replaced by a fork of Visual Studio Code. The fork runs the VSIX and has project types for three AI-model scenarios: Scratch, Existing and Knowledge pack. The Spawn repo stays; Spawn becomes an extension packaged with the fork.

- **Superseded:** the earlier recommendation to embed an OpenVSCode Server sidecar in the Synapse Tauri shell. It is not being built. A Code-OSS fork replaces it (`UP-G015`), and the earlier "why not a fork" concern (a second Electron shell) no longer applies, because the Tauri shell is gone.
- **Retired:** the vanilla-JS UI, Tauri shell, console, `bf-local`, and the private `bf-memory` client. The Code-OSS recipe now lives in `builderforce-inference/app`. The `bf-teach` crate provides the native Teach-once helper, and `bf-cloud` and `bf-vault` moved to `builderforce-spawn`.
- **Kept** (each serves the extension):
  - the native engine `bfi` (`bfi serve`, plus `@seanhogg/bfi-node` in-process);
  - the `bf-context` loopback service and the `bf-index`/`bf-compress` crates behind the benchmark gate.
- **Spawn** keeps its repo and `bf-roblox` bridge. The VS Code extension is implemented for packaging with Synapse. Its Roblox project-type registration and the retirement of the standalone Tauri shell remain open (`UP-G017`).
- **Project types** in the fork cover three AI-model scenarios: Scratch (train a new model), Existing (start from an existing model) and Knowledge pack (build on a portable knowledge pack). They are starter kits (`UP-G002`).
- **Features that existed only in Synapse** have no host now: Teach-once desktop automation, Self-Directed Agents and their scheduler, and phone approvals for self-owned steps. Rebuilding them in the extension is a product decision (`UP-G018`).
- Per-finding status: [duplication audit, retirement record](platform-duplication-audit.md#synapse-moves-from-tauri-to-a-vs-code-fork-user-decision-2026-11-27).

## 4. Where the pasted roadmap should change

- **Phase 2 "Secure Rust/WASM execution kernel".** The runtime already runs Node, Python, PHP, .NET and Rust in workers, with a memory manager, a scheduler, Shield, snapshots and recovery.
  - Define a **kernel interface** first: capabilities, resource limits, lifecycle (start/stop/hibernate/checkpoint/restore) and events.
  - Put it over the existing TS implementation and conformance-test it.
  - Swap in a Rust/WASM implementation only where a benchmark proves a gain. Otherwise this phase rewrites working code (vision §14: "demonstrate measurable improvements and preserve current functionality").
- **Phase 0 baseline.** The webcontainers `scripts/benchmark` measure the repo's own test and build times, not runtime performance. Add runtime benchmarks: cold/warm start, idle memory, per-language hello-world, and preview time-to-first-byte. Do this before any kernel work.
- **Phase 1 "workspace, event bus, component contracts".** This is the real P0. It unblocks shared studios and agent/human parity.
- **Phases 8 and 14 (inference, model virtualization).** These begin with *consolidating four engines into one* (`UP-G014`), not building a new one.
- **The Synapse fork phase** (`UP-G015`) sits next to phase 6 (VS Code integration). The fork runs the same VSIX, so it builds on phase 6.

## 5. Target package map (aligned to what exists)

| Vision package | Becomes | Seeded from |
|---|---|---|
| `@builderforce/webcontainers` | unchanged (rename scope) | `builderforce-webcontainers` |
| `@builderforce/runtime` (kernel interface) | new interface package | webcontainers `memory/`, `jobScheduler`, `security/`, `recovery/`, `manifest/capabilities.ts` |
| `@builderforce/starter-kits` | `ide-templates` + `app-detect/manifest` + `AppBlueprint`, as one manifest | those three |
| `@builderforce/workspace` + `events` | new: the workspace port, event bus and component contracts | `agent-run/surface.ts` `RunPorts` pattern |
| `@builderforce/components` (`stage3d`, `code-editor`, `chat`, `preview`, `studios/*`) | extracted from `frontend/src/components` | `brain-ui`, `knowledge-graph-view`, `creation-canvas` |
| `@builderforce/agents` | `agent-run`, `agent-loop`, `agent-tools`, `agent-skills` | unchanged code; one SDK entry |
| `@builderforce/ai` | one inference engine + `model-catalog` + training | `bfi-*` (engine), `local-inference`, `model-catalog` |
| `@builderforce/memory` | `builderforce-memory` (Evermind) | unchanged |
| `@builderforce/security` | one policy model across `code-shield` and webcontainers Shield | both |
| `@builderforce/sdk` | the agent/human SDK + CLI + MCP over `workspace` | today's `/sdk` becomes `sdk/gateway` |

## 6. Decisions (user, 2026-11-26)

1. **Package scope: everything stays `@seanhogg/*`.**
   - Published packages are not renamed.
   - The `@builderforce/*` names in §5 are logical names only.
   - Any NEW published package uses `@seanhogg/builderforce-*`.
2. **Spawn becomes a project type.** Its Roblox bridge (`bf-roblox`) becomes a starter kit and runtime adapter, and the separate Spawn app shell is retired.
   - **A new Movie/Video editor project type is required.** It must be built on the existing video pieces (the `canvasVideoTools.ts` tool set, the canvas video surfaces), not as a new silo.
   - Both live in the starter-kit registry (`UP-G002`).
3. **Synapse extensions: both** Open VSX and manually installed VSIX files. The Synapse VS Code fork takes both (`UP-G015`).
4. **Kernel: interface first; Rust only where a benchmark proves a gain.**
