# Platform duplication audit

Part of the [unified platform review](unified-platform-gap-review.md). Areas are audited one at a time, and each one ends in a single target design plus granular gaps (`MCP-G###`, …) in [GAP-REGISTER.md](../../roadmap/GAP-REGISTER.md).

Synapse is being rebuilt from the ground up (user, 2026-11-26), so its Rust MCP code is judged only on whether a shared component should replace it.

| # | Area | Status |
|---|---|---|
| 1 | MCP | **audited 2026-11-26** (below) |
| 2 | Code index / search / context | **audited 2026-11-26** (below) |
| 3 | Local inference + model catalog + routing | **audited 2026-11-26** (below) |
| 4 | Memory (Evermind), skills, episodes, runs | **audited 2026-11-26** (below) |
| 5 | Chat composer / view | audited (§5) |
| 6 | Shell / terminal, file tools | audited (§6) |
| 7 | Auth / device sign-in / cloud client | audited (§7) |
| 8 | Security policy (code-shield vs Shield) | audited (§8) |

---

## 1. MCP

### 1.1 Inventory: 11 implementations across 3 repos

| # | Implementation | Repo · path | Role | Transport | Library | Protocol | Tools |
|---|---|---|---|---|---|---|---|
| A | Platform MCP server | Builderforce.ai `api/src/presentation/routes/mcpServerRoutes.ts` (mounted `api/src/index.ts:1043`) | server | Streamable HTTP, stateless, POST-only, batches | hand-rolled | negotiates 2025-06-18 / 2025-03-26 / 2024-11-05 | ~360+ (gateway catalog, `?surface=`) |
| B | Gateway catalog + dispatcher | `api/src/application/llm/mcpGateway.ts`, `builtinMcpService.ts` (4609 lines, ~378 tools), `connectors/connectorTools.ts`, `mcpExtensionService.ts`, `toolSurfaces.ts` | catalog + gateway | in-process + REST `/llm/v1/mcp/{tools,surfaces,call}` | custom | — | built-in + connectors + tenant MCP |
| C | Outbound MCP client | `api/src/application/llm/mcp/mcpWireClient.ts` (+ `mcpOAuth*.ts`, `mcpExtensionAuth.ts`, `mcpToolConsent.ts`) | client | Streamable HTTP (JSON or SSE body) + legacy REST fallback | hand-rolled | 2025-06-18 | forwards tenant servers |
| D | Marketplace review probe | `api/src/application/developer/dynamicReview.ts:349-430` | client (probe) | HTTP, no `initialize` | hand-rolled (3rd framing) | none sent | `tools/list` only |
| E | agent-runtime local MCP | `agent-runtime/src/gateway/mcp-server-http.ts` (via `server-http.ts:500`, port 18789) | server | HTTP `GET/POST /mcp` + legacy `/mcp/call` | hand-rolled | 2024-11-05 only | 9 |
| F | REST relay consumers | `brain-embedded/src/mcpCatalog.ts` (web via `McpExtensionsBridge.tsx`, VS Code `platform/platformTools.ts`, Chrome `tools/platformTools.ts`); copies in `frontend/src/lib/builtinTools.ts`, `agent-runtime/.../connector-tools.ts`, `platform-ticket-tools.ts`, mobile `PlatformTools` | client (REST) | HTTPS | custom | — | platform catalog |
| G | User-server registration UI | VS Code `src/tools/mcpServers.ts`, `bfApi/mcpExtensions.ts`; web `components/mcp/*`, `lib/mcpExtensionsApi.ts` | host UI (→ API CRUD) | — | — | — | — |
| H | Synapse `McpClient` | builderforce-inference `crates/bf-mcp/src/client.rs` | client | stdio NDJSON | hand-rolled Rust | 2025-06-18 | forwards |
| I | Synapse connector `Host` | `crates/bf-mcp/src/{host,catalog,spec}.rs`, Tauri `app/src-tauri/src/connectors.rs` | host (stdio user servers, 7 one-click) | stdio | hand-rolled Rust | 2025-06-18 | `mcp_<conn>_<tool>` |
| J | Synapse context server | `crates/bf-context/src/mcp.rs` (`synapse mcp`, `bf-context mcp`) + loopback HTTP `server.rs` | server | stdio (+ loopback HTTP API) | hand-rolled Rust | 2025-06-18 (echoes the client) | 5 |
| K | Memory MCP | builderforce-memory `packages/memory-mcp` (`@seanhogg/builderforce-memory-mcp` 2026.10.85) | server ×3 transports | stdio, Streamable HTTP (stateless), in-process Agent SDK | **official `@modelcontextprotocol/sdk ^1.12`** | SDK-negotiated | 9 memory/cost + 20 experience |

These are not MCP but look like it, and should be renamed or documented:
- `api/src/application/workflow/mcpNode.ts` and `agent-runtime/src/builderforce/orchestrator.ts:797-866` are data-provider calls.
- The webcontainers `ENV_TOOL_KEYS`/`runtime.agents.*` are an in-process tool catalog.
- `agent-runtime/src/acp/*` is the Agent Client Protocol; it sends `mcpServers: []`.

Facts that shape the design:
- **Only K uses the official SDK.** Builderforce.ai only *pins* it (pnpm override `^1.32.0` in `agent-runtime/package.json:246` and `clients/vscode/package.json:1414`).
- No code anywhere **reads** a host `mcp.json`.
- **Every server is tools-only.** None offers resources, prompts, sampling or `list_changed`.
- No MCP path applies `tool-output-policy` or `secret-redaction`.

### 1.2 Duplicate-responsibility matrix

| Responsibility | Copies | Where |
|---|---|---|
| JSON-RPC framing / envelopes / error codes | **6** | A `mcpServerRoutes.ts:53-90`; E `mcp-server-http.ts:127-262` (own codes −32001/−32002); C `mcpWireClient.ts:150-175`; D `dynamicReview.ts:~387-405`; H `client.rs`; J `mcp.rs` |
| SSE-body result parsing | 2 | C `readJsonRpcBody`; D (own "first `data:` line") |
| Protocol-version constant / negotiation | 5 | A (3 versions), C, E (2024-11-05), H, J (hard-coded 2025-06-18); K is SDK |
| Tool registry / catalog | **6** | B `CATALOG`; E `MCP_TOOLS`; J `tool_list` (JSON literals); K `buildMemoryTools` (zod); `creation-canvas-contract/canvasTools.ts`; webcontainers `ENV_TOOL_KEYS` |
| `McpToolEntry` type | 3 "mirrors" | `mcpExtensionService.ts`, `brain-embedded/src/mcpCatalog.ts:25`, `clients/vscode/src/platform/platformTools.ts:~21` |
| Tool → LLM function shape | 4 | `brain-embedded/src/toolSpecs.ts:18`; `builtinMcpService.ts:4458`; Synapse `brain_tools.rs`; `bf-cloud PlatformTool::as_function` |
| Tool → MCP `inputSchema` | 3 | A `tools/list`; E `:~84` (TypeBox `$schema` strip); J literals |
| Advertised-name scheme | **4** | `builtin_<id>` (`agent-tools/src/toolNaming.ts:~28` + `api/.../toolNaming.ts`); `mcp_<8hex>_<tool>` (`mcpExtensionService.ts:~201`, a second `advertisedName` with another signature); `mcp_<conn>_<tool>` 64-char (Synapse `flat_name`); `mcp__server__tool` (`toolNaming.ts:20`, `agent-stall/src/index.ts:96`; no producer) |
| Write/read-only decision | **4** | `mutates` (B; absent = write); `readOnlyHint` (H/I); webcontainers `mutates` map; A maps `readOnlyHint = mutates===false` |
| Per-tool approval/consent | **5** | `mcpToolConsent.ts` (server); `mcpCatalog.ts` `mutates !== false`; VS Code `toolMutating`/`platformCallGate`; Chrome `safety.ts`; Synapse Approve (`Tool::writes()`) |
| REST relay client for `/llm/v1/mcp/call` | **6** | `brain-embedded/mcpCatalog.ts`; `frontend/src/lib/builtinTools.ts:22,33`; `agent-runtime/.../connector-tools.ts:70,161`; `platform-ticket-tools.ts`; `bf-cloud/src/tools.rs`; mobile `PlatformTools` |
| Catalog TTL cache | 3 | VS Code 60s `ttlCache`; Chrome 60s; API external 60s (`mcpExtensionService.ts:~159`) |
| Bearer extraction (server) | 3 | A `requireTenantAccess`; E `getBearerToken`; K HTTP auth (sha256, timing-safe) |
| Outbound auth header build | 5 | `mcpWireClient headersFor`; `mcpCatalog.ts:~96,~138`; `platform-ticket-tools.ts:~38`; `connector-tools.ts`; `builtinTools.ts` |
| User-server config store | 2, disjoint | API DB `tenant_mcp_extensions` (`identity.ts:294`, remote https only) vs Synapse `connectors.json` (local stdio) |
| Server-URL validation | 3 | `assertSafeServerUrl` (API); VS Code `mcpServers.ts` regex; `McpServerForm.tsx` |
| stdio spawn/supervise | 1 (Rust) | H only. TS has none (K is a server). |
| Launch spec (npx args for memory-mcp) | 3 by hand | `bf-memory/launch.rs RUNTIME_PEERS`; `memory-mcp/src/install/server-spec.ts`; `plugins/builderforce-memory/.claude-plugin/plugin.json` |
| Windows `.cmd` shim / command-line split | 2 | Rust `LaunchSpec`/`split_command_line`; TS `buildServerSpec` |
| Host `mcp.json` writer | 2 | K installer (8 hosts, write-only); Synapse `connect_info` (writes the `mcpServers` JSON) |

### 1.3 Tool-level overlaps

| Concept | Names in use | Where |
|---|---|---|
| Code search | `codebase_semantic_search`, `codebase_search` (E) · `semantic_search`, `repo_map` (J) · `search_code` (`agent-tools/core-tools.ts:106`) · `builtin_knowledge_search` (B) | 4 implementations of "find code" |
| Memory | `memory_recall/remember/forget` (`core-tools.ts:347-415`) · `memory_search/get` (`agent-runtime/agents/tools/memory-tool.ts:42,72`) · `memory_recall/get/recall_by_tag/remember/forget/compact/restore` (K) | 3 vocabularies; K is canonical |
| Tickets / reviews / security | `tickets_from_delta`, `reviews_record`, `security_record` (E) = `builtin_tickets_from_delta`, `builtin_reviews_record`, `builtin_security_record_finding` (B) | same function, two names |
| Runs / workflows | `workflow_status`, `agent_fleet` (E) · `executions.*`, `workflows.runs` (B) · `run_start/step/finish/list/get` (K) | 3 meanings of "run" |
| Project knowledge | `project_knowledge` (E) · `projects.*` (B) | |
| Files / exec | `read_file`, `write_file`, `run_command` (`core-tools.ts`) · `env.fs.*`, `env.run` (webcontainers) · `filesystem` connector (I) · VS Code local tools | 4 |
| Compression | `compress_context` (J, LLMLingua-2) · `memory_compact` (K, lossless) | similar name, different goal; keep both, but rename J |
| Fact checking | `check_references` (J) · `memory_compact` recall probe (K) | no shared code |
| Third-party tools | GitHub/Slack via the tenant connector (B) and via the local connector (I) | possible double-advertising (unverified) |

### 1.4 Inconsistencies

- **Protocol:** E speaks only 2024-11-05.
  - E returns tools *inside* `initialize`, which is non-standard.
  - E has no `ping`, no notifications, no batch and no annotations.
- **Errors:**
  - Auth failure: A sends −32600 with 401; E sends −32001 with 401.
  - Unknown tool on E: −32601 with HTTP 200 on `/mcp`, but 404 on `/mcp/call`.
  - The REST relay returns `{error}` with 4xx/502; K returns `{error:"unauthorized"}`; `bf-cloud` returns `Status{502}`; webcontainers returns typed `code`.
- **Timeouts:**
  - outbound 20s (C);
  - relay 30s (E);
  - stdio call 30s, hosted 120s, start 180s (H/I);
  - platform 120s (`bf-cloud`);
  - browser relays have none.
- **Sessions:** C re-runs `initialize` before every `tools/list` and every `tools/call`, which doubles the round trips.
- **Arguments:** E accepts `arguments | args` and `tool`; A accepts `arguments` only.
- **Wrong placeholder:** VS Code's URL placeholder is `…/sse`, but C only speaks Streamable HTTP.
- **Stale version:** K's default `serverInfo.version` is `2026.5.31`, while the package is `2026.10.85`.
- **Loopback:** not verified whether K's HTTP bin binds to loopback.

### 1.5 Target design: one MCP stack

**Principle:** use the official SDK under every TypeScript MCP surface, keep one tool vocabulary, and make one package own the protocol. Synapse's Rust MCP is not ported; the rebuilt Synapse hosts the VSIX, and the VSIX is TypeScript.

**New package `@seanhogg/builderforce-mcp`.** It is source-and-published, depends on `@modelcontextprotocol/sdk`, and is runtime-neutral (Workers, Node, browser).

| Module | Replaces |
|---|---|
| `protocol`: version negotiation, error codes, `isError` result helpers (re-exported SDK types) | the 6 framings and 5 version constants |
| `tool`: ONE `McpToolEntry` (`name`, `title`, `description`, `inputSchema`, `effect: 'read' \| 'write' \| 'external'`, `surface[]`) plus `toMcp()`, `toOpenAI()`, `toAnthropic()` and `fromMcp()` (maps `readOnlyHint` ⇄ `effect`) | 3 type mirrors, 4 LLM shapers, 3 inputSchema shapers, 4 write/read rules |
| `naming`: ONE advertised-name codec, `<source>__<tool>` (MCP-client convention, ≤64 chars, reversible), with `resolve(name) → {source, tool}` | 4 naming schemes |
| `policy`: a `ToolGate` port (consent list, approval-for-write, role filter hook) plus output policy applied centrally (`tool-output-policy`, `secret-redaction`) | 5 consent/approval copies; adds the missing redaction |
| `server`: `createMcpServer(catalog, {auth, transport})`, using the SDK's Streamable-HTTP transport (Workers fetch adapter) and stdio | A, E |
| `client`: a session-reusing Streamable-HTTP/SSE client (one `initialize` per session, cursor pagination, timeout, typed `AuthChallenge`) plus a stdio client with supervise and restart (Node only) | C, D, H |
| `relay`: ONE typed client for the platform REST face (`/llm/v1/mcp/*`) with the TTL cache | 6 relay copies, 3 TTL caches |
| `config`: read **and** write host configs (Claude Code, Claude Desktop, Cursor, VS Code `mcp.json`, Windsurf, Cline, Gemini, Codex TOML), plus ONE `LaunchSpec` (npx args, Windows `.cmd`) | K installer (moves here), Synapse `connect_info`, the 3 hand-copied npx specs |

**Servers after consolidation:** three servers, one per bounded context, all built with `createMcpServer`.

1. **Platform MCP** (A on B): remote, tenant-scoped, the canonical catalog for everything that lives in the platform.
2. **Memory MCP** (K): canonical memory and experience. Stdio, HTTP and in-process transports stay, now on the shared package.
3. **Workspace MCP**, one local server for a machine's code.
   - It exposes the code index, search, repo map, git history, references and context compression.
   - It replaces E's local tools and J.
   - Its host is the VS Code extension (and therefore the rebuilt Synapse IDE) plus `agent-runtime` headless, sharing one implementation. Which index engine sits behind it is the next audit (area 2).

**User-connected servers: one model, two transports.**
- Remote servers (https) stay tenant records in `tenant_mcp_extensions`, called through `client`.
- Local stdio servers become entries in the host's own `mcp.json`, read through `config`.
  - In VS Code and the Synapse IDE they also surface through VS Code's built-in MCP support.
  - Synapse's `connectors.json` and its 7-entry one-click catalog fold into one catalog: the API connector catalog, with a `transport: 'stdio' | 'http'` column.
- One gate (`policy.ToolGate`) applies to both kinds.

**Vocabulary:**
- Platform tools keep their dotted catalog ids (`tasks.create`). They are advertised as `platform__tasks_create`.
- Memory tools are `memory__recall`; workspace tools are `workspace__search`; tenant or local servers are `<server>__<tool>`.
- E's duplicate snake names (`tickets_from_delta`, …) are deleted; E calls the platform tool by its id.
- In-process catalogs (canvas `canvas_*`, webcontainers `env.*`) are not MCP servers. They register as `McpToolEntry` sources in the same catalog type so that names, effect and gating are shared.

### 1.6 Migration order

**Implementation status (2026-11-26).** Platform and Workspace run on `@seanhogg/builderforce-mcp`. Synapse’s Rust Workspace MCP and connector host are retired. Its private Evermind client uses the official Rust MCP SDK with launch data generated from Memory’s installer. VS Code uses the shared connector catalog and reads host configs, and the headless runtime routes both legacy code searches through the shared Workspace index. Native Platform relay clients request canonical tool names and accept saved legacy aliases. npm serves `0.1.1` with compiled exports. Memory MCP `2026.10.86` pins the published package in its frozen lockfile. All 76 Memory MCP tests passed, and the version is available on npm and the MCP Registry. See the [MCP gap register](../../roadmap/GAP-REGISTER.md#mcp-consolidation-platform-agents) and the [npm package](https://www.npmjs.com/package/@seanhogg/builderforce-mcp/v/0.1.1).

Normal web, VS Code, and Chrome Brain runs and direct Creation Canvas runs send canonical names for first-party remote Platform tools at the model boundary. The same catalog maps calls back to stable names before scheduling, review, approval, and dispatch. Editor fact tools use the shared Memory capability and canonical provider names while retaining their existing policy IDs. The compatibility REST catalog keeps legacy names for consumers outside these paths.

Each step is a separate PR, and existing tests run unchanged as the parity oracle.

1. **Create `@seanhogg/builderforce-mcp`** with `protocol`, `tool`, `naming` and `policy`. Move `McpToolEntry` and `toolNaming.ts` in, and re-point the 3 mirrors and 4 shapers. (MCP-G001–G006)
2. **Move K onto the package.** Move `install/` to `config`, fix the stale version and verify the HTTP loopback bind. (MCP-G007–G009)
3. **Rebase A on `server`.** Rewrite E as a `createMcpServer` instance (fixing its protocol, ping, errors and annotations) and delete E's duplicate tools. (MCP-G010–G013)
4. **Replace C and D with `client`.** This reuses sessions and gives one SSE parser. Fix the VS Code `/sse` placeholder. (MCP-G014–G016)
5. **Replace the 6 relay copies with `relay`.** (MCP-G017)
6. **Unify the user-server model.** Add the `transport` column to the connector catalog, read `mcp.json` through `config`, and apply one `ToolGate` everywhere. (MCP-G018–G020)
7. **Merge the four code-search tools** into Workspace MCP behind one interface; the engine choice comes from area 2. (MCP-G021)
8. **Retire Synapse's Rust Workspace MCP and connector host.** The user approved removing both ahead of the rebuilt Synapse release on 2026-11-26. The VS Code extension provides Workspace MCP, and the loopback context service remains available for hybrid search and compression. Synapse's desktop features still use the private Evermind client in `bf-memory`. Workflow execution uses data-provider handlers and accepts saved `mcp` nodes. (MCP-G022–G024)

The benchmark in §2.5 gates retirement of the native index, which still backs optional Workspace capabilities.

### 1.7 Granular gaps

| ID | Gap | Fix | Where |
|---|---|---|---|
| MCP-G001 | 6 hand-rolled JSON-RPC framings; only memory-mcp uses the official SDK | `protocol` module on the SDK | A, C, D, E, H, J |
| MCP-G002 | 5 protocol-version constants; E is stuck on 2024-11-05 | negotiate in one place | A, C, E, H, J |
| MCP-G003 | `McpToolEntry` mirrored 3× | one type in `tool` | `mcpExtensionService.ts`, `mcpCatalog.ts:25`, `platformTools.ts:~21` |
| MCP-G004 | 4 tool→LLM-function shapers; no Anthropic shaper | `toOpenAI`/`toAnthropic` | `toolSpecs.ts:18`, `builtinMcpService.ts:4458`, Synapse ×2 |
| MCP-G005 | 4 advertised-name schemes; `mcp__server__tool` is parsed but never produced; two different `advertisedName` functions | one codec | `toolNaming.ts` ×2, `mcpExtensionService.ts:~201`, `agent-stall:96`, `flat_name` |
| MCP-G006 | 4 encodings of read/write (`mutates`, `readOnlyHint`, webcontainers map) and 5 approval gates | `effect` + `ToolGate` | B, H/I, webcontainers, `mcpToolConsent`, `mcpCatalog`, VS Code, Chrome `safety.ts` |
| MCP-G007 | No MCP path applies `tool-output-policy` / `secret-redaction`; the gateway and E return untruncated, unredacted results | central output policy | A, B, E |
| MCP-G008 | memory-mcp default `serverInfo.version` is stale (2026.5.31 vs 2026.10.85) | read from package.json | `memory-mcp/src/transports/{mcp-server,sdk}.ts` |
| MCP-G009 | memory-mcp HTTP bin loopback binding unverified | bind 127.0.0.1 by default | `memory-mcp/src/bin/http.ts` |
| MCP-G010 | E is non-standard: tools inside `initialize`, no ping/notifications/batch/annotations, its own error codes | rebuild on `server` | `agent-runtime/src/gateway/mcp-server-http.ts` |
| MCP-G011 | E duplicates platform tools under snake names (`tickets_from_delta`, `reviews_record`, `security_record`) | call the platform ids, delete the copies | `mcp-server-http.ts:63`, `platform-ticket-tools.ts` |
| MCP-G012 | E accepts `args` and `arguments`; A accepts only `arguments` | the SDK schema only | E |
| MCP-G013 | No server offers resources, prompts or `list_changed` (catalogs change per tenant/role) | advertise `listChanged`; expose docs/specs as resources where useful | A, E, J, K |
| MCP-G014 | Outbound client re-initializes before every list and call | session reuse | `mcpWireClient.ts` |
| MCP-G015 | Second SSE parser and framing in the marketplace probe | use `client` | `dynamicReview.ts:349-430` |
| MCP-G016 | VS Code server-URL placeholder says `/sse`, but the client is Streamable-HTTP only | fix the placeholder, or add legacy SSE to `client` | `clients/vscode/src/tools/mcpServers.ts` |
| MCP-G017 | 6 REST relay clients for `/llm/v1/mcp/call`, 3 TTL caches, 5 auth-header builders | `relay` | `mcpCatalog.ts`, `builtinTools.ts`, `connector-tools.ts`, `platform-ticket-tools.ts`, `bf-cloud/tools.rs`, mobile |
| MCP-G018 | Two disjoint user-server stores: tenant DB (remote) vs Synapse `connectors.json` (local); two one-click catalogs | one connector catalog with `transport` | `identity.ts:294`, `bf-mcp/catalog.rs` |
| MCP-G019 | Nothing reads a host `mcp.json`; the memory installer only writes it | `config` read + write | `memory-mcp/src/install/*` |
| MCP-G020 | npx launch spec for memory-mcp copied by hand 3× | one `LaunchSpec` | `launch.rs`, `server-spec.ts`, `plugin.json` |
| MCP-G021 | 4 code-search tools (`codebase_*`, `semantic_search`/`repo_map`, `search_code`, `knowledge.search`) | Workspace MCP + area-2 audit | E, J, `core-tools.ts:106`, B |
| MCP-G022 | 3 memory tool vocabularies (`core-tools`, `memory-tool.ts`, memory-mcp) | memory-mcp names only | `core-tools.ts:347-415`, `agent-runtime/agents/tools/memory-tool.ts` |
| MCP-G023 | Possible double-advertising of the same third-party server (tenant connector + local connector) | dedupe by server identity in the catalog | B + I (unverified) |
| MCP-G024 | Non-MCP code named "mcp" (workflow `mcpNode`, orchestrator `mcp` node) | rename to `dataProvider` | `api/.../workflow/mcpNode.ts`, `orchestrator.ts:797-866` |

---

## 2. Code index / search / repo map / context

### 2.1 Inventory: 13 implementations

Roots: `B` = Builderforce.ai, `I` = builderforce-inference/crates, `M` = builderforce-memory/packages.

| # | Implementation | Path | Parse | Embed | Store | Lexical / rank | Repo map | Host |
|---|---|---|---|---|---|---|---|---|
| 1 | **bf-index** | `I/bf-index/src/*` | native tree-sitter, 11 languages; chunks ≤150 lines (header 25 + members; fallback 60/10) | fastembed bge-small-en-v1.5 384d (ONNX CPU, 33 MB) | SQLite per workspace (FTS5 + f32 BLOB, brute-force cosine) | identifier-aware BM25 + cosine, RRF k=60, +0.05 exact-symbol boost, cap 25 | file ref graph + personalized PageRank (0.85/30/1e-6), budget 1500–8000 tokens | Synapse (Rust) |
| 2 | bf-context | `I/bf-context/src/*` | — (wraps #1) | — | `~/.builderforce/desktop/indexes/<blake3>.db` | `semantic_search` (8/25), `check_references` (≤50) | `repo_map` | loopback HTTP + MCP |
| 3 | bf-compress | `I/bf-compress` | — | LLMLingua-2 ONNX 178 MB | — | `compress_context` | — | Synapse |
| 4 | `codebase_semantic_search` | `B/agent-runtime/src/builderforce/shared-tools/node-code-tools.ts:~361-595` | regex `extractSymbols` | **none** (BM25 only, despite the name) | `<root>/.builderForceAgents/search-index.json`, 5-min staleness | BM25 over the first 200 lines per file, 5000 files, 20 results | — | agent-runtime |
| 5 | `codebase_search` (= on-prem `search_code`) | same file `:~187-350`; wired at `agents/node-capability-provider.ts:296` | — | — | — | ripgrep per keyword + hand-weighted score, 20 results | — | agent-runtime |
| 6 | code-map / ast-parser | `B/agent-runtime/src/builderforce/{code-map,ast-parser}.ts` | TS compiler API (TS/JS only) | — | — | — | dependency graph | agent-runtime |
| 7 | Shared definition index | `B/packages/agent-tools/src/{symbols,node-tree-sitter,node-symbols,symbolRepoMap,symbolRelations,callScan}.ts` | web-tree-sitter WASM, 7 languages + regex fallback | — | `<ws>/.builderforce/symbols.json` (VS Code) · `<root>/.builderForceAgents/symbols.json` (on-prem) | `find_symbol`, `file_outline` | coarse (no ref graph) | VS Code, agent-runtime |
| 8 | **packages/repo-map** | `B/packages/repo-map/src/*` | regex facts (a deliberate TS mirror of #1's graph and map) | — | R2, keyed by repo+sha | keyword over definitions | PageRank (same constants as #1) | Cloudflare Worker |
| 9 | Cloud dense arm | `B/api/src/application/repos/repoSymbolVectors.ts`, `knowledge/knowledgeEmbedder.ts` | — | bge-m3 Workers AI, int8, signatures only | R2 per repo | RRF with #8 | — | Worker |
| 10 | **Deterministic knowledge index** | `M/memory/src/retrieval/knowledge-index/*` + `B/packages/agent-tools/src/knowledge/index/*` + `B/clients/vscode/src/knowledge/index/hostKnowledgeIndex.ts` + `B/api/.../knowledgeIndexPort.ts` | graph cards (path + symbol, no bodies) | chain: Synapse (never offered) → Evermind CPU → Ollama | int8 CSR `.idx` (editor) / `.bin` (R2) | exact → lexical → dense cascade | — | Worker, browser, Node |
| 11 | Memory RAG | `M/memory/src/retrieval/*`, `rag/*`, `vectorstore/*` | recursive char chunker 1000/200 | Evermind | HNSW / REST | BM25 + dense RRF + MMR | — | any; also backs API `knowledge.search` = SOP/doc search (`recallSops.ts`), not code |
| 12 | Knowledge-review graph | memory `knowledge/*`, agent-tools `knowledge/*` (codePack, codeLayers, codeEntryPoints, codeGraph…), VS Code `src/knowledge/*`, knowledge-browser, knowledge-client, knowledge-graph-view | regex + manifests + dependency-cruiser/jscpd/knip | — | packs | — | — | all |
| 13 | Other `search_code` backings | VS Code `src/workspace/workspaceSearch.ts` (exact/regex ripgrep, cap 100); cloud `repos/readRepoContents.ts searchRepoCode` (GitHub/GitLab API, 30); IDE `cloudAgent/ideWorkspaceCoding.ts searchIdeWorkspace` (R2 substring scan, 30) | — | — | — | — | — | — |

Checked and not duplicates:
- `packages/prefetch/lexical.ts` is an intent tokenizer.
- webcontainers has no index.
- Chrome calls the API.
- `@huggingface/transformers` is used for chat, not indexing.

### 2.2 Duplicate-responsibility matrix

| Responsibility | Copies |
|---|---|
| Symbol / definition parsing | **5**: bf-index `lang.rs` (11 languages), agent-tools `node-tree-sitter.ts` (7), agent-tools `symbols.ts` regex, agent-runtime `ast-parser.ts` (TS API), `symbolRelations.ts` (regex) |
| Chunking | 3 incompatible: bf-index (tree-sitter, 150/60 lines), memory `chunk.ts` (1000/200 chars), node-code-tools (first 200 lines, no chunks) |
| Embedders | **4 models**: bge-small 384d (Synapse), bge-m3 (cloud), Evermind SSM (editor, memory-mcp), Ollama (editor). No vectors are shared across stores |
| Vector stores | 4: SQLite BLOB, int8 CSR `.idx`/`.bin`, HNSW, R2 per-repo vectors |
| Lexical search | **6**: FTS5 + `terms.rs`, BM25 JSON (node-code-tools), memory `bm25.ts` + knowledge-index `lexical.ts`, repo-map `search.ts`, ripgrep ×2, GitHub API |
| Tokenizers | 5: `terms.rs`, repo-map `terms.ts` (mirror), knowledge-index `tokenize.ts`, node-code-tools `ssTokenise`, prefetch `lexical.ts` |
| Fusion / ranking | 4: `search.rs` RRF, memory `fusion.ts` RRF, cloudRepoMap RRF, node-code-tools hand weights |
| Repo map | 3: `repo_map.rs`, repo-map `render.ts` (mirror), `symbolRepoMap.ts` (no graph) |
| File walk + ignore rules | **7**: `walk.rs`, repo-map `filePolicy.ts`, agent-tools `skipDirs.ts`, memory `ignoreMatcher.ts`, VS Code `workspaceSearch.ts SKIP_DIRS`, node-code-tools `IGNORED_DIRS` (11 dirs), `ON_PREM_INDEX_SKIP_DIRS` |
| Change detection | 3: blake3 + notify watcher (bf-index), VS Code `indexWatcher` + mtime snapshot, agent-runtime 5-min staleness (no watcher) |
| `search_code` backing | **4 different semantics**: exact/regex (VS Code), keyword-ranked (on-prem), GitHub search (cloud), lower-cased substring (IDE workspace) |

### 2.3 Same repo, indexed several times on one machine

With VS Code, Synapse and agent-runtime all running, one repo produces:

- `~/.builderforce/desktop/indexes/<hash>.db` (Synapse: chunks + bge-small vectors);
- `<ws>/.builderforce/symbols.json`, `.builderforce/knowledge/<rootId>.idx` and the stat manifest (VS Code);
- `<ws>/.builderForceAgents/symbols.json` and `search-index.json` (agent-runtime). The directory name differs (`.builderForceAgents` vs `.builderforce`).

That is three walks, three parsers, two symbol snapshots and two embedders. None reuses another's output. The editor's embedder chain lists Synapse first, but Synapse never offers an embedder.

### 2.4 Survivor choice

| Capability | Best today | Why |
|---|---|---|
| Parsing / chunking | bf-index (native tree-sitter, 11 languages, body chunks) | Only one with real chunks. agent-tools WASM tree-sitter is 7 languages, but `tree-sitter-wasms` ships grammars for all 11. |
| Repo map | bf-index ≡ packages/repo-map (same algorithm) | repo-map already runs in Workers, Node and the browser; it only lacks tree-sitter facts. |
| Lexical + dense store | memory knowledge-index | Pure TS, runs everywhere, int8 + CSR, fingerprint-guarded. Lacks body chunks. |
| Embedder | Undecided: bge-small (Synapse) vs Evermind vs bge-m3 | One model per index fingerprint; see §2.5. |
| References check, watcher, hash-incremental | bf-index only | Must be ported. |
| Exact / regex search | VS Code `workspaceSearch.ts` (ripgrep + JS fallback) | Correct semantics; it lives in the client instead of a package. |

### 2.5 Target design: one code index, every host

Following decision 4 (interface first; Rust only where a benchmark proves a gain), there is one TypeScript engine assembled from parts that already exist, so it runs in the VS Code extension host / rebuilt Synapse IDE, agent-runtime, the Cloudflare Worker and the browser.

**Package `@seanhogg/builderforce-code-index`** (new), composed from:
- `parse`: agent-tools `node-tree-sitter.ts`, extended to bf-index's 11 languages from the same `tree-sitter-wasms`. `symbols.ts` regex stays the per-file fallback. `ast-parser.ts` and `symbolRelations.ts` regex are deleted, and the TS API call graph moves to a tree-sitter `calls` query.
- `chunk`: a port of bf-index `chunk.rs` rules (definition chunks ≤150 lines, header + members, 60/10 fallback). The memory `chunk.ts` stays for prose only.
- `graph` + `map`: **packages/repo-map, unchanged**, fed tree-sitter facts instead of regex. `symbolRepoMap.ts` is deleted.
- `store` + `search`: the **memory knowledge-index** (exact → lexical → dense), extended with body-chunk records beside cards, so one `.idx` per root replaces `.db`, `symbols.json`, `search-index.json` and the `.idx` cards. `bm25.ts` stays as its lexical primitive; FTS5 and the node-code-tools BM25 are deleted.
- `walk`: ONE ignore policy (merge the 7 lists; repo-map `filePolicy.ts` is the base) and one path normaliser (repo-relative POSIX, canonical root).
- `refresh`: content-hash incremental (port of blake3 → a webcrypto/sha-1 per file) plus a host watcher port. VS Code supplies `FileSystemWatcher`, Node supplies `fs.watch`, and the Worker refreshes per commit sha (as `cloudRepoMap.ts` does).
- `refs`: a port of `check_references`.
- `embed`: one `EmbedderPort` chain with ONE fingerprint per index.
  - Default: the platform's chosen local model.
  - In the cloud, bge-m3. Cloud and local indexes stay separate stores, but they share a format.

**One location:** `<ws>/.builderforce/index/<rootId>.idx`. `.builderForceAgents/` is retired. The VS Code extension, the Synapse IDE (the same extension) and agent-runtime on one machine share the file through a single-writer lock, and the second process reads it.

**One tool vocabulary on Workspace MCP** (§1.5):

| Tool | Semantics |
|---|---|
| `workspace__search` | exact or regex text search (ripgrep; JS fallback; `path` scope applied *before* the search) |
| `workspace__find` | semantic + lexical hybrid over chunks and cards (replaces `semantic_search`, `codebase_semantic_search` and `codebase_search`) |
| `workspace__symbol` / `__outline` | definition lookup |
| `workspace__map` | PageRank repo map (budgeted) |
| `workspace__references` | `check_references` |
| `workspace__compress` | LLMLingua (stays optional; it needs a native or ONNX backend) |

**Benchmark gate** (decision 4): before retiring bf-index, time the TS engine on hired.video and Builderforce.ai (cold index, warm query p50/p95, memory). If native is decisively faster, compile `bf-index` to WASM behind the same `parse`/`chunk` interface instead of keeping a Rust sidecar.

**Windows lexical baseline (2026-11-26).** A tracked snapshot of Builderforce.ai took 333 seconds from an empty TS cache to the first result. Its 30 warm queries measured 125 ms p50 and 370 ms p95, with 619 MiB process RSS. On hired.video, reopening and validating an existing TS snapshot took 83 seconds. Warm queries measured 116 ms p50 and 685 ms p95, with 361 MiB RSS. Both searches reported partial coverage. On cold unscoped Workspace MCP calls, the server reports indexing in progress after five seconds while the shared build continues. The native loopback service, with embeddings disabled, was still scanning both repos at the seven-minute cutoff. This run shared the machine with other builds. A controlled comparison with matched coverage, cold measurements for both engines, and dense retrieval quality remains the retirement gate.

**Matched-file Windows lexical sample (2026-11-26).** Both engines searched the same 400 tracked source files per repository in fresh scratch directories, with embeddings disabled. The TypeScript search reported complete coverage and the native service reported 400 indexed files per repo. Warm latency is from 30 queries per run. Other local work ran during this sample, and the processes contain different runtime overhead.

| Repository | Engine | Cold first result | Warm p50 / p95 | Process RSS |
|---|---|---:|---:|---:|
| hired.video | TypeScript | 89.5 s | 188 / 827 ms | 214 MiB |
| hired.video | Native loopback | 10.2 s | 39 / 64 ms | 18 MiB |
| Builderforce.ai | TypeScript | 79.6 s | 193 / 599 ms | 202 MiB |
| Builderforce.ai | Native loopback | 13.4 s | 44 / 172 ms | 18 MiB |

The native service was faster on both lexical samples. Keep it until a full-repository comparison with matched coverage and a dense retrieval quality check supports a replacement.

**Reproducible comparison.** `scripts/benchmark-code-index.mjs` pins tracked Git blobs, builds a common corpus, and checks the indexed file set of each engine before reporting latency. In matched 1,000-file lexical runs, hired.video (`27dbdf38dfb`) measured 31.1 s cold and 149/299 ms warm p50/p95 for TypeScript, and 27.2 s cold and 62/99 ms warm for native. Builderforce.ai (`56755a50276`) measured 25.2 s and 37/71 ms for TypeScript, and 52.0 s and 81/114 ms for native. Native RSS was 19–24 MiB compared with 238–271 MiB for the TypeScript process. Cold and warm latency varied by repository.

Full coverage cannot be matched at the current TypeScript limits. Of 5,385 eligible hired.video files, at most 4,548 fit the 24 MiB budget. Of 19,389 eligible Builderforce.ai files, at most 4,428 fit. Both ceilings precede the 20,000-chunk cap. The harness's `--full-comparison` mode runs the same TypeScript scanner, chunker, and ranker with a larger in-memory budget. This mode skips shared snapshot I/O and leaves the shipped limits unchanged. Its cold time therefore excludes writing and reopening the TypeScript snapshot. Both engines must index every materialized path for the comparison to pass.

An offline check used the same cached BGE-small ONNX model with native and a scratch TypeScript `EmbedderPort`. The native engine embedded all 207 chunks from the 40-file matched corpus. Both engines ranked the judged file first for all three questions, as did TypeScript’s lexical-only search. The sample confirms the offline evaluation path. Native retirement still requires matched full coverage, a larger judged set with low-lexical-overlap queries, and a production TypeScript embedder for the chosen model.

### 2.6 Granular gaps

| ID | Gap | Fix | Where |
|---|---|---|---|
| CIX-G001 | **Bug:** on-prem `search_code` is keyword-ranked ripgrep (`runCodebaseSearch`), but its contract promises an exact substring or regex. The `path` scope is applied after the search. | Route it to exact/regex search, with the scope applied first | `agent-runtime/src/agents/node-capability-provider.ts:296`, `node-code-tools.ts:~187` |
| CIX-G002 | `codebase_semantic_search` has no embeddings (BM25 over the first 200 lines); the name is misleading | Replace it with `workspace__find` | `node-code-tools.ts:~361-595`, `mcp-server-http.ts` |
| CIX-G003 | Exact search lives in the VS Code client, not a package; 4 `search_code` semantics exist across hosts | Move `workspaceSearch.ts` into `code-index/search`; make cloud and IDE match its contract | `clients/vscode/src/workspace/workspaceSearch.ts`, `readRepoContents.ts`, `ideWorkspaceCoding.ts` |
| CIX-G004 | 5 symbol parsers (native tree-sitter 11 languages, WASM 7, regex, TS compiler API, regex relations) | One `parse` on WASM tree-sitter (11 languages) plus a regex fallback | `lang.rs`, `node-tree-sitter.ts`, `symbols.ts`, `ast-parser.ts`, `symbolRelations.ts` |
| CIX-G005 | 3 chunkers; only Synapse embeds code bodies; the editor index holds cards only | Port the `chunk.rs` rules; add chunk records to the knowledge index | `chunk.rs`, memory `knowledge-index/*` |
| CIX-G006 | repo-map is a hand-maintained TS mirror of `graph.rs`/`repo_map.rs`, fed by regex | Keep repo-map as the one implementation, fed by `parse`; delete `symbolRepoMap.ts` | `packages/repo-map`, `agent-tools/symbolRepoMap.ts` |
| CIX-G007 | 6 lexical engines and 5 tokenizers | knowledge-index lexical + `bm25.ts`; one `codeTokenize` | see §2.2 |
| CIX-G008 | 4 RRF/fusion copies | memory `fusion.ts` only | `search.rs`, cloudRepoMap, node-code-tools |
| CIX-G009 | 7 ignore lists that disagree (`target`, `vendor`, `media`, dot-dirs, `.vercel`, `.worktrees`…) | One policy (base: `filePolicy.ts`) | §2.2 row "File walk" |
| CIX-G010 | Path normalisation is done case by case (`normalizeScopeDir`, `relPosix`, `replace(/\\/g,'/')`) | One normaliser in `walk` | agent-tools, VS Code, agent-runtime |
| CIX-G011 | One repo is indexed 3× on one machine, in two dot-dirs (`.builderforce` vs `.builderForceAgents`) | One `.idx` per root; single writer; retire `.builderForceAgents` | §2.3 |
| CIX-G012 | 4 embedding models and no shared fingerprint policy; the editor chain lists a Synapse embedder that is never offered | One `EmbedderPort` chain with a declared default model per surface | `embedderChain.ts`, `embedderPort.ts`, `bf-index/embed.rs`, `knowledgeEmbedder.ts` |
| CIX-G013 | Change detection: watcher + blake3 (Synapse) vs mtime snapshot (VS Code) vs 5-min staleness (agent-runtime) | Content-hash incremental + host watcher port | `watcher.rs`, `indexWatcher.ts`, `node-code-tools.ts` |
| CIX-G014 | `check_references` exists only in Rust | Port it to `code-index/refs` | `bf-index/refs.rs` |
| CIX-G015 | Result caps disagree (8/25/20/100/30), as do file caps (1 MB / 256 KB; 5k / 6k / 40k files) | One cap policy per tool, documented | §2.2 |
| CIX-G016 | Partial comparison only | §2.5 records a full-repo smoke and matched lexical samples. Full-repo matched coverage and dense quality remain open | — |
| CIX-G017 | API `knowledge.search` is SOP/doc search (`recallSops.ts`), but its name suggests code | Rename it to `docs.search`, or document it | `builtinMcpService.ts:1402` |

---

## 3. Local inference, model catalog, routing, caches

Roots: `BI` = builderforce-inference, `BF` = Builderforce.ai, `WC` = builderforce-webcontainers, `MEM` = builderforce-memory.

### 3.1 Inventory

**Engines (run a model):**
- `BI/crates/bfi-*`: one Rust engine (`bfi-engine`) with three targets.
  - Targets: native `bfi-server`, wasm `bfi-web`, napi `bfi-node`.
  - GGUF reader (incl. Q1_0/PQ2_0/PTQ1_0), CPU SIMD + wgpu backends, qwen3 / qwen35-Bonsai.
  - Prefix KV (`engine/prefix.rs`), speculative decoding (`spec.rs`) and grammar-constrained tools.
  - Serves OpenAI, Anthropic and Ollama APIs on :11434.
- `BF/packages/bfi-node` (2026.10.12) and `bfi-web`: vendored prebuilt artifacts of the above (`SOURCE.json`), linked into VS Code.
  - **`bfi-web` is stale:** 2026.10.10 against crate 2026.10.12.
- Others:
  - `agent-runtime/llama-stream.ts` (node-llama-cpp);
  - `brain-embedded/pageEngines/{webllmEngine,browserEngine}.ts` (WebLLM, Gemini Nano);
  - WC `inference/` (ONNX Runtime Web, wllama, WebLLM adapters): **no consumer found**;
  - MEM `memory-engine` (SSM/Evermind: a different model family, not a duplicate).

**Hosts that drive an engine:**
- VS Code `src/hostBfi/*` (a worker_thread loading native `bfi-node`, else wasm; it auto-provisions Bonsai ≤600 MB);
- `brain-embedded/pageEngines/bfiEngine.ts` (browser);
- `bf-local/runtime.rs` (supervises `bfi serve` for Synapse).

**Catalogs: about 9, only 3 of them generated, from different sources:**
1. `model-catalog` (tiers, role ladders, BYO vocabulary);
2. `model-catalog/generated/priceSnapshot.ts` (OpenRouter, generated);
3. api `llm/vendors/*.ts` (the routing source of truth: tier, context, capabilities) + `liveModels.snapshot.json`;
4. api `modelCatalog.ts` (a live OpenRouter fetch for marketing);
5. frontend `lib/modelCatalog.ts` and `brain-embedded/gatewayModels.ts` (read the gateway);
6. agent-runtime `models-config.providers.ts` + 5 `*-models.ts` (**hand-coded context and price**);
7. `local-inference/catalog.ts` + `webllmCatalog.generated.ts` (generated) + `bfiLimits.generated.ts` (generated from Rust `kv_plan`);
8. `BI/bf-local/hub.rs` (hard-coded Ollama-tag hub: llama3.x, qwen2.5, gemma2);
9. api `providerModelCatalog.ts` (per-tenant fetch).

**Routers: about 10.**
- The shared core is `packages/model-router` (+ `learned-routing`, `difficulty-router`, `cost-levers`). api and agent-runtime each bind their own `CatalogView` to it, which is fine.
- Extra pickers:
  - api `proxySeed`/`poolRouting`/`modelPool*`/`proxyRoutePlan`, `pickCloudModel.ts`, `byoRoleOrder.ts`/`byoModelRouting.ts`;
  - `local-inference/plan.ts` + `brain-embedded/hostModelStream.ts` + `localSuccessRouter.ts`;
  - VS Code `models/modelRouting.ts`;
  - Chrome `inference/route.ts`;
  - agent-runtime `provider-cascade.ts`;
  - MEM `InferenceRouter.ts` (SSM vs transformer: a different problem).

**Fit / hardware budget:** 4 copies.
- Rust `bfi-runtime/fit.rs` + `bfi-models/kv_plan.rs`;
- TS `local-inference/fit.ts` (generated limits: good);
- `bf-local/hub.rs` (its own 0.6 share);
- WC `adaptive/`.

**KV / prefix cache:** 3 implementations.
- Rust `prefix.rs` (the real one);
- `bfi-core/resident` (GPU-resident);
- WC `kvcache/{paged,radix,lru,quant}.ts`, with **no engine feeding it**.

**Response caches:** 3.
- api `{responseCache,proxyResponseCache,semanticCache,semanticChatCache}.ts`;
- MEM `ResponseCache`/`SemanticCache`/`CachingBridge`;
- api `promptCaching.ts` (Anthropic `cache_control`, distinct).

**Ollama clients:** 6.
- `local-inference/{probe,embed}.ts`, agent-runtime `ollama-stream.ts`, api `vendors/{ollama,ollamaLocal}.ts`, Chrome `localRuntimes.ts`, `bfi/ollama.rs` (reads its store);
- also `bfi-server` *serves* the Ollama API.

**Weight stores on one machine: 8.**
1. `~/.builderforce/models` (Rust; the path is coded twice, in `bfi-runtime/store.rs` and `bf-local/runtime.rs`);
2. `~/.ollama/models`;
3. VS Code `globalStorage/local-models/<runtime>/`;
4. browser Cache Storage (HF URL);
5. WebLLM Cache Storage;
6. WC IndexedDB;
7. node-llama-cpp path;
8. Gemini Nano.

**The same Bonsai GGUF can sit in 3 of them on one PC.**

### 3.2 Inconsistencies

- **One engine, two runtime ids:** `synapse` and `bfi` both probe :11434 (Chrome dedupes them).
- **Bonsai ids differ:** `bonsai-1.7b-q1_0` (GGUF, runtime `bfi`) vs `Bonsai-1.7B-q4-ONNX` (runtime `webllm`).
- **The two local catalogs share no models:** the Rust hub uses Ollama tags; the TS catalog never lists them.
- **Price ids are OpenRouter ids** (incl. `~…-latest` aliases) and need `vendors/modelTwins.ts` to meet the vendor ids.
- **Context-window defaults disagree:** Ollama 128000 (agent-runtime), Bonsai 32768/65536, WebLLM 1024–4096.
- **The `bfi` CLI User-Agent** is hard-coded `bfi/2026.10.4`.
- **memory-engine `export/gguf.ts`** produces a GGUF that stock llama.cpp cannot run (unverified whether the docs say otherwise).

### 3.3 Target design

| Capability | Survivor | Retire / fold |
|---|---|---|
| Engine (native, wasm, napi, server) | `BI/crates/bfi-*`; distribution = the vendored `BF/packages/bfi-*` only | WC `inference/` (unused); node-llama-cpp `llama-stream.ts` once `bfi-node` covers the on-prem GGUF path |
| Local runtime registry, catalog, fit, local-first plan | `BF/packages/local-inference` | `bf-local/hub.rs` + its `fit.rs` (Synapse rebuild); one runtime id for the engine (`bfi`; `synapse` becomes a host label, not a runtime) |
| Hardware limits | Rust `kv_plan` → generated `bfiLimits` (already) | `hub.rs` 0.6 share, WC `adaptive/` |
| Cloud catalog (price, context, tier, roles) | `packages/model-catalog`, generated from ONE pipeline: priceSnapshot + vendor registry + context table | agent-runtime hand tables (`models-config.providers.ts`, `*-models.ts`); api `modelCatalog.ts` reads the same snapshot |
| Routing order | `packages/model-router` (+ learned, difficulty, cost-levers) | VS Code `modelRouting.ts`, Chrome `route.ts` and `provider-cascade.ts` become thin `CatalogView` bindings; api pickers (`pickCloudModel`, `byo*`, `poolRouting`) collapse into model-router policies |
| Prefix / KV cache | Rust `prefix.rs` (+ `resident`) | WC `kvcache/*` (no consumer) |
| Response cache | one library: MEM `ResponseCache`/`SemanticCache` behind api `cacheScope.ts` | api's own copies |
| Ollama client | `local-inference` (`probe`, `embed`, + a stream adapter) | agent-runtime `ollama-stream.ts`, Chrome `localRuntimes.ts` probe |
| Weight store | ONE machine store: `~/.builderforce/models` (`BFI_MODELS_DIR`), with sha256 and resumable download; VS Code `hostBfi/modelFiles.ts` points at it | VS Code `globalStorage/local-models`; the duplicated `models_dir()` in `bf-local`. Browser Cache Storage stays (a different host) |

### 3.4 Granular gaps

| ID | Gap | Fix | Where |
|---|---|---|---|
| INF-G001 | The vendored `bfi-web` is stale (2026.10.10 vs crate 2026.10.12); its `SOURCE.json` may lag the bytes | Re-run `scripts/vendor-bfi-web.mjs`; add a drift guard against the crate version | `BF/packages/bfi-web`, `BI/crates/bfi-web` |
| INF-G002 | WC `inference/` (ONNX/wllama/WebLLM) has no consumer | Validate, then retire (or wire it if a host needs ONNX) | `WC/packages/browser/src/inference/*`, `ml.ts` |
| INF-G003 | WC `kvcache/*` (paged/radix/lru/quant) has no engine feeding it | Retire; the Rust `prefix.rs` is the prefix cache | `WC/packages/browser/src/kvcache/*` |
| INF-G004 | WC `adaptive/` and `learning/` duplicate the fit and routing ideas, with no consumer found | Validate, then retire | `WC/packages/browser/src/{adaptive,learning}` |
| INF-G005 | About 9 model catalogs; agent-runtime hand-codes context windows and prices | One generated catalog pipeline in `model-catalog`; agent-runtime consumes it | `agent-runtime/src/agents/models-config.providers.ts`, `*-models.ts` |
| INF-G006 | Rust `hub.rs` local catalog (Ollama tags) is disjoint from the TS `local-inference` catalog | One local catalog (`local-inference`); Synapse rebuild drops `hub.rs` | `BI/crates/bf-local/src/hub.rs` |
| INF-G007 | 4 fit/hardware-budget implementations | Rust `kv_plan` → generated `bfiLimits` only | `hub.rs`, `fit.rs` ×2, WC `adaptive` |
| INF-G008 | About 10 model pickers; api pickers outside `model-router` | model-router policies; hosts keep only `CatalogView` bindings | api `pickCloudModel`, `byo*`, `poolRouting`, `proxySeed`; VS Code `modelRouting.ts`; Chrome `route.ts`; `provider-cascade.ts` |
| INF-G009 | 3 response-cache implementations | One library behind `cacheScope.ts` | api `*Cache.ts`, MEM `ResponseCache`/`SemanticCache` |
| INF-G010 | 6 Ollama clients | `local-inference` owns probe, embed and stream | `ollama-stream.ts`, Chrome `localRuntimes.ts`, api `vendors/ollama*.ts` |
| INF-G011 | 8 weight stores; the same Bonsai GGUF stored up to 3× per machine; `models_dir()` coded twice in Rust | One machine store `~/.builderforce/models` shared by VS Code and `bfi serve` | `hostBfi/modelFiles.ts`, `bf-local/runtime.rs`, `bfi-runtime/store.rs` |
| INF-G012 | `synapse` and `bfi` are two runtime ids for one engine on :11434 | One runtime id (`bfi`); host labels are separate | `local-inference/runtimes.ts`, Chrome `localRuntimes.ts` |
| INF-G013 | Bonsai id drift (`bonsai-1.7b-q1_0` vs `Bonsai-1.7B-q4-ONNX`); context-window defaults disagree (128000 / 32768 / 1024–4096) | Ids and context come from the one catalog | `local-inference/catalog.ts`, `ollama-stream.ts` |
| INF-G014 | node-llama-cpp is a second native GGUF engine in agent-runtime | Use `bfi-node` (same contract as VS Code) | `agent-runtime/src/agents/llama-stream.ts` |
| INF-G015 | `bfi` CLI User-Agent hard-coded `bfi/2026.10.4` | Derive it from the crate version | `BI/crates/bfi/src/hf.rs` |
| INF-G016 | memory-engine GGUF export is not llama.cpp-runnable; the docs may imply it is | Document the format, or rename the exporter | `MEM/packages/memory-engine/src/export/gguf.ts` |

---

## 4. Agent memory: Evermind, facts, skills, episodes, runs

Roots: `B` = Builderforce.ai, `M` = builderforce-memory, `I` = builderforce-inference, `W` = builderforce-webcontainers.

### 4.1 What is already shared, and what is not

**Already shared:**
- the fact engine (`M/memory` `MemoryStore`, `recallRanked`, `EvermindCognition.commitFact`);
- the memory MCP server (`M/memory-mcp`);
- the experience model: Episode, Skill, Run, Train-Once (`M/memory-engine/experience`);
- ONE console, `EvermindConsole` in `packages/brain-ui`, mounted by the frontend, VS Code `EvermindScreen` and the Synapse `app/console`;
- the `memory_*` tool contract (`agent-tools` `MemoryCapability`), with a cloud implementation (`buildMemoryCapability` over `memoryService`) and an on-prem one (`agent-runtime/run/nodeMemory.ts`).

Synapse's `bf-memory` is a thin MCP client: no second store.

**Not shared:**

| Capability | Copies |
|---|---|
| Fact stores | **9 shapes**:<br>- `memory.json` (local);<br>- cloud tables `project_facts` and `agent_memory` (scoped);<br>- `facts` (subject/predicate/object, a different model);<br>- Evermind Durable Object `mem:` ring;<br>- `.builderforce/memory/<date>.md` notes;<br>- Claude auto-memory `*.md`;<br>- agent-runtime sqlite-vec index (`src/memory/*`);<br>- W `memoryIntegration` IndexedDB;<br>- brain-embedded `onDeviceMemory` (a tab Q&A cache). |
| Recall / ranking | **6 formulas**:<br>- M hybrid RRF + importance + 90-day decay;<br>- api `memorySemanticRecall` (pgvector + lexical, its own formula);<br>- Evermind `/evermind/recall` (SSM cosine);<br>- agent-runtime `memory/hybrid` (wraps M math, own store);<br>- W `LexicalIndex` (its own BM25 + RRF);<br>- api `recallSops` (BM25). |
| Remember / dedupe | `commitFact` (replace by key); `memoryService.remember` (scope specificity); `writeProjectFact`; agent-runtime vector dedupe; Evermind `learn-text` reconcile. |
| Compaction | memory-mcp `compaction.ts` (reused by VS Code); M `working/consolidate` (codemap); `brainMemory` consolidation into `project_memories`; agent-runtime `memory-flush` (prompt-driven). |
| Tool names | `memory_recall` / `memory_remember` / `memory_forget` (memory-mcp, agent-tools); **VS Code** `recall_facts` / `remember_fact`; agent-runtime legacy `memory_search` / `memory_get`. |
| Episodes / skills / runs schema | TS `memory-engine/experience/types.ts` **hand-mirrored in Rust** `I/crates/bf-teach/model.rs`. Synapse `facts_list` reads `memory.json` directly, bypassing the server. |
| "Skill" | **3 unrelated meanings**:<br>(a) a Train-Once procedural skill (engine);<br>(b) a SKILL.md agent skill (`packages/agent-skills`, cloud `skills` / `tenant_skills` / `marketplace_skills` / `skill_files`, agent-runtime `skill-registry`);<br>(c) the Claude Code plugin skill (`plugins/builderforce-memory/skills`). |
| Run ledgers | memory-engine `Run` / `RunStepLog` (`experience.json`), written by Synapse `runs.rs`; cloud `runDelta` / `runOutcomes`, `commitRunMemory` facts `run-outcome:<scope>:<id>`; `brain_chat_steps`; agent-runtime `run-outcome-memory.ts`. |
| Chat learning | `chat_memories` (per session) + `project_memories` (per project) vs Evermind `learn-text` contributions vs the `brain_chat_*` tables. |
| "Learn" / train | local `trainOnce` and `experience_train` (CPU) vs cloud `evermindLearningPipeline`, `evermindDistillation`, `evermindDeltaLearn` (server SSM). Different data, same word. |
| Brain map UI | Synapse hand-written `ui/js/views/brain/*.js` vs frontend `EvermindBrainMap` vs `EvermindBrain3D` (canvas station). Synapse also has hand-written facts, skills, teach and runs views. |
| Embedding spaces | **5, not comparable**: pgvector 1536 (legacy) + 1024 bge-m3 (cloud); `EvermindLM` hidden state (local and the Durable Object); agent-runtime provider embeddings (OpenAI, Gemini, Voyage); W injected embedder. |
| Local ↔ cloud sync | **None for facts.**<br>- The Merkle knowledge sync covers graphs only.<br>- `/api/sync/v1` covers chat and tickets.<br>- The VS Code import teaches Evermind (`learn-text`), not `project_facts` (unverified).<br>- agent-runtime pushes `team:` and `run-outcome:` facts one way. |

### 4.2 Inconsistencies

- **Names:**
  - "Evermind" means the model, the whole brain, the facts and the console.
  - "Brain" means the chat assistant, the map visual and Synapse `cloud/brain.rs`.
  - "Memory" means facts, RAM (W `src/memory`), the `agent_memory` table, markdown notes and the workspace index (`memory_search`).
- **IDs:**
  - memory-mcp keys are free strings;
  - cloud keys are `varchar(255)` with uuid ids;
  - `chat_memories` uses serial ids;
  - experience ids are 16 hex characters.
  - Key prefixes are not registered anywhere: `team:`, `run-outcome:`, `codemap:`, `[absorbed→…]`.
- **Limits:**
  - local 10,000 entries vs cloud key length 255;
  - recall defaults 5 (VS Code max 20) vs Synapse injecting 6,000 characters;
  - the 90-day half-life applies locally only.
- **Locations:**
  - `~/.builderforce-memory/memory.json` (canonical) and `~/.claude/builderforce-memory/memory.json` (legacy; whichever is newer wins, which is a split-brain risk);
  - `<ws>/.builderforce/memory/<date>.md`;
  - `.builderforce/model.bin`.

### 4.3 Target design

| Capability | Survivor | Change |
|---|---|---|
| Fact model, rank and write | M `MemoryStore` + `recallRanked` + `commitFact` | Cloud `memoryService` keeps governance and scoping but calls M's ranker (one formula). `facts` (triples) is either folded into `agent_memory` or documented as the knowledge graph's own store. |
| Tool contract | `agent-tools` `memory_*` (`MemoryCapability`) | VS Code `recall_facts`/`remember_fact` → `memory_*`; retire agent-runtime `memory_search`/`memory_get` with the pi loop. This matches `MCP-G022`. |
| Compaction | memory-mcp `compaction.ts` | `brainMemory` consolidation and `memory-flush` call it. |
| Experience (episodes, procedural skills, runs, Train-Once) | M `memory-engine/experience` | Rust `bf-teach` types are retired with the Synapse rebuild (the TS IDE hosts the teach flow). No direct reads of `memory.json`. |
| SKILL.md skills | `packages/agent-skills` + cloud `skills*` | Rename the procedural kind ("routine" or "recipe") so "skill" means one thing. |
| Run ledger | cloud `runOutcomes` / `runDelta` for runs; experience `Run` only for Train-Once replays | One `RunRef` id shared across both. |
| Consoles and maps | brain-ui `EvermindConsole` + one brain map (merge into the shared 3D stage, `AE-G059`) | Synapse hand-written views are retired. |
| Local ↔ cloud facts sync | new: facts over the existing local-first `/api/sync/v1` outbox (`packages/local-first`, `write-outbox`) | `memory.json` ↔ `project_facts`/`agent_memory` with scope and provenance; the import path stops being the only bridge. |
| Embeddings | one fingerprint per store, declared; the cloud failover vendor stated | (same policy as `CIX-G012`) |
| RAM manager naming | W `src/memory` → `src/residency` | It is not agent memory. W `memoryIntegration` reuses M `retrieval`/`ingest`. |

### 4.4 Granular gaps

| ID | Gap | Fix | Where |
|---|---|---|---|
| MEM-G101 | 9 fact-store shapes with no declared owner per scope | One owner table per scope; others become caches or imports | §4.1 row "Fact stores" |
| MEM-G102 | 6 recall formulas; the cloud ranks with its own formula | Cloud calls M `recallRanked` | `api/.../memory/memorySemanticRecall.ts`, W `memoryIntegration`, agent-runtime `src/memory/*` |
| MEM-G103 | VS Code memory tools are `recall_facts`/`remember_fact`, not `memory_*` | Adopt the `MemoryCapability` tools | `clients/vscode/src/memory/cognition.ts` |
| MEM-G104 | agent-runtime keeps a second memory index (sqlite-vec + provider embedders) with tools `memory_search`/`memory_get` | Retire with the pi loop; the workspace-notes index moves to `code-index` (§2) | `agent-runtime/src/memory/*`, `agents/tools/memory-tool.ts` |
| MEM-G105 | Experience types hand-mirrored in Rust `bf-teach` | Retire with the Synapse rebuild; until then, add a contract test | `I/crates/bf-teach/src/model.rs` |
| MEM-G106 | Synapse reads `memory.json` directly (`facts_list`), bypassing memory-mcp | Go through the MCP tools | `I/app/src-tauri/src/agents/*` |
| MEM-G107 | "Skill" has 3 meanings | Rename the procedural kind | memory-engine `experience`, memory-mcp `skill_*` tools |
| MEM-G108 | 4 run ledgers with unrelated ids | One `RunRef` | `experience.json` runs, `runOutcomes`, `runDelta`, `brain_chat_steps` |
| MEM-G109 | 4 compaction paths | memory-mcp `compaction.ts` only | `brainMemory.ts`, `working/consolidate`, `memory-flush.ts` |
| MEM-G110 | No local ↔ cloud fact sync | Facts over `/api/sync/v1` outbox | `packages/local-first`, `write-outbox`, memory-mcp backend |
| MEM-G111 | Two live memory file locations; the newest wins (split-brain risk) | Migrate the legacy file once, then read one location | `memory-mcp` `resolveMemoryFile()` |
| MEM-G112 | Fact key prefixes (`team:`, `run-outcome:`, `codemap:`, `[absorbed→…]`) are conventions with no registry | One key-namespace registry in M | M `memory`, api `runEndMemory.ts`, `teamMemoryFeed.ts` |
| MEM-G113 | 5 incompatible embedding spaces; cloud memory is pinned to one vendor with no failover | Declare one fingerprint per store and a failover | `memorySemanticRecall.ts`, `evermindEmbed.ts`, agent-runtime embedders |
| MEM-G114 | 3 brain-map UIs (Synapse JS, `EvermindBrainMap`, `EvermindBrain3D`) | One, on the shared 3D stage (`AE-G059`) | `I/app/ui/js/views/brain/*`, frontend builder, the canvas station |
| MEM-G115 | Name collisions: "memory" (RAM vs facts), "Evermind" (model vs facts vs console), "brain" (chat vs map) | Glossary + W rename `memory/` → `residency/` | W `packages/browser/src/memory` |
| MEM-G116 | W `memoryIntegration` re-implements chunk + BM25 + RRF + decay | Reuse M `retrieval`/`ingest` | `W/packages/browser/src/memoryIntegration/*` |

## 5. Chat: composer, transcript, streaming, persistence

Paths: BF = `Builderforce.ai`, I = `builderforce-inference`. The audit is read-only; anything not opened is marked UNVERIFIED.

### 5.1 Headline

The React hosts (web, canvas, VS Code, Chrome) already share the chat. They mount:

- from `@seanhogg/builderforce-brain-ui`: `AiSurface`, `BrainTimeline`, `BrainComposer`, `ToolConfirmBar`, `PendingQuestionBanner`, `StarterTile`, `PromptOptionsMenu`, `QueuedTurnChips`, `useVoiceDictation`;
- from `@seanhogg/builderforce-brain-embedded`: `useBrainConversation`, `useChatTurns`, `streamChatCompletion`, `createHostModelStream`, `createBrainRestPersistence`, `gatherChatDiagnostics`, the `composerCommands` registry.

The real duplication is in four places:

1. **Synapse** has its own vanilla-JS chat: composer, transcript, approval, streaming through `brain.rs`, and a copy of dictation.
2. **The agent-runtime TUI and the Lit Control UI** each have their own message model, their own tool cards and a third slash-command registry.
3. **Web legacy components:**
   - `ChatMessageContent.tsx` is a second markdown renderer.
   - `ChatMessageBubble.tsx` and `ChatMessageActions.tsx` duplicate the brain-ui message rows and actions.
4. **Pieces each host owns:** labels, starters, model-picker adapters, the transcript serializer and diagnostics.

### 5.2 Surfaces

| Surface | Shared pieces used | Implemented itself | Transport | Persistence |
|---|---|---|---|---|
| Web Brain panel `BF/frontend/src/components/brain/*` | composer, timeline, `AiSurface`, pickers, confirm, pending question, `useBrainConversation` | `ChatMessageContent`, `ChatMessageBubble`, `ChatMessageActions`, `WorkOptionsPicker`, `BrainCapabilityPicker`, `lib/brain/chatModes.ts`, `messageExport.ts` | SSE `/llm/v1/chat/completions`; `/api/brain/chats/:id/stream` for shared chats | `brain_chat_*` via `createBrainRestPersistence`; steps buffered in IndexedDB |
| Web `ChatInput` consumers (agent execution, dashboard, agent host, guest, manager) | composer | transcript drawn with `ChatMessageBubble`/`Content`; manager diagnostics (`managerChatDiagnostics.ts`, `ManagerCopyDiagnostics.tsx`) | same | `brain_chat_*`; the guest has its own routes; agent-host chat has its own store (`chatRoutes.ts`) |
| Canvas chat `creation-canvas/CanvasChatSurface.tsx`, `BrainSurface`, `BrainDock` | `SurfaceHeader`, timeline, `Avatar`, composer menu | canvas turn runner (`runCanvasGroupTurn.ts`, `useCanvasBrainTurn.ts`), `canvasDiagnosticsContext.tsx` | same | same |
| VS Code webview `clients/vscode/webview/src/chat/*` | nearly all of brain-ui; `useBrainConversation`, `useToolConfirmationGate`, `gatherChatDiagnostics` | `chatLabels.ts` (240 lines), `composerLabels.ts`, `editorStarters.tsx`, `useComposerModels.ts`, `diagnostics/transcript.ts` and `transcriptSections.ts`, `runDelta/*`, `SubagentStrip` | agent loop in the extension host (`brainRunHost.ts`); events sent to the webview with postMessage; SSE proxied by `hostFetch.ts` | local-first records via `hostPersistence.ts`, synced to `brain_chat_*` |
| Chrome side panel `clients/chrome/src/sidepanel/*` | composer, timeline, `AiSurface`, banners, starters, confirm | `ConfirmCard` (wraps `ToolConfirmBar`), `ModelPickerSection`, `rovrStarters`, `toolLabels`, `i18n/t`/`rovrLookup`; **no Copy diagnostics** | `createHostModelStream` → gateway SSE | IndexedDB `RovrRecords` with an outbox to `brain_chat_*` |
| Synapse `I/app/ui/js/views/chat.js`, `chat/*`, `approval.js`, `stepText.js`, `src-tauri/src/cloud/brain.rs` | **none** | everything: composer, transcript, live reply, approvals, step text, dictation copy | Rust `reply_in_background` emits Tauri `brain-reply`; also polls messages every 2 s or 6 s | API only (`limit=24`); no local store |
| TUI `BF/agent-runtime/src/tui/*`, `BF/packages/tui/src/*` | none | `ChatEntry` model, about 35 slash commands (`commands.ts`), model and agent pickers | gateway WebSocket (`delta`, `final`, `aborted`, `error`) | gateway sessions |
| Control UI `BF/agent-runtime/ui/src/ui/*` (Lit) | none | `message-normalizer.ts`, `tool-cards.ts`, `grouped-render.ts`, `copy-as-markdown.ts` | gateway WebSocket | gateway sessions |
| API `BF/api/src/presentation/routes/brainRoutes.ts` (893 lines), `chatRoutes.ts`, `guestRoutes.ts`, `llm/chatCompletionsRoutes.ts` | — | `application/brain/*` (`BrainService`, `brainMessageStore`, `chatStepStore`, `chatDiagnosticsStore`) | SSE, plus a room relay (SSE or WebSocket UNVERIFIED) | `brain_chats`, `brain_chat_messages`, `brain_chat_steps`, `brain_chat_diagnostics`; agent-host messages are separate |

### 5.3 Duplicate-responsibility matrix

| Capability | Survivor | Other copies |
|---|---|---|
| Composer | `brain-ui/src/composer/BrainComposer.tsx` | Synapse `chat/composer.js`; TUI input; `brain-embedded/src/ui/PromptInput.tsx` (may be dead, UNVERIFIED) |
| Markdown | `brain-ui/src/Markdown.tsx` | `frontend/src/components/ChatMessageContent.tsx` (own react-markdown setup, mermaid, save-fence, apply, create-file); Control UI `grouped-render.ts` |
| Message rows and actions | `brain-ui/src/timeline/MessageRows.tsx` and `MessageActions.tsx` | web `ChatMessageBubble`, `ChatMessageActions`, `BrainMessageActions` |
| Tool cards and step text | `brain-ui` `ToolStep`, `StepRows`, `ToolGroupRow`, `toolStepView.ts` | Control UI `tool-cards.ts`; Synapse `stepText.js`; TUI renderer |
| Approval | `brain-ui/src/ToolConfirmBar.tsx` | Synapse `approval.js` and `liveReply.js`; TUI approvals (the web and Chrome wrappers are fine) |
| Model picker | `brain-ui` `promptOptions/ModelPane.tsx` and `composer/composerModel.ts` | Chrome `ModelPickerSection.tsx`; VS Code `useComposerModels.ts`; web `useComposerOptions.ts` and `dockModelMenu.ts`; TUI `/model` |
| Slash-command registry | `brain-embedded/src/composerCommands/*` | VS Code `src/composerCommands/*` (host entries, fine); TUI `commands.ts` and `auto-reply/commands-registry.ts` (third and fourth registries, with hand-written help) |
| Streaming and event parse | `brain-embedded` `streamChatCompletion.ts` and `hostModelStream.ts` | Synapse `brain.rs` `model_turn`; TUI `tui-stream-assembler.ts`; Control UI `controllers/chat.ts` |
| Conversation store | `brain-embedded` `brainRestPersistence`, `localFirstPersistence`, `useBrainChats`, `useBrainConversation` | Synapse `chatStore.js` and `brain.rs`; agent-host store (`chatRoutes.ts`); TUI and Control UI gateway sessions |
| Transcript and diagnostics | `brain-embedded` `gatherChatDiagnostics`, `chatDiagnosticsReport`, `brainTriage` | VS Code `diagnostics/transcript.ts` and `transcriptSections.ts`; web `managerChatDiagnostics.ts`, `diagnosticsCapture.ts`, `diagnosticsReport.ts`; `canvasDiagnosticsContext.tsx`; `brain-ui/src/evermind/diagnosticsReport.ts` |
| Starters and work modes | `brain-ui/src/surface/StarterTiles.tsx`; `ModePane.tsx` and `brain-embedded/src/chatMode.ts` | VS Code `editorStarters.tsx`; Chrome `rovrStarters.tsx`; web `useComposerStarters.tsx`, `WorkOptionsPicker.tsx`, `BrainCapabilityPicker.tsx`, `lib/brain/chatModes.ts`; Chrome `runOptions.ts` |
| Voice | `brain-ui/src/useVoiceDictation.ts` | Synapse `chat/dictation.js` (its header says it is a verbatim copy); Spawn `desktop/spawn/ui/js/dictation.js` (UNVERIFIED) |
| Limits | `brain-embedded` `toolResultBudget`, `HISTORY_TOKEN_BUDGET`, `uploadUrls.ts` `ASSET_MAX_BYTES` | Synapse hardcodes `HISTORY=24`, `RECALL_CHARS=6000`, `RESULT_CHARS=16000` and a 5-minute approval wait; VS Code `attachmentLimits.ts` mirrors the API by comment |
| Labels | `brain-ui` `labelCatalog.ts` and `timelineCatalog.ts` | six label paths: web next-intl plus hand maps (`PERSONA_PATH`, `RECIPIENT_PATH`); VS Code `chatLabels.ts` and `composerLabels.ts`; Chrome `i18n/t` plus a `QUEUED_KEY` map (`$1` vs `{model}`); Synapse `i18n.js`; TUI English literals; Control UI `ui/src/i18n` |

### 5.4 Data-model overlaps

- **Messages.** `BrainMessage` (`brain-embedded/src/types.ts`) is canonical; the API row adds `eventKey`. Steps are role `tool` with `metadata.kind = 'step'`, stored in `brain_chat_steps` and merged back by `chatStepStore.mergeSteps`. Other shapes:
  - Synapse uses untyped JSON plus `live` and `replyError`.
  - The TUI uses `ChatEntry`.
  - The Control UI normalizes `unknown` messages itself.
  - Agent-host chat has a separate messages table.
- **Conversations.** `brain_chats` with `chatMode`. Chrome `LocalChat`, VS Code local-first records and TUI sessions meet the cloud chat only through sync (`chatIdentity.boundServerId`). TUI sessions never do.
- **Stream events.** There is no shared vocabulary:
  - TUI: `delta`, `final`, `aborted`, `error`;
  - Synapse: `brain-reply`;
  - gateway SSE: `chat.completion.chunk`;
  - VS Code: `run.*` over the bridge;
  - API room stream: its own events.

### 5.5 Target design

- **brain-ui owns everything on screen**, including:
  - markdown, with hooks for mermaid, save-fence, apply and internal links;
  - message rows and actions, with web-only actions (export) injected as data;
  - starter and model-picker rendering; hosts supply only data adapters.
- **brain-embedded owns the conversation:**
  - the store, persistence and the turn controller;
  - stream parsing;
  - the transcript serializer, moved up from VS Code so web and Chrome get Copy transcript;
  - limits, one exported constants module that every host imports;
  - the composer-command registry, which the TUI also reads.
- **One run-event vocabulary.** Define `RunEvent` once (`run.start`, `run.delta`, `run.step`, `run.confirm`, `run.final`, `run.error`). Adapters translate gateway WebSocket, Tauri and SSE into it, so every host shows the same states and diagnostics.
- **One label catalog.** Use brain-ui `labelCatalog` keys; hosts provide a `t(key)` adapter only and delete their key-mapping tables.
- **Synapse.** Under the IDE rebuild, the chat is the VS Code extension's webview chat running inside OpenVSCode Server, so the vanilla-JS chat, the `brain.rs` chat and `dictation.js` are deleted rather than ported. Until then, share the limits.
- **TUI and Control UI.** These stay separate renderers (terminal and Lit), but they consume the shared registry, `RunEvent` and the message normalizer.

### 5.6 Migration order

1. Shared limits module, plus a test that each host imports it (cheap; it removes the drift).
2. Move the transcript serializer from VS Code into brain-embedded. Use it in web, canvas and Chrome, which adds Copy diagnostics to Chrome.
3. Extend brain-ui `Markdown` with the web hooks. Then delete `ChatMessageContent`, `ChatMessageBubble` and `ChatMessageActions` and move manager, guest and agent-execution to `BrainTimeline`.
4. Label catalog: switch Chrome, web and VS Code to `labelCatalog` adapters and delete the key-mapping tables.
5. Model-picker and starter adapters: keep only the data, rendered by brain-ui.
6. Define `RunEvent` and add adapters for the TUI and Control UI; have the TUI read the shared command registry.
7. Merge the agent-host chat store into `brain_chat_*`: expand/contract migration, `agent_host_id` as a column.
8. Synapse: removed by the IDE rebuild.

### 5.7 Gaps

| ID | Gap | Fix | Where |
|---|---|---|---|
| CHAT-G001 | Second markdown renderer on the web | Extend brain-ui `Markdown`, then delete the copy | `frontend/src/components/ChatMessageContent.tsx` |
| CHAT-G002 | Web message bubble and actions duplicate brain-ui rows | Fold into `MessageRows`/`MessageActions`; inject export | `ChatMessageBubble.tsx`, `ChatMessageActions.tsx`, `BrainMessageActions.tsx` |
| CHAT-G003 | Manager, guest and agent-execution panels draw their own transcript | Mount `BrainTimeline` | `ManagerChatPanel.tsx`, `GuestBrainPanel.tsx`, `AgentExecutionPanel.tsx` |
| CHAT-G004 | Transcript serializer lives only in VS Code | Move to brain-embedded | `webview/src/diagnostics/transcript.ts`, `transcriptSections.ts` |
| CHAT-G005 | Chrome has no Copy diagnostics | Use the shared serializer and report | `clients/chrome/src/sidepanel/*` |
| CHAT-G006 | Four diagnostics report builders | One `chatDiagnosticsReport`; canvas and manager supply sections | `managerChatDiagnostics.ts`, `diagnosticsCapture.ts`, `diagnosticsReport.ts`, `canvasDiagnosticsContext.tsx` |
| CHAT-G007 | Model-picker rendering in three hosts | Data adapters only → `ModelPane` | Chrome `ModelPickerSection.tsx`, VS Code `useComposerModels.ts`, web `useComposerOptions.ts`, `dockModelMenu.ts` |
| CHAT-G008 | Starter and work-mode tiles built per host | Starter data into `StarterTiles`; modes from `chatMode.ts` | `editorStarters.tsx`, `rovrStarters.tsx`, `useComposerStarters.tsx`, `WorkOptionsPicker.tsx`, `BrainCapabilityPicker.tsx`, `lib/brain/chatModes.ts`, Chrome `runOptions.ts` |
| CHAT-G009 | Six label paths and hand key maps | One `labelCatalog` plus a `t()` adapter per host | `chatLabels.ts`, `composerLabels.ts`, Chrome `QUEUED_KEY`, web `PERSONA_PATH`/`RECIPIENT_PATH` |
| CHAT-G010 | Limits copied per host | One exported limits module, with a test | Synapse constants, VS Code `attachmentLimits.ts`, brain-embedded budgets |
| CHAT-G011 | Third and fourth slash-command registries with hand-written help | TUI reads `composerCommands`; help is generated | `agent-runtime/src/tui/commands.ts`, `auto-reply/commands-registry.ts` |
| CHAT-G012 | No shared run-event vocabulary | `RunEvent` plus transport adapters | TUI assembler, Control UI controller, Synapse `brain.rs`, VS Code bridge |
| CHAT-G013 | Control UI has its own message normalizer, tool cards and copy-as-markdown | Consume the shared normalizer and serializer | `agent-runtime/ui/src/ui/chat/*` |
| CHAT-G014 | Agent-host chat uses a second message store | Fold into `brain_chat_*` (expand/contract) | `api/src/presentation/routes/chatRoutes.ts` and its tables |
| CHAT-G015 | Synapse chat is a full fork: composer, transcript, approval, streaming, polling | Removed by the Synapse IDE rebuild (the VSIX chat) | `I/app/ui/js/views/chat.js`, `chat/*`, `approval.js`, `stepText.js`, `src-tauri/src/cloud/brain.rs` |
| CHAT-G016 | Dictation copied into Synapse (and Spawn) | Deleted with CHAT-G015; until then, one plain-JS build of the core of `useVoiceDictation` | `I/app/ui/js/chat/dictation.js`, `desktop/spawn/ui/js/dictation.js` |
| CHAT-G017 | `PromptInput.tsx` in brain-embedded may be dead | Verify references; delete if unused | `brain-embedded/src/ui/PromptInput.tsx` |
| CHAT-G018 | No tests for Synapse chat, Chrome diagnostics or shared limits | Tests come with CHAT-G005 and CHAT-G010; Synapse via CHAT-G015 | — |

## 6. Shell, terminal and file tools

Paths are relative to `Builderforce.ai` unless marked I (`builderforce-inference`) or W (`builderforce-webcontainers`). The audit is read-only; items not opened are marked UNVERIFIED. Synapse and the Chrome extension have no shell or file tools. builderforce-memory has none either.

### 6.1 Headline

- **The tool definitions are already shared** in `packages/agent-tools` (`run_command`, `read_file`, `write_file`, `edit_file`, `delete_file`, `list_files`, plus `command_status`, `command_stop` and `output_filter`). Each host backs them with a `CapabilityProvider`.
- **What is duplicated is the code beneath them:**
  - path containment, about 11 copies;
  - process-tree kill, 4 copies;
  - shell job tables, 3 copies;
  - command runners, 5 copies;
  - file walkers, 3 copies;
  - output caps and timeouts hard-coded per host;
  - tool-name tables spread over more than 8 files.
- **agent-runtime's native loop** still exposes its own `read`, `exec`, `process` and `apply_patch`. Only `write`, `edit` and `delete` are converged (`converged-coding-tools.ts`).

### 6.2 Inventory: command execution

| Host | Path | Limits | Policy | Tests |
|---|---|---|---|---|
| Shared definition | `packages/agent-tools/src/core-tools.ts:587`, `shell-tools.ts` | `yieldMs` ≤ 10 min; `cwdArg` rejects absolute paths and `..`; `compressShellResult` | branch-switch guard, command-shape and segment checks; no allow/deny list | `shell-tools*.test.ts`, `branch-switch*.test.ts` |
| VS Code host | `clients/vscode/src/tools/localShell.ts`, `localShellJobs.ts`, `localShellOutputs.ts`, `processTree.ts` | 10 min; 4 MB buffer; 60,000 chars returned; 32 jobs; 4 MB kept per job | kills the whole tree; jobs end with the run; runs as the user, with no command policy | `localShell*.test.ts` |
| Cloud container | `api/container/sandboxCore.mjs`, `sandboxJobs.mjs`, `server.mjs` | 10 min; 60,000 chars; 32 jobs | dedicated shell user, trusted `PATH`, scrubbed env, isolation self-check, git mirror, egress trust | UNVERIFIED |
| agent-runtime native `exec`/`process` | `agent-runtime/src/agents/bash-tools.exec.ts` (1101 lines), `bash-tools.process.ts` (680), `bash-process-registry.ts`, `shell-utils.ts`, `src/process/kill-tree.ts` | 200,000 captured, 30,000 pending; timeout in **seconds**; jobs live 30 min to 3 h; PTY support | **the only allowlist and approval system** (`infra/exec-approvals*.ts`, `gateway/exec-approval-manager.ts`, `node-command-policy.ts`) | many |
| Browser (web Brain) | `frontend/src/lib/browserRuntime/workspaceShell.ts` → W `bfsh -c` | 5 min; output is the **tail**, 16,000 chars; saved-back files ≤ 1 MB | code scan and build gate; no jobs or background runs | `workspaceShell*.test.ts` |
| Other VS Code spawn sites | `verify/execRunner.ts`, `verify/targetedTests.ts`, `runDelta/analyzers/nodeAnalyzerExec.ts`, `knowledge/knowledgeShell.ts`, `child/childRunSpawner.ts`, plus about 30 more | each sets its own limits | — | various |
| Terminal UI | `frontend/src/components/Terminal.tsx` (xterm; the only terminal component) | — | — | — |

### 6.3 Inventory: file tools

- **Shared:**
  - `core-tools.ts` definitions;
  - `edit.ts` and `edit-match.ts` (`applyStringEdit`, ≤ 20 edits per call);
  - `fileRead.ts` and `fileWindow.ts` (≤ 8 paths, 64,000-character whole-read cap);
  - `glob.ts`;
  - `writeOverwriteGuard.ts` and `writeScope.ts`.
- **Providers:**
  - on-prem `agent-runtime/src/agents/node-capability-provider.ts`;
  - sandbox `sandbox-capability-provider.ts`, which has its own `resolveInsideRoot` (line 101) and its own walker;
  - VS Code `clients/vscode/src/tools/localCapabilities.ts`, with 2 MB reads and lists of 5,000 scanned and 400 returned;
  - container `api/container/workspaceAgent.mjs`, with `insideClone` and a hand-copied `dirMayContainGlobMatch`;
  - Worker/API `api/src/application/ide/workspaceStore.ts` and `worker/src/lib/workspacePath.ts`, both using `packages/workspace-path`;
  - browser `frontend/src/lib/browserRuntime/coding.ts` and `workingTree.ts` (UNVERIFIED);
  - MCP `packages/workspace-mcp/src/workspaceFiles.ts`, which re-checks with realpath.
- **Native agent-runtime tools:**
  - `native-file-tools.ts` (`read` ≤ 2,000 lines / 50 KB; its own BOM- and CRLF-tolerant edit matcher);
  - `apply-patch.ts` and `apply-patch-update.ts` (real patch syntax, `assertSandboxPath`).
- **Containment helpers**, all separate:
  - `sandbox-paths.ts:149`;
  - `sandbox/fs-paths.ts:227,235`;
  - `infra/path-safety.ts:8`;
  - `security/scan-paths.ts:3`;
  - `commands/cleanup-utils.ts:49`;
  - `agents/identity-avatar.ts:49`;
  - `extensions/bluebubbles/src/media-send.ts:73`;
  - VS Code `knowledge/sourcePort.ts:37` (realpath) and `knowledgeFixPaths.ts:29`;
  - container `insideClone`.

### 6.4 Duplicate-responsibility matrix

| Capability | Survivor | Other copies |
|---|---|---|
| Path containment | `packages/agent-tools/src/node-path.ts` (`resolveInsideRoot`, `resolveInsideRootOrThrow`, `resolveShellCwd`), plus a new realpath variant | the 11 helpers in §6.3 |
| R2/IDE key validation | `packages/workspace-path` | none found |
| Process-tree kill | `clients/vscode/src/process/killTree.ts` (taskkill from `%SystemRoot%`), moved to a shared node subpath, with agent-runtime's graceful-then-forced option | `vscode tools/processTree.ts`, `agent-runtime/src/process/kill-tree.ts`, `agents/shell-utils.ts:153`, `api/container/sandboxJobs.mjs:186` |
| Shell job table | `api/container/sandboxJobs.mjs` `createJobTable` | `vscode localShellJobs.ts` (`MAX_JOBS = 32` copied), `bash-process-registry.ts` |
| Command runner | `api/container/sandboxCore.mjs` `runShell` | `localShell.ts`, `bash-tools.exec-runtime.ts`, `workspaceShell.ts`, `verify/execRunner.ts` |
| Output caps and timeouts | `packages/tool-output-policy/src/caps.ts` (`SHELL_CAPTURE_CHARS`) | `localShell.ts:31-33`, `workspaceShell.ts:43,46`, `native-file-tools.ts`, `localCapabilities.ts`, `sandboxCore.mjs:34`, `bash-tools.exec.ts:226` |
| File walk and list | `agent-tools/src/glob.ts` plus one node walker | `node-capability-provider.ts:73`, `sandbox-capability-provider.ts:68`, `localCapabilities.ts:48`; `workspaceAgent.mjs:364` (hand-copied) |
| String edit | `agent-tools/src/edit.ts` `applyStringEdit` | `native-file-tools.ts` edit |
| Tool-name tables | `agent-tools/src/toolAliases.ts` | agent-runtime `tool-policy.ts`, `coding-tools.policy.ts`, `tool-mutation.ts`, `sandbox/constants.ts`, `tool-retry.ts`, `tool-display.json`; `brain-embedded/src/localWorkspaceTools.ts`; api `writeAheadAllowlist.ts`; `agent-tools` `tool-mutation.ts` and `tool-side-effect.ts` |
| Command policy and approvals | `agent-runtime/src/infra/exec-approvals*.ts`, ported to `agent-tools` | none (that is the gap) |

### 6.5 Inconsistencies

- **Tool names.** The shared tools are `run_command`, `read_file`, `write_file`, `edit_file` and `list_files`; native ones are `exec`, `process`, `read`, `write`, `edit` and `apply_patch`. The `apply_patch` → `edit_file` alias maps a patch-syntax call onto a unique-string replace, which has a different contract.
- **Timeouts.** VS Code and the container use 10 min, the browser 5 min. Native `exec` takes seconds where the container API takes milliseconds.
- **Output caps.** Returned output is 60,000 characters (VS Code and container), 16,000 (browser, tail only) or 200,000 (native). Whole-file reads are capped at 64,000 characters (shared), 2 MB (VS Code) or 2,000 lines / 50 KB (native). Whether each host keeps the head or the tail is UNVERIFIED.
- **Containment rules differ:**
  - `node-path.ts` splits on the separator; `sandbox-capability-provider.ts:101` uses `startsWith("..")`, which wrongly rejects a legitimate name like `..foo`.
  - Only 2 of the 11 helpers resolve symlinks.
  - Absolute paths inside the root are accepted by `node-path.ts` but rejected by `cwdArg`.
- **Error shapes.** Errors come as `{ok:false, error}`, a thrown `PathEscapesRootError`, or a native `AgentToolResult`, and the wording differs per host.
- **Kill.** Graceful-then-forced exists only in agent-runtime; VS Code and the container kill the process group straight away.

### 6.6 Target design and order

1. **Containment.** `node-path.ts` gains `resolveInsideRootReal` (realpath, borrowed from `sourcePort.ts`). Every read/write/edit provider uses it, and the local helpers are deleted. This also fixes the `..foo` bug.
2. **Tree kill.** One shared `node-process` subpath in `agent-tools`: taskkill from `%SystemRoot%`, an optional grace period. Fold the other 4 copies into it.
3. **Caps and timeouts.** `tool-output-policy` exports `SHELL_CAPTURE_CHARS`, `DEFAULT_COMMAND_TIMEOUT_MS` and the read caps; hosts import them. The container gets them through the existing hash-checked generator.
4. **One node file walker, plus generating `dirMayContainGlobMatch`** into the container with `scripts/gen-container-shared.mjs`.
5. **Tool names.** One table in `agent-tools` consumed by the agent-runtime policy files. Fix the `apply_patch` alias by giving `edit_file` patch syntax, or by removing the alias.
6. **Converge the native `read` and `exec`/`process`** onto the shared definitions, or document why each stays.
7. **Command policy.** Port `exec-approvals` into `agent-tools` as a deny-list plus a confirm port, applied by the VS Code and browser shells.
8. **Job table.** One job-table module shared by the container and VS Code.
9. **Conformance suite.** One test suite run against all four providers: containment, caps, error shape, kill.
10. **Terminal.** Any new terminal (Synapse IDE, VS Code) reuses `frontend/src/components/Terminal.tsx`; under the IDE rebuild, VS Code's own terminal is used.

### 6.7 Gaps

| ID | Gap | Where |
|---|---|---|
| SHELL-G001 | Sandbox provider containment uses `startsWith("..")` and wrongly rejects `..foo` | `agent-runtime/src/agents/sandbox-capability-provider.ts:101` |
| SHELL-G002 | The shared resolver does not resolve symlinks (details in the local security findings file) | `packages/agent-tools/src/node-path.ts`, `localCapabilities.ts`, `node-capability-provider.ts` |
| SHELL-G003 | Four tree-kill implementations | `clients/vscode/src/process/killTree.ts`, `clients/vscode/src/tools/processTree.ts`, `agent-runtime/src/process/kill-tree.ts`, `agent-runtime/src/agents/shell-utils.ts`, `api/container/sandboxJobs.mjs:186` |
| SHELL-G004 | Bare `taskkill` resolved from `PATH` (details in the local security findings file) | `processTree.ts`, `kill-tree.ts`, `shell-utils.ts` |
| SHELL-G005 | Output caps hard-coded per host | `localShell.ts:32-33`, `workspaceShell.ts:46`, `native-file-tools.ts`, `localCapabilities.ts` |
| SHELL-G006 | Timeout defaults and units differ (seconds vs ms; 5 vs 10 min) | `localShell.ts:31`, `sandboxCore.mjs:34`, `workspaceShell.ts:43`, `bash-tools.exec.ts:226` |
| SHELL-G007 | The `apply_patch` alias points at `edit_file`, which has a different contract | `packages/agent-tools/src/toolAliases.ts`, `agent-runtime/src/agents/apply-patch.ts` |
| SHELL-G008 | Native `read`, `exec` and `process` are not converged onto the shared tools | `converged-coding-tools.ts`, `native-file-tools.ts`, `bash-tools.exec.ts` |
| SHELL-G009 | No command policy outside agent-runtime (details in the local security findings file) | `shell-tools.ts`, `localShell.ts`, `workspaceShell.ts`, `infra/exec-approvals*.ts` |
| SHELL-G010 | `LIST_MAX_FILES` and the file walker copied three times | `node-capability-provider.ts:73`, `sandbox-capability-provider.ts:68`, `localCapabilities.ts:48` |
| SHELL-G011 | Glob pruning copied by hand into the container | `api/container/workspaceAgent.mjs:364`, `agent-tools/src/glob.ts` |
| SHELL-G012 | Job tables duplicated (`MAX_JOBS = 32` in two places) | `localShellJobs.ts:49`, `sandboxJobs.mjs:57`, `bash-process-registry.ts` |
| SHELL-G013 | The native edit matcher duplicates `applyStringEdit` | `native-file-tools.ts`, `agent-tools/src/edit.ts`, `edit-match.ts` |
| SHELL-G014 | Tool-name tables spread over more than 8 files | see §6.4 |
| SHELL-G015 | Error shape and wording differ by host | all providers; target `{ok:false, error, code}` |
| SHELL-G016 | The browser shell has no jobs, background runs or tree cancel | `workspaceShell.ts`, W `packages/browser/src/node/processHost.ts` |
| SHELL-G017 | No cross-host conformance suite for file and command tools | — |
| SHELL-G018 | Only one terminal component; new hosts must reuse it, not fork it | `frontend/src/components/Terminal.tsx` |

## 7. Auth, device sign-in and the cloud API client

Paths: BF = `Builderforce.ai`, I = `builderforce-inference`, M = `builderforce-memory`, W = `builderforce-webcontainers`. The audit is read-only; items not opened are marked UNVERIFIED. Security-sensitive observations are kept in the gitignored local security findings file (`AUTH-G015` to `AUTH-G019`) and only referenced here.

### 7.1 Headline

- **The server side is single:**
  - `authRoutes.ts` (1224 lines), `oauthRoutes.ts`, `passkeyRoutes.ts`, `vscodeRoutes.ts` and `sessionIntrospectRoutes.ts`;
  - JWTs verified through `packages/hs256-jwt` in both the API and the Worker;
  - revocation through `packages/session-introspection`.
- **The device flow is shared in TypeScript** (`packages/device-auth`, RFC 8628).
- **The client side is not shared.** Three copies of "editor key → base JWT → workspace JWT" exist:
  - VS Code `bfApi/session.ts`;
  - Chrome `auth/session.ts`;
  - Synapse/Spawn `bf-cloud/session.rs`.
- **The authenticated-fetch and 401 behaviour differs per host,** and the error-flattening helper is copied four times.
- **agent-runtime hand-builds `Authorization: Bearer` in about 56 files,** and reads `BUILDERFORCE_URL` with an inline fallback in about 18.

### 7.2 Clients

| Host | Sign-in | Credential storage | Session and refresh | Authed fetch and 401 | Tests |
|---|---|---|---|---|---|
| Web `frontend/src/lib/{auth.ts, auth/*, apiClient.ts, builderforceApi.ts}` | password, MFA, OAuth, SSO, magic link, passkey | web JWT and tenant JWT (see `AUTH-G015`) | no refresh; tenant JWT through `/api/auth/tenant-token` | `apiRequest`: 401 clears the session and redirects to `/login`; 402 becomes a plan-limit error | `apiClient*.test`, `auth.test`, `AuthContext*.test` |
| VS Code `clients/vscode/src/{auth/auth.ts, bfApi/session.ts, bfApi/transport.ts}` | `packages/device-auth`, with a paste-key fallback | `bfk_*` key in SecretStorage | key → `/api/auth/tenant-api-key-token` → `/api/vscode/tenants/:id/token`; 60 s margin, single-flight, epoch guard, park/drop workspace | `authed`: 401 forces a re-mint and retries once; 60 s timeout; `asTenant` pin | `session.mint`, `session.park`, `transport`, `gatewayAuth`, `editorKeyGuard` |
| Chrome `clients/chrome/src/{auth/session.ts, api/apiClient.ts}` | device flow (SettingsView, UNVERIFIED) | key in `chrome.storage.local` (see `AUTH-G016`) | same exchange; 60 s margin; a 400/401 on exchange clears the session; **no workspace switch** | **no 401 retry**; `ApiError{status}`; `Idempotency-Key` | `apiClient.test.ts` (11 lines), `config.test` |
| Synapse/Spawn `I/crates/bf-cloud/{device.rs, session.rs, account.rs, error.rs}` | **Rust copy of the device flow** | OS keyring (`bf-vault`), no plaintext fallback | same exchange; assumes 900 s when the server omits `expiresIn` (TypeScript hosts assume 3600 s) | `Session::api` retries once on 401 under a Mutex | 6 unit tests |
| agent-runtime `agent-runtime/src/commands/builderforce-connect.ts`, `infra/builderforce-relay.ts`, `run-context-client.ts` | `BUILDERFORCE_TOKEN` → `POST /api/agent-hosts` → API key | `~/.builderforce/.env` (see `AUTH-G017`) | static key | about 56 hand-built Bearer sites; no shared client | none for auth |
| SDK `BF/sdk/src/infrastructure/httpClient.ts` | — | caller-supplied key | static | rich `BuilderforceApiError`, 180 s timeout, no 401 refresh | yes |
| Memory `M/memory/src/wire/chatClient.ts`, `cache/FetchSemanticCacheBackend.ts` | — | static key | static | no 401 logic | — |
| brain-embedded `createBrainRestPersistence` | — | host-injected `getToken` | host re-mints | the host's request layer | yes |

### 7.3 Duplicate-responsibility matrix

| Capability | Survivor | Other copies |
|---|---|---|
| Device flow | `packages/device-auth` | `I/bf-cloud/src/device.rs` (Rust; kept native, but pinned by a shared fixture) |
| Editor-key session (exchange, margin, single-flight, workspace switch, rejected-key event) | VS Code `bfApi/session.ts`, **extracted** host-neutral into `packages/editor-session` (injected storage, fetch, clock) | Chrome `auth/session.ts`; `I/bf-cloud/session.rs` (Rust; fixture) |
| Authed fetch with a forced re-mint and one retry on 401 | VS Code `bfApi/transport.ts`, extracted with the session | Chrome `createAuthenticatedFetch`; Rust `Session::api`; the agent-runtime sites |
| Error flattening (`{error}` vs `{error:{message,code}}`) | `frontend/src/lib/apiClient.ts` `flattenErrorBody`, moved to a shared package | Chrome `flattenErrorMessage` (its comment admits it is a copy); SDK parser; Rust `CloudError::from_ureq`, which misses the nested form |
| Base URL and web-origin derivation | none; add one resolver | VS Code `appUrl()` and `webUrl`; Rust `web_base_of`; frontend `apiOrigin.ts`; Chrome `PLATFORM_ORIGINS` |
| Key revoke on sign-out | `device-auth` `revokeKey` | Rust `sign_out` (inline) |
| JWT verify | `packages/hs256-jwt` | none |

### 7.4 Inconsistencies

- **Default base URL.** VS Code, Chrome and Synapse use `https://builderforce.ai/gateway`; web, agent-runtime, the SDK and the memory docs use `https://api.builderforce.ai`.
- **Configuration names:**
  - Synapse: `BUILDERFORCE_URL` and `SYNAPSE_BUILDERFORCE_URL`;
  - VS Code: `builderforce.baseUrl` and `builderforce.webUrl`;
  - web: `NEXT_PUBLIC_AUTH_API_URL` and `NEXT_PUBLIC_WORKER_URL`;
  - agent-runtime: `BUILDERFORCE_URL`, `_API_KEY`, `_TOKEN`, `_WEB_URL`, `_GATEWAY_URL`, `_AGENTS_LINK_URL` and `_AGENTS_GATEWAY_TOKEN`;
  - memory: `BUILDERFORCE_MEMORY_TOKEN`.
- **Refresh.** The web has none and signs out on 401. Editor hosts re-mint short JWTs from a long-lived key, but only VS Code has a forced retry plus single-flight.
- **Rejected key.** VS Code fires an event, Chrome clears the session, and Rust returns `KeyRejected` and signs out.
- **Workspace switch.** The web uses `/api/auth/tenant-token`. VS Code and Rust use `/api/vscode/tenants/:id/token`, a VS Code-named route used by non-VS Code clients. Chrome has no workspace switch.
- **Expiry fallback.** 3600 s in TypeScript vs 900 s in Rust.
- **Stale doc paths** in the `packages/device-auth/src/index.ts` header (`clients/vscode/src/auth.ts`, `bfApi.ts`).
- **Rust device poll** swallows non-status errors and has no distinct `cancelled` reason.

### 7.5 Target design and order

1. **Fix the doc paths and the expiry constant** (cheap). The server always sends `expiresIn`, and clients share one fallback.
2. **Extract `packages/editor-session`** from VS Code `bfApi/session.ts` and `transport.ts`, with no `vscode` imports. VS Code consumes it unchanged (its tests are the parity oracle). Chrome adopts it, which brings the 401 retry and the workspace switch.
3. **Shared error flattening and base-URL resolver.** One helper used by web, Chrome, VS Code and the SDK, plus one table documenting every configuration name; deprecate the aliases.
4. **One `builderforceClient` for agent-runtime.** Replace the hand-built Bearer sites and the `BUILDERFORCE_URL` fallbacks.
5. **Rust parity.** `bf-cloud` keeps native code, but a shared JSON fixture (device statuses, exchange responses, error bodies) runs in both the TypeScript and Rust tests. Under the Synapse IDE rebuild, the VS Code extension's session replaces it.
6. **Workspace-switch route.** Alias `/api/vscode/tenants/:id/token` under a host-neutral name (`/api/auth/workspace-token`), with expand/contract.
7. **Security items** `AUTH-G015` to `AUTH-G019`: see the local security findings file. `AUTH-G015` needs a product decision.

### 7.6 Gaps

| ID | Gap | Where |
|---|---|---|
| AUTH-G001 | Rust device flow duplicates TypeScript; no shared contract fixture | `I/crates/bf-cloud/src/device.rs`, `packages/device-auth` |
| AUTH-G002 | Three copies of the editor-key session | VS Code `bfApi/session.ts`, Chrome `auth/session.ts`, `I/bf-cloud/session.rs` |
| AUTH-G003 | Chrome has no 401 forced-refresh retry | `clients/chrome/src/api/apiClient.ts` |
| AUTH-G004 | Chrome has no workspace switch | `clients/chrome/src/auth/session.ts` |
| AUTH-G005 | agent-runtime has about 56 hand-built Bearer fetches and about 18 `BUILDERFORCE_URL` fallbacks | `agent-runtime/src/{infra,builderforce,commands}/*` |
| AUTH-G006 | Default base URL split (`api.` vs `/gateway`) | all clients |
| AUTH-G007 | Inconsistent configuration names and aliases | see §7.4 |
| AUTH-G008 | Error flattening copied four times; Rust misses the nested form | `frontend/src/lib/apiClient.ts`, `clients/chrome/src/api/apiClient.ts`, `sdk/src/infrastructure/httpClient.ts`, `I/bf-cloud/src/error.rs` |
| AUTH-G009 | `expiresIn` fallback differs (3600 vs 900) | VS Code, Chrome, Rust session code |
| AUTH-G010 | Stale paths in the `device-auth` header comment | `packages/device-auth/src/index.ts` |
| AUTH-G011 | The web has no refresh; an expired token means a hard logout | `frontend/src/lib/apiClient.ts`, `auth/session.ts` |
| AUTH-G012 | Auth-client test gaps: Chrome (11 lines), Rust (6), agent-runtime (none) | — |
| AUTH-G013 | Web origin derived from the API URL by hand in Rust and VS Code | `I/bf-cloud/src/lib.rs` `web_base_of`, VS Code `appUrl()` |
| AUTH-G014 | Not yet audited: Chrome SettingsView sign-in, W `aiGateway`/`hostRelay`, `packages/knowledge-client`, `packages/provider-connect` | — |
| AUTH-G015–G019 | Security-sensitive; details in the local security findings file | — |
| AUTH-G020 | The workspace-switch route is VS Code-named but used by every editor host | `api/src/presentation/routes/vscodeRoutes.ts` |

## 8. Security policy engines

Paths: BF = `Builderforce.ai`, W = `builderforce-webcontainers`, I = `builderforce-inference`, M = `builderforce-memory`. The audit is read-only; items not opened are marked UNVERIFIED. Exploitable observations are in the gitignored local security findings file (`SECP-G011`, `SECP-G013` to `SECP-G015`, and the memory part of `SECP-G004`) and are only referenced here.

### 8.1 Headline

Three good shared cores already exist:

- **`packages/code-shield`**, the scanner:
  - secret, SAST, behaviour and obfuscation rules, plus a signature set and manifest/typosquat heuristics;
  - profiles `pr-diff`, `skill-install`, `runtime` and `visualizer`;
  - a 0–100 risk score mapped to an action;
  - runs in the browser, Node and the API Worker.
- **`packages/secret-redaction`**, the redactor: about 25 `SECRET_SHAPES`, used by about 10 consumers.
- **`packages/sarif`**, the finding format: `NormalizedFinding`, `normalizeSeverity`, SARIF emit and parse.

There is one incident writer: `findingIncidentKinds.ts` writes `security_incidents`, deduped on `source_ref`, and records a governance audit entry.

The duplication sits around these cores:

- secret regexes outside `secret-redaction`;
- about 8 severity scales;
- a reason-code list mirrored by hand between W and the API;
- run-delta security rules that re-implement code-shield SAST;
- 3 sets of prompt-injection patterns;
- 6 unrelated egress mechanisms;
- 2 hosts with no policy at all (I, and M's fact storage).

### 8.2 Engines

| Engine | Path | Runs in | Output | Goes to |
|---|---|---|---|---|
| code-shield | `BF/packages/code-shield` | browser worker, Node, API Worker | `ScanFinding` (CRITICAL..LOW, category, weight, ATT&CK id); `ScanReport.complete` | PR gate `api/src/domain/security/diffScanRules.ts`; agent-runtime `security/skill-scanner.ts`; frontend `browserRuntime/codeScanner.ts`; knowledge badges `agent-tools/src/knowledge/{codeFileBadges.ts, rules/securityRisk.ts}` |
| secret-redaction | `BF/packages/secret-redaction` | everywhere | redacted text and JSON; `findSecretShapes` | api `redactSecrets.ts`, `contentTrust.ts`, `packageReview.ts`; agent-runtime `logging/redact.ts`; `interaction-contract`; `builderforce-mcp/policy.ts`; VS Code `childCoverage.ts`; run-delta `secretAdded`; `agent-env` |
| Runtime Shield | `W/packages/browser/src/security/{shieldRules, securityEvent, shieldTelemetry, ingressLimit}.ts`, `W/packages/core/src/system/{securityContext, codeScanner}.ts` | browser tab | `SecurityEvent` with 26 `ShieldReasonCode`s → severity and action | `POST /api/security/shield-incidents` (`runtimeShieldRoutes.ts`, `runtimeShieldEvent.ts`, `runtimeShieldIncidents.ts`) → `security_incidents` |
| API pipeline | `prSecurityGate.ts`, `securityMergeGate.ts`, `prSecurityScan.ts`, `prSecurityReview.ts`, `prSecurityOverride.ts`, `osvScaScan.ts`, `advisoryFeed.ts`, `githubAlerts.ts`, `WebSecurityScanner.ts`, `SecurityAuditService.ts`, `vulnerabilityFindings.ts`, `criticalFindingIncidents.ts`, `governanceAuditor.ts`, `policyPackService.ts` | API | `vulnerability_findings`, `security_incidents` | Security UI and incidents |
| agent-runtime policy | `security/{audit*, dangerous-tools, external-content, instruction-firewall, skill-scanner}.ts`, `gateway/node-command-policy.ts`, `infra/{exec-approvals*, host-egress}.ts`, `agents/tools/governance-audit/matchers.ts` | local gateway and agent | `SecurityAuditFinding` (info/warn/critical); approvals; deny-lists | local UI and logs |
| run-delta rules | `BF/packages/run-delta/src/rules/*` (`secretAdded`, `rmRf`, `tlsVerifyDisabled`, `weakCrypto`, `corsPermissive`, `cspPermissive`, `cookieInsecure`, `installScriptAdded`, `workflowPermissive`) | VS Code and API | run-delta findings (error/warn) | run-delta records |
| Egress and CSP | api `workerEgressPolicy.ts` (signed, per app), `workerEgressGrant.ts`, `workerEgressDeclarations.ts`, `runtime/sandbox/egressAllowlist.ts`, `api/container/egressTrust.mjs`, `workerCsp.ts`, `cspReports.ts`; W `previewEgress.ts`, `previewCsp.ts`; agent-runtime `infra/host-egress.ts`; frontend `middleware.ts` CSP (UNVERIFIED) | various | — | — |
| Other | VS Code `models/modelFallbackDetail.ts` (its own redactor); M `cognition/sanitize.ts` (recall injection only); I `crates/bf-vault`, `src-tauri/src/agents/secrets.rs`, `bf-teach` password redaction | — | — | — |

### 8.3 Duplicate-responsibility matrix

| Capability | Survivor | Other copies |
|---|---|---|
| Secret detection | `secret-redaction` `SECRET_SHAPES` | `code-shield/src/rules/secretRules.ts` (6 rules, own regexes); agent-runtime `governance-audit/matchers.ts` `SECRET_PATTERNS`; W `securityEvent.ts` `SECRET_ASSIGNMENT`/`SECRET_KEY`; VS Code `modelFallbackDetail.ts` |
| Redaction | `secret-redaction` (`redactDeep`, `redactThenCap`) | W `scrubCredentials` and `redactEvidence` (W is published separately: keep, with a parity test); VS Code `redactFallbackText`; agent-runtime `config/redact-snapshot.ts` and `logging/redact-identifier.ts` (UNVERIFIED overlap) |
| Dangerous commands | none; build one ruleset | run-delta `rmRf`; `dangerous-tools.ts`; `node-command-policy.ts`; `exec-approvals-analysis.ts`; `agent-tools/src/policyGateCallKey.ts` (UNVERIFIED); W `agent.tool_not_allowed` |
| Code-vulnerability rules | `code-shield` SAST and behaviour | run-delta `tlsVerifyDisabled`, `weakCrypto`, `corsPermissive`, `cspPermissive`, `cookieInsecure` (parallel regexes, different severity) |
| Severity | `sarif` `FindingSeverity` (CRITICAL..LOW) with one mapper | Shield and incidents lower-case; `SecurityAuditService` 5-level (adds `info`); agent-runtime info/warn/critical; run-delta and knowledge error/warn; `packageReview` pass/warn/fail; `auditDeepPass` `FINDING_SEVERITIES`; two action scales (allow..block, allow..quarantine) |
| Finding and incident shape | `sarif` `NormalizedFinding`, `security_incidents` | `SecurityAuditFinding`, `SkillScanFinding`, W `SecurityEvent`, `CodeScanVerdict`, run-delta findings, `packageReview` verdicts |
| Reason codes | W `ShieldReasonCode` / `SHIELD_RULES` | api `runtimeShieldEvent.ts` `SHIELD_REASON_CODES` and `SHIELD_REASON_POLICY` (hand mirror); code-shield rule ids in mixed styles |
| Egress | signed per-app policy (`workerEgressPolicy`) plus `previewCsp` | `sandbox/egressAllowlist.ts`; `host-egress.ts`; W `previewEgress.ts`; frontend and Control UI CSP |
| Policy config | none | signed egress JSON; `gateway.nodes.allowCommands`/`denyCommands`; `exec-approvals.json`; `governance_policy_packs`; `logging.redactPatterns`; W `SHIELD_RULES` |
| Prompt-injection patterns | none; build one package | `external-content.ts`; `instruction-firewall.ts`; M `cognition/sanitize.ts` |
| Dependency vulnerabilities | OSV (`osvScaScan.ts`) → `vulnerability_findings` | code-shield manifest heuristics (keep: a different signal); run-delta `installScriptAdded`; `advisoryFeed`; `githubAlerts` |

### 8.4 Target design and order

1. **One secret detector.** code-shield `secretRules` becomes a view derived from `SECRET_SHAPES`. Delete `governance-audit/matchers.ts` `SECRET_PATTERNS`. Move VS Code `modelFallbackDetail.ts` onto the shared redactor. Add a parity test between W `scrubCredentials` and `secret-redaction`.
2. **One severity mapper** in `sarif`, covering every scale in §8.3; consumers map at their edge.
3. **Shield reason codes from one source.** Generate the API's `SHIELD_REASON_CODES`, and the default for `SHIELD_REASON_POLICY`, from W `SHIELD_RULES`. The API keeps its own trusted severity, but a test fails on drift.
4. **Server-side value redaction on Shield evidence.**
5. **run-delta security rules call code-shield** (one rule set; run-delta keeps its error/warn mapping through the mapper).
6. **One dangerous-command ruleset** in `agent-tools`, used by exec approvals, run-delta `rmRf` and the command gate. This joins `SHELL-G009`.
7. **One prompt-injection package**, consumed by agent-runtime and memory recall.
8. **Egress registry.** One documented list and format; sandbox enforcement on by default.
9. **Memory.** Redact before facts are stored. **I.** Decide the inference host's policy; under the IDE rebuild it inherits the VS Code extension's.
10. **Rule-ID naming.** Namespace every code-shield id and remove the duplicate `obfuscated-code`.

### 8.5 Gaps

| ID | Gap | Where |
|---|---|---|
| SECP-G001 | Secret regexes outside `secret-redaction` | `code-shield/src/rules/secretRules.ts`, `agent-runtime/src/agents/tools/governance-audit/matchers.ts`, W `securityEvent.ts`, VS Code `modelFallbackDetail.ts` |
| SECP-G002 | About 8 severity scales; no shared mapper | `sarif`, `SecurityAuditService.ts`, `auditDeepPass.ts`, `skill-scanner.ts`, `agent-runtime/src/security/audit.ts`, `packageReview.ts`, run-delta, Shield |
| SECP-G003 | Shield reason codes mirrored by hand | `api/src/application/security/runtimeShieldEvent.ts`, W `shieldRules.ts` |
| SECP-G004 | Memory has no secret redaction before storage (details in the local security findings file) | M `packages/memory/src/storage/*` (UNVERIFIED) |
| SECP-G005 | No single dangerous-command ruleset | `exec-approvals-analysis.ts`, run-delta `rmRf.ts`, `agent-tools/src/policyGateCallKey.ts`, `dangerous-tools.ts`, `node-command-policy.ts` |
| SECP-G006 | run-delta security rules re-implement code-shield SAST | `run-delta/src/rules/{tlsVerifyDisabled, weakCrypto, corsPermissive, cspPermissive, cookieInsecure}.ts` |
| SECP-G007 | Three prompt-injection pattern sets | `agent-runtime/src/security/{external-content, instruction-firewall}.ts`, M `cognition/sanitize.ts` |
| SECP-G008 | W scrubber parity test; VS Code fallback redactor | W `securityEvent.ts`, VS Code `models/modelFallbackDetail.ts` |
| SECP-G009 | Egress has no single registry; six mechanisms | §8.2 egress row |
| SECP-G010 | The inference host (I) has no scanner or egress policy | `I/crates/*` |
| SECP-G011 | Shield evidence values are not redacted server-side (details in the local security findings file) | `runtimeShieldEvent.ts` |
| SECP-G012 | code-shield rule ids are inconsistent; `obfuscated-code` is duplicated | `packages/code-shield/src/rules/*` |
| SECP-G013–G015 | Security-sensitive defaults and coverage gaps; details in the local security findings file | — |
