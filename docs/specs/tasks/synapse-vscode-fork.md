# Synapse on VS Code: end-state design

Decisions (user, 2026-11-27):
- Synapse, the desktop app, is rebuilt as a fork of Code-OSS. Its source lives in `builderforce-inference/app`.
- It runs the unchanged Builderforce extension (agent runtime and code visualizer) and ships the Spawn extension.
- It offers three AI-model project types: Scratch, Existing and Knowledge pack.
- The features only the Tauri app had are rebuilt (`UP-G018`).
- The `synapse` runtime id is renamed with a migration (`INF-G012`).
- End-user copy never mentions VS Code or a fork ([audit](platform-duplication-audit.md)).

## 1. The fork (`UP-G015`), in `builderforce-inference/app`

The fork follows a build recipe, the way VSCodium does. It does not copy the VS Code source tree.

| File | Contents |
|---|---|
| `app/upstream.json` | `{ "vscodeTag": "<pinned Code-OSS tag>" }`. The extension needs `engines.vscode ^1.101` and was verified against 1.140 for the chat-sessions tab. |
| `app/product.json` | Merged over upstream's `product.json`. See the field list below. |
| `app/patches/*.patch` | Minimal patches only (branding strings, update URL). An empty set is valid. |
| `app/icons/` | Synapse icons (reuse the Tauri app icons from git history, `887ef12~1:app/src-tauri/icons`). |
| `app/scripts/build.mjs` | Builds Synapse for one platform. Steps below. |
| `app/scripts/build.test.mjs` | Unit tests for the pure parts: the product merge and the installer naming. |
| `.github/workflows/synapse.yml` | A matrix of win32-x64, darwin-arm64, darwin-x64 and linux-x64, run on `workflow_dispatch` and on `synapse-v*` tags. It builds and uploads `Synapse_<v>_x64-setup.exe`, `Synapse_<v>_aarch64.dmg`, `Synapse_<v>_x64.dmg` and `.deb`/`.AppImage` to a `v<v>` release, then marks that release latest. Signing uses the existing composite actions. |

**`app/product.json` fields:**
- names: `nameShort`/`nameLong` "Synapse", `applicationName` "synapse", `dataFolderName` ".synapse", `urlProtocol` "synapse";
- ids: `darwinBundleIdentifier` `ai.builderforce.synapse`, plus new win32 app ids;
- `extensionsGallery`: Open VSX;
- `extensionEnabledApiProposals`: `{ "builderforce.builderforce-ai": ["chatSessionsProvider"] }`;
- telemetry: no Microsoft telemetry keys;
- `builtInExtensions`: none (the extensions are copied in at package time).

**`app/scripts/build.mjs` steps:**
1. Clone Code-OSS at `vscodeTag` into `app/.build/vscode`, which is gitignored.
2. Merge `product.json` and apply the patches.
3. Copy the Builderforce VSIX and the Spawn VSIX into `extensions/` as built-ins.
4. Run the upstream gulp `vscode-<platform>-min` and the installer task.
5. Rename the outputs to the Synapse naming, which the site's download resolver already matches (`api/src/application/desktop/synapseInstallers.ts`).

**The fork must not:**
- break `ELECTRON_RUN_AS_NODE` (the extension spawns `process.execPath` with it);
- change the `vscode-webview://` origin (the gateway's CORS allows it).

The URI scheme differs (`synapse:`). The extension already reads `vscode.env.uriScheme`.

## 2. Builderforce extension API (the seam Spawn uses)

`clients/vscode/src/extension.ts` `activate()` returns `BuilderforceApi`, defined in `clients/vscode/src/api/builderforceApi.ts`:

```ts
export interface BuilderforceApi {
  readonly version: 1;
  /** Workspace-scoped tenant JWT for the signed-in user, minted by the existing session; null when signed out. */
  getTenantToken(): Promise<string | null>;
  /** Gateway base URL and web app URL, from the existing configuration accessors. */
  getBaseUrl(): string;
  getWebUrl(): string;
  /** Starts the existing device sign-in. */
  signIn(): Promise<void>;
  readonly onDidChangeSignIn: vscode.Event<boolean>;
}
```

The API is built only from `bfApi/session.ts`, `gateway/gateway.ts` and `auth/auth.ts`. No session logic is copied.

## 3. Spawn extension (`UP-G017`), in `builderforce-spawn/extension`

- **Manifest:** id `builderforce.spawn`, with `extensionDependencies: ["builderforce.builderforce-ai"]`.
- **Sign-in and API calls:** made through `BuilderforceApi`, against `/api/spawn/account` and `/api/spawn/build`, which are host-neutral.
- **`src/bridge.ts`:** a TypeScript port of `crates/bf-roblox/src/bridge.rs`.
  - Loopback `node:http` long-poll on 127.0.0.1, ports 34873 to 34884.
  - Requests need `X-Spawn-Token`; any request with an `Origin` header gets 403.
  - Endpoints: `/poll` (15 s), `/snapshot`, `/result`, `/log` (40 lines, 600 characters each).
  - Body limit 4 MB. "Connected" means a poll within the last 25 s.
  - `bridge.json` is kept in `~/.builderforce/spawn`, the same file the Tauri app uses.
  - Its tests port the Rust unit tests.
- **`src/plugin.ts`:** a port of `plugin.rs`. It writes `SpawnPlugin.lua`, read at build time from `crates/bf-roblox/plugin/SpawnPlugin.lua` (one source), into Studio's plugin folder.
- **`src/build.ts`:** a port of `spawn/src-tauri/src/build.rs` (snapshot, then build, then apply ops).
- **UI:** a webview view that hosts the existing `spawn/ui` files unchanged. `window.__TAURI__.core.invoke` is shimmed to a `postMessage` RPC, and the handlers are the ported Tauri commands. The UI is already localized in 5 locales, and the extension's own strings go through `package.nls` and `l10n` in the same 5 locales.
- **Packaging:** a `.vsix` built by `vsce`. Synapse's build copies it in.
- **The Tauri shell stays** until Synapse ships. It, `bf-cloud` and `bf-vault` are then deleted (this closes AUTH-G001/G002/G008/G009/G013, CHAT-G016 and AVR-G017).

## 4. AI-model project types (`UP-G015`), in the Builderforce extension

One registry, stored as data: `packages/ide-templates/src/projectTypes.ts` exports `PROJECT_TYPES`. Each entry has this shape:

```ts
{ id: 'ai-scratch' | 'ai-existing' | 'ai-knowledge-pack', labelKey, descriptionKey, modality: 'evermind' | 'finetune', kit?: string, firstRun: ProjectTypeAction[] }
```

| Type | Modality | First run |
|---|---|---|
| Scratch | `evermind` | Creates the project and opens the Evermind console. |
| Existing | `finetune` | Picks a local or BYO model, then opens the Finetune studio. |
| Knowledge pack | `evermind` | Runs `createKnowledgePack` or `loadKnowledgePack`. |

- The command `builderforce.newAiProject` and a walkthrough render the registry.
- The command creates the server project through the existing `bfApi.createProject` with the modality, and writes `.builderforce/builderforce.json`.
- Adding a type means adding a registry entry.

## 5. Features only the Tauri app had (`UP-G018`)

These features are rebuilt in the Builderforce extension.

### What they were, from the inventory of `887ef12~1`

- **One feature, three faces.**
  - A **Self-Directed Agent run** replays a Teach-once *skill*: a list of recorded UI steps (click, set value, keys) driven on the real desktop.
  - A run makes **no model call**. It is deterministic.
  - **The scheduler** runs a skill's routine. **Phone approvals** answer a step's approval gate.
  - All three sit on Teach-once.
  - This is a different thing from the chat agent run kernel. It does not run on `agent-run`.
- **Already portable, in TypeScript:** the whole domain lives in the memory packages, with its own tests:
  - `memory-engine/src/experience`: `trainOnce`, the approval defaults, `isDue`/`dueSkills`, the types and the store contract;
  - `memory-mcp/src/experience`: `FileExperienceStore`, the host and training.
- **Native:** only the recorder and replayer (`crates/bf-teach`, about 2,270 lines, Windows UIA and macOS AX behind a `Platform` trait). The vault was `bf-vault`.
- **The API side exists:** `/api/approvals` with the self-owned `synapse.step` action type. It is owner-only, never auto-approved, and claimed atomically.

### Pieces

| Piece | Where | Contents |
|---|---|---|
| **A. Native helper** | `builderforce-inference/crates/bf-teach`, restored from `887ef12~1`, plus a new bin `bf-teach-helper` | The JSON-lines stdio protocol below, and nothing else. It is a separate process, because the hooks and UIA/AX are thread-affine, need OS permissions, and must not be able to crash the extension host. `release.yml` publishes it for win32-x64, darwin-arm64 and darwin-x64. Linux reports `supported:false`. |
| **B. Experience export** | `builderforce-memory/packages/memory-mcp`, new `./experience` subpath | `createExperienceHost({ memoryFile, modelFile? })` without the env gate. It re-exports `FileExperienceStore`, `trainExperience` and `asEpisode`. The extension uses it in-process: no MCP server is spawned, and no opt-in env is needed. A memory release follows. |
| **C. Extension** | `clients/vscode/src/experience/` | The modules below. The helper is vendored like `bfi-node` (`packages/bf-teach-helper/bin/<platform>/`, copied by `esbuild.mjs`, packaged per platform by `vsce-platform`). |

### Helper protocol (A ↔ C)

- **Framing:** one JSON object per line on stdin and stdout.
  - The host sends requests `{id, method, params}`.
  - The helper answers `{id, result}` or `{id, error:{code, message}}`, and pushes `{event, ...}`.
  - Secrets travel only on stdin, never in argv or env.
- **Methods:**

| Method | Params | Result |
|---|---|---|
| `hello` | none | `{protocol:1, platform, supported}` |
| `record.start` | `{program, args, shotsDir}` | `{}` |
| `record.stop` | none | `{episode}` in the engine's `Episode` JSON, or `{episode:null}` when it is empty |
| `run.start` | `{skill, values}` | `{}`. One run at a time, otherwise error `busy`. |
| `run.stop` | none | `{}` |
| `approve.answer` | `{idx, approved}` | `{}` |

- **Events:**
  - `run.stepStarted {idx}`
  - `run.stepFinished {idx, outcome, detail?}`
  - `run.approvalNeeded {idx}`: the helper blocks until `approve.answer` arrives.
  - `run.finished {status: succeeded|failed|stopped|denied, error?}`
  - `record.step {count}`
- **Esc takeover** stays inside the helper and ends the run as `stopped`.
- A missing secret fails `run.start` before anything moves.

### Extension modules (C), one concern each

- **`teachHelper.ts`:** spawns the vendored helper and implements the protocol client behind a `TeachHelperPort`. Tests use a fake port.
- **`experienceHost.ts`:** builds B's host beside the extension's existing memory file.
- **`skillSecrets.ts`:** secret params in `vscode.SecretStorage` (the OS keychain), keyed `skill:<id>:<param>`. This replaces `bf-vault`.
- **`skillRunner.ts`:** one run at a time. It:
  - resolves values (given, then routine values, then secrets);
  - writes the audit trail through `run_start` / `run_step` / `run_finish` on the store;
  - marks orphaned `running` runs as failed on activation;
  - races approvals: the in-window answer against the phone relay, first answer wins;
  - treats a timeout (15 min) or a Stop as **no**;
  - writes the `synapse.skill.<id>.last-run` fact.
- **`phoneApprovalRelay.ts`:** `open` posts `/api/approvals` with `{kind:"approval", actionType:"synapse.step", description, metadata:{runId, skill, step, action}, expiresAt}`. `answer` polls `GET /api/approvals/:id` every 3 s. `close` sends `PATCH` with `reviewNote "Answered in Synapse"`.
  - The HTTP calls live in one `bfApi/approvals.ts` client. The list and resolve calls in `bfApi/runtime.ts` move into that client, and callers migrate.
  - The relay runs only while signed in and with `builderforce.agents.phoneApprovals` on.
- **`routineScheduler.ts`:** a 30 s tick. It does nothing when the agents are off or a run is active. Otherwise it runs the first skill from `engine.dueSkills(...)` with trigger `routine`.
- **`skillsView.ts` plus a webview:** a "Skills" view with:
  - Teach (pick a program, record, stop, review edits, compile with `trainOnce`);
  - skill cards (Run, Schedule, Delete);
  - the run form, with password inputs for secrets and "remember";
  - the routine form;
  - run history with per-step outcomes;
  - the live run card (Stop, step N, the approval prompt);
  - the phone-approvals opt-in.
  - All strings are l10n in 5 locales. Colours come only from theme tokens.
- **`trainPrivateModel` command:** `trainExperience` on the configured `.evermind` file.
- **Settings:**
  - `builderforce.agents.enabled` (off by default; the first enable asks for consent and stores `consentedAt`);
  - `builderforce.agents.phoneApprovals`;
  - `builderforce.agents.modelFile`.
- **Gating:** on Linux, or when `hello` says `supported:false`, the view shows a "Not available on this system" state, and the commands are hidden by a `when` context key.

### Order

1. A and B in parallel.
2. Release memory.
3. C. It starts after batch 2 leaves `clients/vscode`.
4. One review (Opus: native input automation, secrets and approvals), then verification, then ship.

## 6. Runtime id rename (`INF-G012`), done expand/contract

- **New id:** `bfi-serve`. The user label stays "Synapse".
- **Push 1 (expand):**
  - one `normalizeLocalRuntimeId()` in `local-inference` maps `synapse` to `bfi-serve`;
  - model refs `local/synapse/…` are read as `local/bfi-serve/…`;
  - the VS Code setting `localModels.bfiServeUrl` falls back to the deprecated `localModels.synapseUrl`;
  - the Chrome storage key migrates on read;
  - brain-embedded and API engine enums accept both values and write `bfi-serve`;
  - reports label both as "Synapse".
- **Push 2 (contract):** drop the `synapse` aliases one release later (`INF-G019`).

## Order

| Batch | Work |
|---|---|
| 1 (now, parallel) | §1 fork recipe · §2 and §3 extension API plus the Spawn extension · §6 push 1 |
| 2 | §4 project types |
| 3 | §5 design, then build |

Each batch gets one combined review: Opus for §1 and §6 (release pipeline and migration), and for the cross-repo §2/§3. Then one verification and a commit.
