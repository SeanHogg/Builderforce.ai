# PRD 14 — BuilderForce VS Code Extension (reused chat UI + codebase-aware coder + browser device-code login)

**Status:** Draft — ready for implementation in a fresh chat.
**Owner track:** New track T7 · IDE Clients (`clients/vscode/**`) consuming T2 · Frontend/Chat (`brain-embedded/**`, the Brain UI in `frontend/src/components/**`), T4 · Cloud Runtime / agent-runtime (`agent-runtime/src/builderforce/agent-loop/**`, `native-file-tools.ts`, `infra/knowledge-loop.ts`, `infra/ssm-memory-service.ts`, `builderforce/project-init.ts`), and T3 · Gateway & Auth (`api/src/application/auth/**`, `authRoutes.ts`, `llmRoutes.ts`).
**Migration band:** draw the next free numbers from `api/migrations/` (latest in tree is `0196`; PRD 13 reserves `0197`–`0198` if it lands first — **confirm before writing**). This PRD needs **one** new table (`device_authorizations`) and **extends** PRD 13's `run_model_outcomes` (two nullable columns) rather than adding a parallel store.
**Depends on / extends:** **[[13-prd-learned-model-routing]]** (this is the IDE consumer of its classifier + routing table + SSM recall), the headless chat core `@seanhogg/builderforce-brain-embedded`, the Brain UI components, the in-process agent loop (`agentLoop()` from `@seanhogg/builderforce-agents`), the sandboxed file tools (`createReadTool`/`createWriteTool`/`createEditTool` + `wrapToolWorkspaceRootGuard`), the knowledge loop + project-init + SSM memory, the OpenAI-compatible gateway, and `AuthService` (`generateApiKey('clu')`, `hashSecret`, JWT). See also [[claude-direct-coding-floor]], [[cloud-agent-model-pinning]], [[ssm-hippocampus-loop]], [[brain-project-context]].

---

## 1. Problem & Goal

BuilderForce has a production agent runtime, a multi-vendor gateway, sandboxed coding tools, a **reusable headless chat core + Brain UI**, a **codebase knowledge loop**, and (per PRD 13) a **learned-routing + per-codebase SSM recall** design — but **no editor-native client**. Developers must leave VS Code to drive an agent against their code, and an editor agent that doesn't *understand the open repo* misfires (edits the wrong file, ignores conventions, picks a weak model for the task).

**Goal:** Ship a first-party **VS Code extension** that:
1. **Reuses the existing chat UI wholesale** — the same `@seanhogg/builderforce-brain-embedded` hooks/streaming/tool-registry **and** the same Brain UI components the web app renders, in a webview. No forked chat. (User ask: *"reuse… all of the components, since it's a webview."*)
2. **Is codebase-aware so it doesn't misfire** — on first open of a folder it runs a **codebase scan + knowledge summary** (the PRD-initialization flow: `.builderforce/` context + architecture summary + seeded SSM memory), then keeps learning via the knowledge loop, and applies **PRD 13's learned routing** so it seeds the empirically-best model for the *kind* of task **biased by what has worked in this specific repo**.
3. **Authenticates via one-click browser login** — device-code (RFC 8628) → scoped gateway key stored in the OS keychain, reused across restarts.
4. **Codes in whatever folder is open** — file tools auto-rooted at the workspace, re-rooted on folder change.

**Non-goals (this PRD):** Visual Studio (C#/VSIX — different platform). JetBrains/other editors (same backend, later client). Re-specifying PRD 13's internals (we **consume** them and add the IDE integration points + local-run outcome inputs). Changing billing/metering. SSO/SAML.

---

## 2. What already exists (build ON this, do NOT duplicate or fork)

**Chat core + UI (reuse 1:1):**
- `@seanhogg/builderforce-brain-embedded` (`brain-embedded/`) — **headless** React chat: `BrainProvider`, `BrainContextProvider`, `BrainActionsProvider`, `useBrainChats`, `useBrainConversation`, `useRegisterBrainActions`, `streamChatCompletion`, `BrainPersistenceAdapter`, `BrainConfig.transport`. **Already designed as a portable npm package with injectable transport + persistence** — exactly the webview seam we need.
- Brain UI components (app-resident today, in `frontend/src/components/`): `BrainPanel.tsx` (full chat container: history sidebar, conversation pane, input, tool-confirm gate, streaming), `ChatMessageBubble.tsx`, `ChatMessageContent.tsx` (react-markdown + code blocks + Apply/Create-file + Mermaid), `ChatInput.tsx`, `ChatMessageActions.tsx`, `PromptInput.tsx`, `MermaidDiagram.tsx`. These render via **CSS custom properties + inline styles (no Tailwind dependency)** → portable to a webview. Their **only** app-specific couplings are `useAuth()`, the theme toggle, and a couple of Next router `Link`s.
- Styles: the token set + Brain styles live in `frontend/src/app/globals.css` (`--bg-*`, `--text-*`, `--accent`, `.bs-*`).

**Agent + files (reuse 1:1):**
- `agentLoop()` / `createAgentSession()` from `@seanhogg/builderforce-agents` — runs **in-process** in the Node extension host (no bundled-CLI subprocess).
- `native-file-tools.ts` — `createReadTool/createWriteTool/createEditTool` (+ `list_files`, `delete_file`), all `wrapToolWorkspaceRootGuard`-ed to one `workspaceDir`.

**Codebase knowledge (reuse + extend):**
- `agent-runtime/src/builderforce/project-init.ts` → `initializeBuilderForceAgentsProject(projectRoot, ctx)` creates `.builderforce/` (context.yaml, architecture.md **template**, rules.yaml, memory/, sessions/, personas/). **The architecture summary is a template today — the auto-fill is the net-new scan step (§6.6).**
- `agent-runtime/src/builderforce/project-knowledge.ts` → `appendKnowledgeMemory(root, entry)` (appends `.builderforce/memory/YYYY-MM-DD.md`).
- `agent-runtime/src/infra/knowledge-loop.ts` → `KnowledgeLoopService.start()` (listens to agent events, records created/edited/tools/summary per run, feeds SSM).
- `agent-runtime/src/infra/ssm-memory-service.ts` → `SsmMemoryService` (`remember/learn/recall/flush`, checkpoint `.builderforce/model.bin`). **Runs in Node** (builderforce-memory + `@webgpu/node` + `fake-indexeddb` per [[ssm-hippocampus-loop]]) — so the extension host IS the SSM client PRD 13 wants.

**Learned routing (consume — see PRD 13):**
- PRD 13's action-type classifier (`classifyTaskAction`), `run_model_outcomes` fact table, `routing:<scope>` KV blob, `rankModelsForAction(reachable, stats, {bias})`, `GET /llm/v1/model-analytics`, and the **client-computed `routingBias`** seam. The VS Code host is the client that computes the bias and seeds the model.

**Gateway + auth (reuse):**
- `POST /llm/v1/chat/completions`, `GET /llm/v1/models`, bearer-key auth; `AuthService` key issuance/validation; existing web OAuth/login.

**What does NOT exist (the net-new work):** (a) the **device-authorization grant** (3 endpoints + 1 table + verify page); (b) **extracting the Brain UI into the shared package** so app + webview share one copy; (c) the **codebase scan→summary auto-fill** step; (d) the **VS Code client** that wires it all together; (e) PRD 13's **local-run outcome inputs** (small extension to its scorer).

---

## 3. The decisions this PRD locks in (defaults chosen; change if needed)

| # | Decision | **Default (recommended)** | Rationale |
|---|---|---|---|
| D1 | **Chat UI surface** | Custom **Webview View** in an Activity Bar container, rendering the **reused `BrainPanel`**. | Brand + diffs + tool-confirm; mirrors Claude Code (custom webview, not native chat). |
| D2 | **Reuse strategy (the DRY ask)** | **Extract the Brain UI into `@seanhogg/builderforce-brain-embedded` (new `/ui` subpath)**; make its 3 app couplings (`useAuth`, theme, router links) **injectable props/context**; **repoint the frontend to import from the package and DELETE the app-resident copies**. App + webview then render the **same** `BrainPanel`. | "Reuse all components" done right = **one source, two hosts**, not a copy-paste fork. Repoint-then-delete satisfies the dead-code rule. The package is already headless-portable; UI is the only missing subpath. |
| D3 | **Where the agent runs** | **In-process** in the extension host via `agentLoop()` against the open folder; LLM calls go to the remote gateway. | We own the runtime as a Node lib; in-process = direct stream, no IPC/subprocess. |
| D4 | **Secrets boundary** | Gateway key lives **only in the extension host** `SecretStorage`; the **webview never holds it**. The webview's `BrainConfig.transport` **proxies LLM calls to the host over `postMessage`**; the host injects the bearer key and streams chunks back. | Webviews are untrusted render surfaces — never put a secret there. brain-embedded's injectable `transport` makes the proxy clean. |
| D5 | **Login flow** | **Device Authorization Grant (RFC 8628)** primary; **`asExternalUri` redirect** refinement when reachable; **polling fallback** for Remote-SSH/Codespaces/web. Result → `context.secrets`. | Works in every VS Code host; reuses existing web login for human approval; one provider, both paths. |
| D6 | **Codebase awareness ("doesn't misfire")** | On first open of a folder (no/stale `.builderforce/`), run a **scan + knowledge summary** = `initializeBuilderForceAgentsProject` + a **net-new auto-fill** that summarizes structure/conventions via one gateway call, writes `architecture.md` + a knowledge digest, and **seeds `SsmMemoryService`**. Attach `KnowledgeLoopService` so every run keeps learning. **Cached**: keyed by a repo version token (git HEAD or a file-tree hash); re-run only on drift or manual "Re-scan". | Grounding the agent in the actual repo before turn 1 is the anti-misfire mechanism; reusing the existing init/knowledge/SSM primitives means almost no new code, and the scan is the literal "PRD initialization" the user asked for. |
| D7 | **Model selection (PRD 13 consumer)** | Per run: classify the prompt's **action type** (PRD 13 classifier), read the **`routing:<scope>` table** (`GET /llm/v1/model-analytics`, cached), compute **SSM `routingBias`** locally in the Node host over this repo's memory, and **seed the model** via `rankModelsForAction(reachablePool, stats, {bias})`. On terminal, write a **local-run outcome** into `run_model_outcomes`. | This is exactly PRD 13's hybrid (server table = authority, client SSM = bias) with the **VS Code host as the client** — so IDE + cloud learning compound in one table. Cold-start/error/offline → the curated default (PRD 13's fallback). |

---

## 4. Architecture (data flow)

```
┌─ VS Code (extension host, Node) ─────────────────────────────────────────────┐
│  Webview View = reused <BrainPanel> (from brain-embedded/ui)                  │
│     │  transport.postMessage('llm.stream')        ▲ stream chunks             │
│     ▼                                              │                          │
│  Host bridge: inject Bearer key (SecretStorage) ──┘                          │
│  AgentRunner: agentLoop({ tools: fileTools(openFolderRoot),                   │
│        model = rankModelsForAction(pool, routingTable, ssmBias),  ◀── D7      │
│        getApiKey: () => secrets.get(KEY) })                                   │
│        │ local file read/write/edit (sandboxed to open folder)               │
│  KnowledgeService: scan+summary on first open → .builderforce/ ; KnowledgeLoop│
│        feeds SsmMemoryService (.builderforce/model.bin) ──┐                   │
│  SsmMemoryService.recall(prompt) → routingBias ──────────┘ (Node GPU/CPU)    │
│  BuilderForceAuthProvider → secrets.store/get/delete (OS keychain)            │
└───────────┬───────────────────────┬──────────────────────┬──────────────────┘
            │ LLM (Bearer)           │ device login (once)   │ routing/analytics + outcome
            ▼                        ▼                       ▼
  /llm/v1/chat/completions   /api/auth/device/*       /llm/v1/model-analytics (read, cached)
  (metered, unchanged)       (NEW §6.1)+verify page   /llm/v1/run-outcome  (write, PRD 13 §6.4)
```

**First-open scan sequence:** open folder → if `.builderforce/` missing/stale (version token mismatch) → `initializeBuilderForceAgentsProject` → scan walk (gitignore-aware) → 1 gateway summary call → write `architecture.md` + digest → `SsmMemoryService.remember/learn` the digest → mark version token. Subsequent opens: cache hit, instant.

**Per-run model seed (D7):** classify action type (cached on the conversation/task) → read `routing:<scope>` (cached) → `SsmMemoryService.recall(prompt)` → `rankModelsForAction(...)` → seed `agentLoop` model. Terminal → score local outcome → `POST /llm/v1/run-outcome`.

Backstops: every learned/scan/auth path **degrades to a working default** — missing scan → agent still runs (just less grounded); cold routing → curated default; webview transport error → clear re-auth/retry state, never a silent hang.

---

## 5. Data model

### 5.1 `device_authorizations` (NEW table, migration NNNN)
One row per pending device login; short-lived, swept after `expires_at`.
```
id              serial pk
device_code_hash varchar(128) not null unique   -- store HASH (hashSecret); plaintext only in the extension
user_code       varchar(16)  not null unique     -- human-clicked code shown in browser
tenant_id       integer  -> tenants (null until approved)
user_id         integer  -> users  (null until approved)
status          varchar(16)  not null default 'pending'  -- pending|approved|denied|expired
issued_key_hash varchar(128)                       -- hash of the minted gateway key (delivered once)
scopes          varchar(256) not null default 'gateway'
interval_secs   integer      not null default 5
expires_at      timestamp    not null              -- now() + ~10 min
created_at      timestamp    not null default now()
approved_at     timestamp
```
Indexes: `(device_code_hash)` unique, `(user_code)` unique, `(expires_at)`. The minted key goes into the **existing** key store (tag `source='vscode'` if a key table exists — do not add a parallel key store).

### 5.2 `run_model_outcomes` — EXTEND PRD 13's table (do NOT add a new one)
PRD 13 keys outcomes on cloud `execution_id`. IDE runs are local with no cloud execution. Add two columns so IDE + cloud learning share one fact table → one routing brain:
```
source         varchar(16) not null default 'cloud'   -- 'cloud' | 'vscode'
client_run_id  varchar(64)                            -- local run id when source='vscode'
-- make execution_id NULLABLE (was NOT NULL); uniqueness becomes COALESCE(execution_id, client_run_id)
```
Everything else (action_type, resolved_model, score, terms, KV-blob update) is PRD 13's — the IDE just supplies a different **input set** to the scorer (§6.7).

### 5.3 On-disk per-repo state (NOT a DB table)
The scan/knowledge/SSM artifacts live in the user's repo under `.builderforce/` (context.yaml, architecture.md, memory/YYYY-MM-DD.md, model.bin, sessions/). This is the existing knowledge-loop layout — reused, not re-invented. A `.builderforce/scan.json` holds the **version token** (git HEAD or file-tree hash) used to cache the scan.

---

## 6. Components to build (in dependency order)

### 6.1 Backend — device-authorization grant (only gateway-side change)
As PRD 14-prior §6.1: `POST /api/auth/device/code`, a **verify page** at `verification_uri` (reuses existing web login; Approve/Deny; on approve mints `generateApiKey('clu')` bound to `(user, tenant)`), `POST /api/auth/device/token` (`428 authorization_pending` / `429 slow_down` / `410 expired_token` / `403 access_denied` / `200 {access_key}` once, then invalidate). Store `device_code` by **hash**; rate-limit per IP; sweep expired rows. The minted key flows through the **existing** bearer validation — **no gateway-auth change**. (Cache exception: write-mostly, unique-keyed auth ops are not read-cached; the token poll is one indexed lookup.)

### 6.2 Shared UI extraction — `@seanhogg/builderforce-brain-embedded` gains a `/ui` subpath (the DRY core)
- **Move** `BrainPanel`, `ChatMessageBubble`, `ChatMessageContent`, `ChatInput`, `ChatMessageActions`, `PromptInput`, `MermaidDiagram` (+ their styles, extracted from `globals.css` into a shippable `brain-ui.css`) from `frontend/src/components/` into `brain-embedded/src/ui/`.
- **De-couple the 3 app dependencies** behind injection: `useAuth()` → a `useBrainIdentity()` hook backed by an injectable `identity` prop on `BrainProvider` (web app supplies its AuthContext; webview supplies host tenant); theme → a `theme` prop / inherit `data-theme`; Next `Link` → an injectable `LinkComponent` (defaults to `<a>`). **Single source for "am I signed in / which tenant" — no `canChat`/`hasTenant` boolean prop-drilled (DRY).**
- **Repoint the frontend** to import these from the package, then **DELETE the app-resident copies** (verify zero remaining references across frontend first — dead-code rule).
- Result: the web app and the webview render the **same** components from the **same** package. Net new UI code for the extension = ~0.

### 6.3 Backend device endpoints' client + extension scaffold — `clients/vscode/`
`package.json` contributes: `viewsContainers.activitybar` (`builderforce`), `views` (`builderforce.chat` webview view), commands (`signIn`/`signOut`/`newChat`/`pickModel`/`rescanCodebase`/`openSettings`), `configuration` (`builderforce.baseUrl` default `https://api.builderforce.ai`, `defaultModel`, `permissionMode`, `learnedRouting` on/off, `autoScanOnOpen` on/off), `authentication` (`builderforce` provider id), activation events.

### 6.4 Auth provider — `clients/vscode/src/auth/BuilderForceAuthProvider.ts`
Implements `vscode.AuthenticationProvider` (id `builderforce`); `createSession()` runs §6.1's device flow (`openExternal` → poll honoring `interval`/`slow_down`, progress + cancel) → `secrets.store`; `asExternalUri` redirect when reachable, polling fallback on remote/web (`vscode.env.remoteName`/`uiKind`); `getSessions`/`removeSession` read/clear secrets + fire `onDidChangeSessions`. Rest of the extension calls `vscode.authentication.getSession('builderforce', ['gateway'], { createIfNone: true })`.

### 6.5 Webview host + transport bridge — `clients/vscode/src/panel/ChatViewProvider.ts`
- `registerWebviewViewProvider('builderforce.chat')`; CSP locked to extension origin + gateway; `localResourceRoots` to the built webview bundle.
- The webview bundle mounts `<BrainProvider transport={hostTransport} persistence={vscodePersistence} identity={hostIdentity}> <BrainActionsProvider> <BrainContextProvider> <BrainPanel variant="docked" extraSystem={openFileContext}/> …`.
- **`hostTransport`** = the D4 proxy: webview `postMessage('llm.stream', body)` → host injects Bearer key + calls `/llm/v1/chat/completions` (streaming) → relays chunks back; the webview transport yields them to `streamChatCompletion`. **Key never enters the webview.**
- **`vscodePersistence`** = `BrainPersistenceAdapter` backed by VS Code `workspaceState`/`globalState` (chats per workspace) or `.builderforce/sessions/`.
- **`hostIdentity`** = tenant/user from the auth session (the injected `identity` from 6.2).
- **`extraSystem`** = current open-file path + selection (per [[brain-project-context]] ambient-context pattern) so the chat is grounded in what the user is looking at.

### 6.6 Codebase scan + knowledge summary — `agent-runtime/src/builderforce/scan-codebase.ts` (net-new, reusable by CLI too)
- `scanCodebaseAndSummarize(env, root, { force? }): Promise<{ summary, versionToken }>`:
  1. Compute version token (git HEAD if a repo, else a hash of the file tree). If `.builderforce/scan.json` token matches and not `force` → **cache hit, return** (this is the read-through cache for an expensive op — gitignore-aware walk + an LLM call).
  2. `initializeBuilderForceAgentsProject(root)` if `.builderforce/` absent.
  3. Walk the repo (gitignore-aware, bounded: cap files/bytes, skip vendored/build dirs — **no unbounded scan**), collect a structure digest (languages, frameworks, entry points, test/build/lint config, key modules).
  4. One gateway call (free pool, `useCase:'codebase_summary'`) → fill `architecture.md` (was a template) + a concise knowledge digest.
  5. `SsmMemoryService.remember/learn` the digest so `recall` works from turn 1; write `scan.json` token.
- Attach `KnowledgeLoopService.start()` to the in-process agent so every run appends `.builderforce/memory/*` + updates `model.bin`. **This is the "doesn't misfire" grounding + the PRD-initialization the user asked for.**

### 6.7 Learned-routing client (PRD 13 consumer) — `clients/vscode/src/agent/routeModel.ts`
- `classifyAction(prompt)` → PRD 13 classifier (cached on the conversation; free pool; `other` on failure).
- `getRoutingTable(scope)` → `GET /llm/v1/model-analytics?scope=…` via the host (cached in-extension, short TTL + manual refresh — small, slow-changing; **not refetched per keystroke**).
- `ssmBias(prompt)` → `SsmMemoryService.recall(prompt)` in the Node host → `routingBias: { model: weight }`.
- `seedModel = rankModelsForAction(reachablePoolFromGetModels, table.byAction[action], { minSamples, bias })[0]` (PRD 13 pure fn — reused, **not re-implemented**); falls back to `defaultModel` on cold-start/error/`learnedRouting` off.
- On terminal: `scoreLocalRun()` → composite from **IDE-available signals** (edits accepted vs rejected, local test/build exit if run, no tool-degradation, efficiency) → `POST /llm/v1/run-outcome` with `source:'vscode'`, `client_run_id`, `action_type`, `resolved_model`. **Extends PRD 13 §6.4's scorer with the local input set; same fact table + KV-blob update.**

### 6.8 Agent runner — `clients/vscode/src/agent/AgentRunner.ts`
Resolves the open-folder root (re-roots on `onDidChangeWorkspaceFolders`), builds the sandboxed file tools at that root, runs `agentLoop` with the §6.7 seeded model + `getApiKey` from secrets, streams `AgentEvent`s to the webview, wires `AbortSignal` to Stop and the steering/follow-up hooks to mid-run interjection, and applies edits via `workspace.applyEdit` with the `permissionMode` gate.

### 6.9 Tool registry bridge
Register IDE-native tools the chat can call via `useRegisterBrainActions` (reused): `apply_code_to_active_file`, `create_file`, `open_diff`, `run_terminal` (gated), `read_selection`. These map the existing `onApplyCode`/`onCreateFile` props already on `ChatMessageContent` to real editor mutations — **the UI hooks already exist**, we just supply handlers.

---

## 7. Phasing (each phase ships working, end-to-end)

- **Phase 1 — Shared UI extraction + auth + shell.** 6.2 (extract Brain UI to the package, repoint frontend, delete copies — web app must still render identically), 6.1 device endpoints + verify page + migration, 6.3 scaffold, 6.4 auth provider (polling). **Acceptance:** web app chat unchanged after the extract (same components, no regressions); fresh extension install → Sign in → browser approve → key in keychain → survives restart; remote-SSH completes via polling.
- **Phase 2 — Chat + agent against the open folder.** 6.5 webview mounting the reused `BrainPanel` via the host transport, 6.8 runner, 6.9 tool bridge. **Acceptance:** a prompt streams in the reused UI; the agent reads/edits **only** within the open folder; edits apply via approve/deny; folder switch re-roots; Stop cancels; model picker reflects `GET /llm/v1/models`; **the rendered chat is pixel-identical to the web app's BrainPanel.**
- **Phase 3 — Codebase awareness (scan + knowledge) so it doesn't misfire.** 6.6 scan→summary + knowledge loop + SSM seeding; `Re-scan codebase` command; first-open auto-scan (cached by version token). **Acceptance:** opening a fresh repo produces `.builderforce/` with a filled `architecture.md` + digest in one scan; re-open is a cache hit (no re-scan, no LLM call); the agent's answers reference real repo structure (grounded); a `Re-scan` busts the cache.
- **Phase 4 — Learned routing (PRD 13 consumer).** 6.7 classify + routing table read + local SSM bias + seed + local-outcome write; 5.2 column extension. **Acceptance:** a `sql`-classified prompt in a repo with prior SQL wins seeds the empirically-best reachable model (table + local SSM bias); cold-start/`learnedRouting` off/offline → curated default; every IDE run writes one `run_model_outcomes` row (`source='vscode'`) that feeds the same routing brain as cloud runs; `model.select`-style reasoning shown in the chat.

---

## 8. Performance & safety requirements (non-negotiable)

- **Secrets**: gateway key ONLY in `context.secrets`; **never in the webview**, settings, workspace state, or logs; delivered once by `/device/token`. Webview LLM calls proxy through the host (D4).
- **Sandbox**: file tools stay `wrapToolWorkspaceRootGuard`-ed to the open folder; re-root on change; no path escapes.
- **No new gateway-auth path**: minted key uses existing bearer-hash validation — can't bypass metering/tenancy.
- **Codebase scan = cached + bounded**: read-through cache keyed by repo version token (git HEAD / tree hash); **bounded walk** (file/byte caps, gitignore-aware, skip build/vendor) — no unbounded scan, one LLM call per scan, re-run only on drift or manual re-scan.
- **Routing decision = O(1), DB-free on read**: routing table via `GET /llm/v1/model-analytics` is PRD 13's cached KV blob; the extension caches it in-memory short-TTL; SSM bias is local Node compute (no server CPU/DB). Cold-start/error/offline → curated default.
- **DRY (the headline)**: the Brain chat UI exists in **exactly one package** consumed by app + webview; `rankModelsForAction`, the action enum, the score formula, the base-URL/key source, the postMessage protocol enum, and the auth-state source each live in exactly one module. **No forked chat, no copied components.**
- **Dead-code**: after repointing the frontend to the package, the app-resident chat components are deleted (zero references verified).
- **Best-effort, never-hang**: scan/classify/route/SSM/auth failures degrade to a working default with a clear UI state; no silent spinner.

### Consolidated Gap Register — entries logged this pass
- **Local-run outcome scoring inputs (PRD 13 extension)** — `run_model_outcomes` was cloud-`execution_id`-keyed; IDE runs need `source`/`client_run_id` + nullable `execution_id` and an IDE-signal scorer (edits accepted, local test/build). Unblocks unified IDE+cloud learned routing. *(Specced §5.2/§6.7; flag to PRD 13 owner so the migration lands together.)*
- **Architecture-summary auto-fill** — `initializeBuilderForceAgentsProject` writes `architecture.md` as a **template only**; no code reads the repo and fills it. `scanCodebaseAndSummarize` (§6.6) closes this; unblocks grounded, low-misfire IDE answers. *(Net-new in this PRD; also benefits CLI/cloud init.)*
- **Brain UI not in a shared package** — chat components are app-resident in `frontend/src/components/`, so any second host must fork them. Extracting to `brain-embedded/ui` (§6.2) unblocks the webview (and future JetBrains/desktop) with zero fork.
- **`run-outcome` write endpoint** — PRD 13 writes outcomes server-side from cloud terminals; an external client (IDE) needs `POST /llm/v1/run-outcome` (tenant-scoped, idempotent on `client_run_id`). Unblocks IDE contributions to the routing brain. *(Build with PRD 13 §6.4 or here.)*
- **Key revoke endpoint** — `removeSession` clears the local key but no server-side `POST /api/auth/keys/revoke` invalidates it gateway-side. Unblocks true sign-out/rotation.

---

## 9. Testing

- `deviceAuth.test.ts` (api) — pending→approved→one-time key; slow_down/expired/denied; minted key validates through existing gateway auth.
- `brain-ui` package smoke — `BrainPanel` renders headless with injected `identity`/`theme`/`LinkComponent`; **frontend visual/regression unchanged after the extract** (the web app's existing Brain tests still green).
- `BuilderForceAuthProvider.test.ts` — device flow success stores secret + fires change; cancel aborts; remote forces polling; redirect host uses URI handler.
- `transportBridge.test.ts` — webview→host LLM proxy injects key, streams chunks, never exposes the key to the webview payload.
- `scanCodebase.test.ts` — first scan fills `architecture.md` + digest + seeds SSM + writes token; second call = cache hit (no walk, no LLM); `force`/HEAD-change busts; walk respects gitignore + caps.
- `routeModel.test.ts` — classify→table→bias→seed picks best reachable; cold-start/off/offline → default; local outcome posts `source:'vscode'`, idempotent on `client_run_id`. Reuses PRD 13's `rankModelsForAction.test.ts`.
- `AgentRunner.test.ts` — tools rooted at folder; folder-change re-roots; edit outside root rejected; Stop aborts; missing key → sign-in.

---

## 10. Open risks / explicitly deferred (logged to the Gap Register above)

- **Visual Studio (C#/VSIX)** and **JetBrains** parity out of scope — same backend (device auth + gateway + scan + routing), separate clients.
- **SSM in remote/web VS Code** — `SsmMemoryService` assumes a Node host with `@webgpu/node`; in browser VS Code (`uiKind=Web`) the SSM bias is skipped (routing falls back to table-only, per PRD 13's headless behavior). Validate or gate to desktop+remote first.
- **Multi-root workspaces** — v1 picks folder `[0]` with a switch quick-pick; per-folder concurrent agents are later.
- **Diff/edit conflicts** — apply via `workspace.applyEdit` with version checks; surface conflicts, never blind-overwrite.
- **Multi-tenant selection at approve time** — v1 uses the user's active tenant; in-browser chooser is a fast-follow.
- **Marketplace publish/sign + `vscode://` scheme registration** — release-time, not in build phases.

---

## 11. Definition of done (whole feature)

A developer installs the BuilderForce extension, clicks **Sign in**, approves once in the browser, and stays authenticated across restarts (key in the OS keychain, never in the webview). The sidebar shows the **exact same BrainPanel chat the web app renders** — because both import it from one shared package, with the app-resident copies deleted. Opening any folder makes it the agent's sandbox and triggers a **one-time, cached codebase scan** that fills `.builderforce/` with an architecture summary and seeds per-repo SSM memory, so the agent is grounded and **doesn't misfire**; every run keeps the knowledge loop and SSM current. Each prompt is **classified, routed via PRD 13's learned table and biased by this repo's SSM recall**, seeding the empirically-best reachable model, and its outcome is written back into the **same `run_model_outcomes` brain** as cloud runs (`source='vscode'`). The only server change is the device-authorization grant; the gateway, agent loop, file tools, metering, and learned-routing internals are otherwise unchanged, and every scan/route/auth/transport failure degrades to a clear, working default.
