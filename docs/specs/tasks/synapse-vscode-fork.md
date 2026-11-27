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

These are rebuilt in the Builderforce extension, and need their own design pass:

| Feature | Rebuild |
|---|---|
| Self-Directed Agents and their scheduler | On the existing agent run kernel. |
| Phone approvals | Raises `synapse.step` through `/api/approvals` (the API side exists). |
| Teach-once | Needs a native desktop-automation helper. The old Rust `bf-teach` is in git history at `887ef12~1`. |

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
