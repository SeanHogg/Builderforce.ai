# PRD 49 — end-state design

> Status: reviewed (QA + CTO, approve with changes). Contracts below include those changes. Implementation follows this file, not the earlier draft.
> Spec: `docs/specs/make.md` § "PRD 49 — Methodology personas and the `.builderforce/` workspace layout".
> This file names the contracts, the file that owns each behaviour, the sequences, and the test that proves each §9 done-check.

## 0. Seams confirmed against the code (2026-11-21)

| Brief said | Code actually has | Consequence |
|---|---|---|
| `clients/vscode/src/editorRunSettings.ts` (`stageModels`) | `clients/vscode/src/stageModels.ts` exports `stageModels(settings, envPins = {})` (L41), `StageModels` (L19), `StageModelSettings` (L30). Stages are `plan`, `code`, `review`, `subagent`, `quick` only. | Policy is resolved inside `stageModels`. `envPins` stays. There is no build, test, or search stage. |
| `@builderforce/pipeline-route` (`scorePipeline`) | `packages/pipeline-route/src/score.ts:146`. `forceFull: true` already forces the full route. | Persona `route: 'pipeline'` sets `forceFull`. No new router branch. |
| `builderforce.pipelineRouteReport` | `clients/vscode/src/pipelineRouteReport.ts`. | WS-D owns this file: path migration and the policy column. WS-B does not edit it. |
| `PersonaRegistry` / `PersonaPlugin` | `agent-runtime/src/builderforce/personas.ts`. `PersonaPlugin = AgentRole & { source, pluginMetadata?, filePath?, active? }` (`types.ts:457`). `AgentRole` already has `model?: string` (a model id). `registerBuiltins(roles: AgentRole[])` (`personas.ts:68`) copies each role with `source: "builtin"` and indexes by **`role.name`**. Personas have no `id`. | Methodology fields are a nested `methodology?` object, never a second `model`. Registry key is `name`. |
| Footer picker | `clients/vscode/webview/src/chat/VsCodeComposer.tsx` (`PersonaPicker`, `BrainPersonaChoice`); labels in `webview/src/chat/chatLabels.ts`. | Gate hints are data on the choice. |
| Prompt role line | `buildPersonaSystemBlock` in `agent-runtime/src/builderforce/personas.ts` already emits `Role: ${name}`. | `methodology.work` is appended there. No second prompt path. |
| Local models | Catalog consumed by `clients/vscode/src/modelRouting.ts`. File store: `clients/vscode/src/hostBfi/modelFiles.ts`. | ONNX entries join the catalog `modelRouting` already reads, with a `format` field. |
| Knowledge packs | `clients/vscode/src/knowledge/packs/` (BFKP, `CompressionStream`). | Gzip is a writer option, not a new format. |
| `read_file` | `packages/agent-tools/src/fileRead.ts`. The package is free of `node:*` (it runs in the Worker, the browser and Node). `read_compressed` is LLMLingua-2 (`read-compressed-tool.ts`) and keeps that meaning. | Gzip inflate uses `DecompressionStream`, not `node:zlib`. |
| Write tools | `packages/agent-tools/src/core-tools.ts` `write_file` (L168) and `edit_file` (L235). | `writeAllowed` is called there, before the write. Any VSIX path that writes without those tools (`write_file` / `edit_file` / `delete_file` in `clients/vscode`) calls the same function. |
| Manifest reader | `builderforce-webcontainers/packages/browser/src/launcher/server/launchInfo.ts:38` `readManifest`. `buildLaunchInfo` reports `manifestPath` and `manifestSource`. `import.meta.url`: `launcherAssets.ts:43`, `dotnetBundle.ts:47`. | `locateManifest` feeds both fields. `manifestSource: 'legacy'` when the root fallback was read. |
| Webcontainers dependency | `clients/vscode/package.json` already depends on `@seanhogg/builderforce-webcontainers` and `@seanhogg/builderforce-webcontainers-core` at `^2026.11.7`. | Not a new dependency. A version bump once WS-A publishes. The pure check is imported from the core `./manifest` subpath, which has no Node `fs`. |
| Usage ledger | `clients/vscode/src/runUsageLedgerPorts.ts` (`recordUsage`). The route report reads it. | The ledger row gains `policy`. The report groups by it. |

## 1. Contracts

### 1.1 Path validation (core, pure — ships first)

Lives in `builderforce-webcontainers/packages/core/src/manifest/paths.ts`. Exported from `@seanhogg/builderforce-webcontainers-core/manifest`. No `node:*`, no `fs`.

```ts
export type WorkspacePathKey = 'logs' | 'diagnostics' | 'methodology';

export interface ManifestPaths {
  logs?: string;
  diagnostics?: string;
  methodology?: string;
}

export type PathIssueCode =
  | 'path-absolute'   // starts with / or a drive prefix
  | 'path-parent'     // contains a .. segment
  | 'path-empty';

export interface PathIssue {
  code: PathIssueCode;
  key: WorkspacePathKey;
  value: string;
}

/** Pure. Rejects absolute paths and any `..` segment. Does not touch the filesystem. */
export function validateWorkspacePath(value: string): PathIssueCode | null;
```

A symlink that resolves outside the root is not a separate code. The spec only requires blocking `..` and absolute paths.

Defaults, applied when an override is absent or invalid:

| Key | Default (relative to the workspace root) |
|---|---|
| `methodology` | `.builderforce/methodology` |
| `logs` | `.builderforce/logs` |
| `diagnostics` | `.builderforce/diagnostics` |

`AppManifest` (`packages/core/src/manifest/types.ts`) gains optional `paths?: ManifestPaths`. The JSON Schema and README gain the same field. Root-manifest examples are removed.

### 1.2 Manifest location (browser package)

`packages/browser/src/manifest/locate.ts`. Uses Node `fs` to read. Does not import the launcher server. Re-exported from a new `@seanhogg/builderforce-webcontainers/manifest` subpath so a host that bundles the launcher does not pull this in by accident, and so the VSIX never imports `./launcher/server`.

```ts
export interface ManifestLocation {
  file: string;
  legacy: boolean;
}

export interface LocatedManifest {
  location: ManifestLocation;
  manifest: AppManifest;
  /** Invalid path overrides are omitted from `manifest.paths` and listed here. */
  issues: Array<PathIssue | { code: 'legacy-manifest'; file: string }>;
}

/**
 * Read order: `.builderforce/builderforce.json`, then root `builderforce.json`,
 * then root `bfwc.app.json`. A root file sets `legacy: true` and adds
 * `legacy-manifest`. Nothing here writes.
 */
export function locateManifest(root: string): Promise<LocatedManifest | null>;
```

`launchInfo.ts` `readManifest` calls `locateManifest`. `buildLaunchInfo` sets:

- `manifestPath` = `location.file`
- `manifestSource` = `'file'` when `legacy` is false, `'legacy'` when true, `'missing'` when null

A legacy read is therefore visible. The deprecation note required by §6 is that `manifestSource`.

### 1.3 Launcher options (item 29)

Added to `LocalLauncherOptions` in `packages/browser/src/launcher/server/launcher.ts`. `assetsDir` is the primary asset source for `launcherAssets.ts` and `dotnetBundle.ts`. `import.meta.url` remains only when `assetsDir` is omitted (dev). Bind stays `127.0.0.1`.

```ts
assetsDir?: string;
frameAncestors?: string;                 // default 'self'
apiIngress?: { prefix: '/api'; target: string };
setup?: string[];
startPage?: string;
reportToken?: string;                    // absent = POST /__bf/report is not mounted
onReport?(report: PreviewReport): void;
onLog?(line: string): void;
onError?(error: unknown): void;
egress?: string[];                       // each entry must be a host; else a typed issue
cdnPins?: string[];
ignoredDirs?: string[];                  // file API and live sync skip these
```

`POST /__bf/report` (`launcher/server/reportRoute.ts`) checks `reportToken`, then writes the body under the diagnostics folder from §1.1. Starters and `/preview` write `.builderforce/builderforce.json` and never a root manifest.

### 1.4 The one resolver (VSIX)

`clients/vscode/src/workspace/workspacePaths.ts`. Pure: no filesystem writes.

```ts
import { validateWorkspacePath } from '@seanhogg/builderforce-webcontainers-core/manifest';

export interface WorkspacePaths {
  root: string;          // <workspace>/.builderforce
  methodology: string;
  logs: string;
  diagnostics: string;
  rules: string;         // <workspace>/.builderforce/rules       (not overridable)
  hooks: string;         // <workspace>/.builderforce/hooks.json  (not overridable)
  personas: string;      // <workspace>/.builderforce/personas    (not overridable)
  cache: string;         // <workspace>/.builderforce/cache       (gitignored)
}

export function workspacePaths(root: string, located: LocatedManifest | null): WorkspacePaths;
```

`workspacePaths` does not create folders and does not write `.gitignore`.

```ts
/**
 * The one I/O step. Every writer calls this before it writes.
 * Creates methodology, logs, diagnostics, rules, personas, cache when missing.
 * Writes `<workspace>/.builderforce/.gitignore` containing `logs/`, `diagnostics/`, `cache/`.
 * Does not list the manifest, rules, hooks, or methodology.
 */
export function ensureWorkspaceDirs(paths: WorkspacePaths): void;
```

### 1.5 Persona contract

`AgentRole.model?: string` stays a model id. Methodology is nested so it cannot collide, and so `buildPersonaSystemBlock` does not treat a route as a model id.

```ts
export type PersonaColour = 'analyst' | 'designer' | 'engineer' | 'support';
export type PersonaRoute = 'plan' | 'pipeline' | 'quick';
export type PersonaKnowledge = 'context' | 'first';

export type ArtifactId = 'prd' | 'design' | 'mockup' | 'diagram' | 'support';

export interface PersonaMethodology {
  colour?: PersonaColour;
  /** Route kind. Not AgentRole.model. */
  route?: PersonaRoute;
  knowledge?: PersonaKnowledge;
  requires?: ArtifactId[];
  produces?: ArtifactId[];
  recordsRun?: boolean;
  /** Registry `name` of the next role. Successor means this field, not table order and not listAll() sort. */
  next?: string;
  /** Appended by buildPersonaSystemBlock after the Role line. */
  work?: string;
  /**
   * Resolved through workspacePaths(), never a literal workspace-relative string.
   * 'root' is the workspace root (the Engineer).
   * A sub path is a folder under the resolved key (`support` under methodology).
   * No `..`.
   */
  writeScope?: Array<
    | { key: 'root' }
    | { key: WorkspacePathKey; sub?: string }
  >;
}

/** Absent methodology means every write is allowed, so existing personas keep working. */
export type PersonaPlugin = AgentRole & {
  source: 'builtin' | 'user' | 'project';
  methodology?: PersonaMethodology;
  /* existing pluginMetadata, filePath, active unchanged */
};
```

`registerBuiltins` widens to `Array<AgentRole & { methodology?: PersonaMethodology }>`. It copies `methodology` onto the plugin. The registry key remains `name`.

A user or project persona with the same `name` replaces the built-in, which is existing registry behaviour. The gate reads the **resolved** plugin. An override that omits `methodology` has no `requires` (the gate passes). An override that wants the gates must include `methodology`.

Artifact files, resolved against `workspacePaths().methodology`:

| id | path |
|---|---|
| `prd` | `prd.md` |
| `design` | `design/design.md` |
| `mockup` | `design/*.html` (the Designer exit gate; other HTML in `design/` also matches — accepted) |
| `diagram` | `design/*.drawio` |
| `support` | `support/*.md` |

Run records are not an `ArtifactId`. Constant `RUN_RECORD_DIR = 'runs'`. A run record is `methodology/runs/<runId>.md`.

### 1.6 The four built-ins

One `registerBuiltins` call. Keyed by `name`. Data, not branches.

| name | route | knowledge | requires | produces | recordsRun | next | writeScope |
|---|---|---|---|---|---|---|---|
| `analyst` | `plan` | `context` | — | `prd` | false | `designer` | `[{ key: 'methodology' }]` |
| `designer` | `plan` | `context` | `[prd]` | `design`, `diagram`, `mockup` | false | `engineer` | `[{ key: 'methodology' }]` |
| `engineer` | `pipeline` | `context` | `[prd, mockup]` | — | true | — | `[{ key: 'root' }]` |
| `support` | `plan` | `first` | — | `support` | false | — | `[{ key: 'methodology', sub: 'support' }]` |

`producerOf` primary lookup: the first role in **methodology order** (the table above: analyst, designer, engineer, support — not `listAll()` alphabetical order) whose `produces` includes the artifact.

Cross-check, which agrees for the two artifacts the spec's rule names: the earliest role that does not require the artifact and whose `next` role does. "Successor" means `next`, not sort order.

| Artifact | Producer |
|---|---|
| `prd` | `analyst` |
| `mockup` | `designer` |
| `design`, `diagram` | `designer` |
| `support` | `support` |

### 1.7 Gate checker (pure)

```ts
export interface GateResult {
  role: string;                       // persona name
  missing: ArtifactId[];
  producers: Partial<Record<ArtifactId, string>>;  // producer names
  passed: boolean;
}

export function checkGate(
  role: PersonaPlugin,
  methodologyDir: string,
  exists: (path: string) => boolean,
): GateResult;

export function producerOf(artifact: ArtifactId, roles: readonly PersonaPlugin[]): string | null;
```

`exists` throwing is an I/O failure, not a blocked gate. The caller keeps the previous hints and posts the error. A blocked gate (`passed: false`) is a successful check: hints are updated.

No model call on this path.

### 1.8 Chat state

```ts
export interface ChatPersonaState {
  /** Active role name, or null when the role is off. */
  role: string | null;
  lastRequest: string | null;
  /** Missing artifacts per role name, from the last successful check of every role. */
  hints: Record<string, ArtifactId[]>;
}
```

Storage: the local chat record behind `BrainPersistenceAdapter` (`@seanhogg/builderforce-brain-embedded`). Field `persona?: ChatPersonaState` on that record. The only reader and writer is `clients/vscode/src/persona/chatPersona.ts`. A record with no `persona` field loads as `{ role: null, lastRequest: null, hints: {} }` (role off). Not workspace settings. Not a global.

The implementation attaches the field to the existing chat record type. It does not add a second store.

### 1.9 Write scope (tool layer)

`packages/agent-tools` must not import `agent-runtime` types.

```ts
export interface WriteScopeDecision {
  allowed: boolean;
  reason?: string;
}

export type WriteScopeEntry =
  | { key: 'root' }
  | { key: 'logs' | 'diagnostics' | 'methodology'; sub?: string };

/**
 * `scope` undefined → allowed (no methodology block).
 * Otherwise the target must stay inside a resolved scope folder.
 * `paths` comes from workspacePaths(); this function does not compute paths itself.
 */
export function writeAllowed(
  scope: readonly WriteScopeEntry[] | undefined,
  paths: { root: string; methodology: string; logs: string; diagnostics: string },
  target: string,
  roleName: string,
): WriteScopeDecision;
```

Callers, before the write:

- `packages/agent-tools/src/core-tools.ts` `write_file` and `edit_file` (and `delete_file` if that tool writes)
- any `clients/vscode` tool handler for `write_file`, `edit_file`, or `delete_file` that does not go through those

The active role's resolved `methodology.writeScope` and `name` are passed in. No persona type crosses the package boundary.

### 1.10 Model policy

```ts
export type ModelPolicy = 'role' | 'tip';

export function stageModels(
  settings: StageModelSettings & { policy?: ModelPolicy },
  envPins: StageModels = {},
): StageModels;
```

`envPins` always win, for both policies. Call sites do not branch on `policy`.

TIP maps onto the stages that exist. There is no build, test, or search stage, so the spec's "build and test = Sonnet; search = Haiku or local" is expressed as:

| Stage | `tip` model |
|---|---|
| `plan`, `code`, `review` | the catalog's Opus id (Fable, when that is the plan default, is swapped for this id) |
| `subagent` | the catalog's Sonnet id (build and test run as subagent work) |
| `quick` | the catalog's Haiku id, or the provisioned local model when one is selected (search runs as quick) |

`role` (default, and when `policy` is omitted) keeps today's resolution, then persona `route` selects which stage the run uses:

| `route` | Effect under `role` |
|---|---|
| `plan` | plan stage |
| `pipeline` | `scorePipeline(..., { forceFull: true })` — plan, then code, then review, server-owned order |
| `quick` | quick stage |
| omitted | today's behaviour |

Opus, Sonnet, and Haiku are concrete catalog ids in one table in `stageModels.ts` (`TIP_MODELS`). They are not display names. A test asserts each id is in the model catalog.

The usage-ledger row (`recordUsage`) gains `policy: ModelPolicy`. `renderRouteReport` groups by it.

### 1.11 Local catalog

```ts
export type LocalModelFormat = 'gguf' | 'onnx';

export interface LocalModelEntry {
  id: string;
  format: LocalModelFormat;
  file: string;
}

export const ENGINE_BY_FORMAT: Record<LocalModelFormat, 'bfi' | 'onnx'>;
```

Entries are added to the catalog `modelRouting` already consults (if that list lives in `localModels.ts` rather than `modelFiles.ts`, that file is the owner; `modelFiles.ts` stays the file store and does not grow a second list). Existing GGUF entries gain `format: 'gguf'`. New entries: `Bonsai-8B-q4f16-ONNX`, `Bonsai-4B-q4f16-ONNX`, `Bonsai-1.7B-q4-ONNX`, `format: 'onnx'`.

bfi provisioning keeps handling `gguf` only. `modelRouting` sends `onnx` to the ONNX engine through `ENGINE_BY_FORMAT`. One function, both formats.

### 1.12 Gzip

```ts
/** The one inflater. DecompressionStream('gzip'). No node:zlib. */
export async function readGzipText(bytes: Uint8Array): Promise<string>;
```

`fileRead.ts` calls it for a `.gz` path and reports `decompressed: true` on the tool result. `search_code` uses the same helper for `.gz` inputs. `read_compressed` is untouched.

The BFKP writer takes `compress: boolean`, default `true`, and appends `.gz`. The methodology pack is a codebase pack over `workspacePaths().methodology`, built by the existing pipeline. It is attached only while some live chat has `persona.role !== null`. That check reads `ChatPersonaState` (WS-C); WS-F does not invent a second flag.

## 2. Codemap — one owner per behaviour

| Behaviour | Owner | Notes |
|---|---|---|
| `validateWorkspacePath`, `ManifestPaths` | `builderforce-webcontainers/packages/core/src/manifest/paths.ts` | Pure. Exported from core `./manifest`. |
| `locateManifest` | `builderforce-webcontainers/packages/browser/src/manifest/locate.ts` | `launchInfo.ts` calls it. Feeds `manifestPath` and `manifestSource`. |
| Schema, README, starters | core schema + browser README + starter templates | `paths` added. Starters write `.builderforce/builderforce.json`. |
| Launcher options | `packages/browser/src/launcher/server/launcher.ts` | `assetsDir` consumed by `launcherAssets.ts` and `dotnetBundle.ts`. |
| `POST /__bf/report` | `packages/browser/src/launcher/server/reportRoute.ts` | Token, then diagnostics folder. |
| `workspacePaths` | `clients/vscode/src/workspace/workspacePaths.ts` | Pure. Imports `validateWorkspacePath` from core. |
| `ensureWorkspaceDirs`, `.gitignore` | same file | The only I/O. Writers call it. |
| Writer path migration | each existing writer, except the files named under WS-D and WS-F | Grep `.builderforce/` in `clients/vscode/src` at the start of WS-B. Confirmed: `childDataFile.ts` → `cache`. `pipelineRouteReport.ts` is WS-D's, including its path. Pack writer is WS-F's. |
| Persona fields | `agent-runtime/src/builderforce/types.ts` | Nested `methodology?`. `registerBuiltins` widened in `personas.ts`. |
| Four built-ins | `agent-runtime/src/builderforce/methodologyPersonas.ts` | Data table. Registered through the widened `registerBuiltins`. |
| Gate, `producerOf` | `agent-runtime/src/builderforce/methodologyGate.ts` | Pure. |
| Run record | `clients/vscode/src/persona/personaRun.ts` | When `recordsRun` is true, writes `methodology/runs/<runId>.md` through the write tool (so scope applies). |
| Write scope | `packages/agent-tools/src/writeScope.ts` | Called from `core-tools.ts` `write_file` / `edit_file` and any VSIX writer that bypasses them. |
| Chat persona state | `clients/vscode/src/persona/chatPersona.ts` | Field `persona` on the existing local chat record. |
| Gate message, next-role offer | `clients/vscode/src/persona/personaRun.ts` | The button calls the existing composer send with an explicit `role` argument. It does not put a prefix in the user text. |
| Picker hints | `VsCodeComposer.tsx` | `BrainPersonaChoice` gains `missing: string[]`. Labels in `chatLabels.ts`. |
| Prompt role line and `work` | `buildPersonaSystemBlock` (`personas.ts`) | One prompt path. |
| `persona-<colour>` | `clients/vscode/webview` composer stylesheet | Theme tokens (`--bf-persona-analyst` and the other three) defined for both themes. |
| Policy | `clients/vscode/src/stageModels.ts` | `TIP_MODELS` table. `envPins` kept. |
| Ledger + route report | usage ledger row; `pipelineRouteReport.ts` | WS-D owns the report file, including moving its output under `paths.diagnostics`. |
| ONNX catalog | the catalog `modelRouting.ts` reads; engine map beside it | One routing function. |
| Gzip helper | `packages/agent-tools/src/gzipText.ts` | `fileRead.ts` and the search reader call it. |
| Pack gzip + methodology pack | `clients/vscode/src/knowledge/packs/` | `compress` default on. Attached only while a role is on. |
| Strings | `chatLabels.ts` and `vscode.l10n` | No literal in a component. |

### Workstream file ownership

| Workstream | Files | Depends on |
|---|---|---|
| WS-A | `builderforce-webcontainers/**` only | nothing; ships first |
| WS-B | `clients/vscode/src/workspace/**`, and the path literal inside each existing writer **except** `pipelineRouteReport.ts` and `clients/vscode/src/knowledge/packs/**` | WS-A's `validateWorkspacePath` export. Version bump of core; the dependency already exists. |
| WS-C | `agent-runtime/src/builderforce/methodology*.ts`, `types.ts`, `personas.ts` (`registerBuiltins` + `buildPersonaSystemBlock`), `packages/agent-tools/src/writeScope.ts`, `core-tools.ts` (the call only), `clients/vscode/src/persona/**`, `webview` composer + labels | WS-B for the methodology folder |
| WS-D | `stageModels.ts`, the usage-ledger row, `pipelineRouteReport.ts` (path **and** policy column) | none. Does not wait for WS-B. |
| WS-E | the local-model catalog `modelRouting.ts` reads, plus `modelRouting.ts` | none |
| WS-F | `packages/agent-tools/src/gzipText.ts`, `fileRead.ts`, the search reader, `clients/vscode/src/knowledge/packs/**` | WS-B for the folder; WS-C for `ChatPersonaState` (timing, not a shared file) |

WS-C and WS-F both touch `packages/agent-tools` but not the same files (`writeScope.ts` + the call in `core-tools.ts` vs `gzipText.ts` + `fileRead.ts`). They are still sequenced so a `core-tools.ts` edit cannot collide with a `fileRead.ts` edit in one package publish. WS-A, WS-D, and WS-E share no files and start together.

Before WS-B starts it lists every `.builderforce/` writer and checks that list against WS-D and WS-F. A writer not in that exclusion list is WS-B's.

## 3. Sequences

### 3.1 Gate check → run → next-role offer

```
user picks Engineer (name: engineer)
        │
        ▼
personaRun.start(chat, 'engineer', request)
        │
        ├─ checkGate(resolved engineer, methodologyDir, exists)     ← pure, no model call
        │       missing: [prd, mockup]
        │       producers: { prd: analyst, mockup: designer }
        │
        ├─ hints updated for every role (a blocked gate is a successful check)
        │
        ├─ post chatLabels.gateBlocked
        │     names the producers: Analyst writes the PRD, Designer writes the mockup
        │
        └─ return. No model call, no stage, no ledger row.

exists() throws
        │
        ├─ hints are NOT updated
        └─ post the error. No model call.
```

```
user picks Analyst; prd.md is absent
        │
        ▼
checkGate → passed
        │
        ├─ hints updated for every role
        ├─ buildPersonaSystemBlock appends methodology.work after "Role: Analyst"
        ├─ stageModels(settings, envPins) with the role policy     ← resolved inside stageModels
        ├─ run executes
        │       writeAllowed(scope, paths, target, 'analyst') refuses a path outside methodology/
        ├─ recordsRun is false, so no run record
        └─ post chatLabels.gatePassed ("Continue as Designer on the same request?") + button
                │
                ▼ accept
          composer.send({ text: lastRequest, role: 'designer' })
                │
                └─ the ONE composer send path. The role is an argument.
                   User text that starts with a handoff-shaped prefix does not switch roles.
```

The Engineer, when `recordsRun` is true, writes `methodology/runs/<runId>.md` through the write tool after the run.

### 3.2 Knowledge-first switch-off

Support only. Other roles do not switch off this way.

```
support run answers entirely from pack passages (no file read, no tool write)
        └─ personaRun sets persona.role = null for that chat and posts that the role is off
```

### 3.3 Manifest resolution

```
locateManifest(root)
   ├─ .builderforce/builderforce.json → legacy = false, manifestSource = 'file'
   ├─ else root builderforce.json     → legacy = true,  manifestSource = 'legacy', issue legacy-manifest
   ├─ else root bfwc.app.json         → legacy = true,  manifestSource = 'legacy', issue legacy-manifest
   └─ else null, manifestSource = 'missing'

paths.logs = "../x" → issue { code: 'path-parent', key: 'logs' }, override dropped,
                      workspacePaths returns .builderforce/logs
```

No branch writes a root manifest.

## 4. §9 done-checks → tests

| # | Check | Test |
|---|---|---|
| 1 | Engineer with no `prd.md` posts the gate naming the Analyst, no model call | `methodologyGate.test.ts`: `missing` is `prd` and `mockup`, `producers.prd` is `analyst`. `personaRun.test.ts`: the message equals `chatLabels.gateBlocked`; the model invoker spy is not called. |
| 2 | Analyst writes `methodology/prd.md`, offers Continue as Designer; accepting replays the same request as Designer | `personaRun.test.ts`: the offer equals `chatLabels.gatePassed`. The button calls the composer send spy with `{ text: lastRequest, role: 'designer' }` and nothing else. |
| 3 | A write outside the methodology folder is refused by the tool layer | `writeScope.test.ts`: analyst scope refuses `src/a.ts` with a reason and allows `methodology/prd.md`; engineer `root` scope allows `src/a.ts`; omitted scope allows everything. `core-tools` write test: the spy on `writeAllowed` is consulted before the file is written. |
| 4 | A later run recalls a sentence from `prd.md` through the codebase pack | `methodologyPack.test.ts`: seed a sentence in `prd.md`, build the pack, query it, and get that sentence back. The pack is attached when a chat has `persona.role` set, and absent when every chat has the role off. |
| 5 | `policy: 'tip'` routes code to the Opus catalog id; the default routes by role; the report shows both | `stageModels.test.ts`: default code stage is unchanged; `policy: 'tip'` code stage equals `TIP_MODELS.opus`, which is in the catalog; `envPins.code` wins over both. `pipelineRouteReport.test.ts`: rows group by `policy`. |
| 6 | ONNX q4 and GGUF both answer through the same routing | `modelRouting.test.ts`: one `modelRouting` call resolves an ONNX catalog entry to the ONNX engine and a GGUF entry to bfi. A catalog-only assertion is not this test. |
| 7 | A new pack is `.gz`; `read_file` reads a `.gz` as text | Writer test: default path ends `.gz` and inflates to the original. `fileRead.test.ts`: a gzipped fixture returns the text with `decompressed: true`. A `search_code` fixture over a `.gz` file matches a string inside it. `read_compressed` tests are unchanged. |
| 8 | Manifest read from `.builderforce/builderforce.json`; a root file is read with `manifestSource: 'legacy'` and never written; logs and diagnostics land in their defaults; `../x` is rejected | `locate.test.ts`: read order and `legacy-manifest`. `launchInfo` test: `manifestSource` is `'legacy'` for a root file. A starter (or `/preview`) write-target test: the path is `.builderforce/builderforce.json`. `workspacePaths.test.ts`: `../x` yields the default and the issue. A writer test: the route report (or launcher log) is written under `paths.diagnostics` / `paths.logs`. |

Hints: `personaRun.test.ts` includes a case where `exists` throws. Previous hints are unchanged and the error is posted. A blocked Engineer check updates hints.

A live check is recorded only for the packaged VSIX version and the picker rendering the gate hint in both themes. Everything in §9 is a unit test.

## 5. Decisions

1. **`stageModels` is in `clients/vscode/src/stageModels.ts`.** The brief's `editorRunSettings.ts` does not exist. `envPins` stays the second argument.
2. **`forceFull` already exists.** Persona `route: 'pipeline'` uses it.
3. **`produces` is the primary producer lookup.** The spec's successor rule is the cross-check. They agree for `prd` and `mockup`. Successor means `next`.
4. **The Engineer writes the workspace root** (`{ key: 'root' }`), because source, CI, infrastructure, and tests are not one folder.
5. **LAN access is not implemented.** Bind stays `127.0.0.1`.
6. **Manifest v2 models section is out of scope.**
7. **The VSIX already depends on webcontainers core.** WS-A adds `validateWorkspacePath` to the existing pure `./manifest` export and bumps the package version. WS-B bumps the version range. It does not add a dependency and does not copy the function.
8. **TIP has no build, test, or search stage.** Those map onto `subagent` (Sonnet) and `quick` (Haiku or local). Plan, code, and review are the Opus catalog id. Fable is swapped for that id.
9. **A blocked gate updates hints.** Only an `exists` throw keeps the previous hints.
10. **Handoff is a `role` argument on the existing send.** A prefix in user text does not switch roles.
11. **`writeAllowed` takes scope entries, not `PersonaPlugin`.** `agent-tools` does not depend on `agent-runtime`.
12. **`workspacePaths` is pure.** `ensureWorkspaceDirs` is the one I/O step and the only `.gitignore` writer.

## 6. Not in this design

- No second persona registry, no persona branch in the run loop, no per-tool gzip copy, no root manifest writer, no prompt-text enforcement of write scope.
- PRD 45 rule gates and PRD 48 ship policy are not touched. A persona never bypasses either.
- Publish of the webcontainers packages (tag and push) is a release step. This chat's publish hold leaves that uncommitted until the hold is lifted.
